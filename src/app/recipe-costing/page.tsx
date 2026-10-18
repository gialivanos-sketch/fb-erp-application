"use client";
import { useRef, useState } from "react";
import * as db from "@/lib/supabaseData";
import { useLanguage } from "@/lib/context";
import { PageHeader, KpiCard, Badge, FilterBar } from "@/components/shared";
import type { Recipe } from "@/lib/types";
import * as XLSX from "xlsx";
import { useBusinessName } from "@/lib/useBusinessName";
import RecipePricingPanel from "@/components/RecipePricingPanel";

export default function RecipeCostingPage() {
  const bizName = useBusinessName();
  const { t, locale, data } = useLanguage();
  const recipes = data.recipes;
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null);
  // Εργατικά, γενικά, περιθώριο, «η τιμή μου»: τα βάζει ο χρήστης και
  // ΑΠΟΘΗΚΕΥΟΝΤΑΙ στη συνταγή. Ό,τι σβήσει = 0.
  const [laborCost, setLaborCost] = useState(4.00);
  const [overheadCost, setOverheadCost] = useState(2.00);
  const [profitMargin, setProfitMargin] = useState(60);
  const [vatPercent, setVatPercent] = useState(24);
  // Τιμή που θέλει ο χρήστης να πουλήσει το πιάτο (ανά μερίδα, με ΦΠΑ). 0 = καμία.
  const [targetPrice, setTargetPrice] = useState(0);
  // τιμές που αποθηκεύτηκαν σε αυτή τη συνεδρία (μέχρι να έρθουν τα νέα δεδομένα)
  const [savedVals, setSavedVals] = useState<Record<number, { labor: number; overhead: number; margin: number; price: number }>>({});
  const [saveState, setSaveState] = useState<"" | "saving" | "saved" | "error" | "nocol">("");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function selectRecipe(r: Recipe) {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    setSelectedRecipe(r);
    const sv = savedVals[r.id];
    setLaborCost(sv ? sv.labor : Number(r.laborCost) || 0);
    setOverheadCost(sv ? sv.overhead : Number(r.overheadCost) || 0);
    setProfitMargin(sv ? sv.margin : Number(r.profitMarginPercent) || 0);
    setTargetPrice(sv ? sv.price : Number(r.mySellingPrice) || 0);
    setSaveState("");
  }

  // Αποθήκευση λίγο μετά την τελευταία αλλαγή
  function scheduleSave(next: Partial<{ labor: number; overhead: number; margin: number; price: number; vat: number }>) {
    const r = selectedRecipe;
    if (!r) return;
    const v = { labor: laborCost, overhead: overheadCost, margin: profitMargin, price: targetPrice, vat: vatPercent, ...next };
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveState("saving");
    saveTimer.current = setTimeout(async () => {
      saveTimer.current = null;
      const c = costingFor(r, v.labor, v.overhead, v.margin, v.vat, v.price);
      try {
        const res = await db.saveRecipeCosting(r.id, {
          laborCost: v.labor, overheadCost: v.overhead, profitMarginPercent: v.margin, mySellingPrice: v.price,
          rawMaterial: c.rawMaterial, totalCost: c.total, sellingPrice: c.selling, menuPriceVat: c.menuVat, menuPriceFinal: c.finalPrice,
        });
        setSavedVals(prev => ({ ...prev, [r.id]: { labor: v.labor, overhead: v.overhead, margin: v.margin, price: v.price } }));
        setSaveState(res.savedMyPrice ? "saved" : "nocol");
      } catch {
        setSaveState("error");
      }
    }, 900);
  }
  const num = (s: string) => (s === "" ? 0 : Number(s) || 0);

  function calcCosting(r: Recipe) {
    return costingFor(r, laborCost, overheadCost, profitMargin, vatPercent, targetPrice);
  }

  function costingFor(r: Recipe, laborCost: number, overheadCost: number, profitMargin: number, vatPercent: number, targetPrice: number) {
    // πρώτη ύλη = Σ (ποσότητα × τιμή μονάδας)
    const ings = r.ingredients ?? [];
    const rawMaterial = ings.length ? ings.reduce((s, i) => s + lineCost(i), 0) : Number(r.totalRawMaterialCost);
    const labor = laborCost;
    const overhead = overheadCost;
    const total = rawMaterial + labor + overhead;
    const selling = profitMargin < 100 ? total / (1 - profitMargin / 100) : 0;
    const menuVat = selling * (1 + vatPercent / 100);
    const portionYield = Number(r.portionYield) || 1;
    const finalPrice = menuVat / portionYield;
    const unpriced = ings.filter(i => !(lineCost(i) > 0)).length;
    const costPerPortion = total / portionYield;
    const sellingPerPortion = selling / portionYield;
    // Κέρδος με βάση το ποσοστό (ανά μερίδα, χωρίς ΦΠΑ)
    const profitByPct = sellingPerPortion - costPerPortion;
    // Κέρδος με βάση την τιμή που θέλω να πουλήσω (ανά μερίδα, με ΦΠΑ → χωρίς ΦΠΑ)
    // τιμή 0 = δεν έχει μπει → όλα 0
    const tp = Number(targetPrice) || 0;
    const targetNet = tp > 0 ? tp / (1 + vatPercent / 100) : 0;
    const profitByTarget = tp > 0 ? targetNet - costPerPortion : 0;
    const marginByTarget = tp > 0 && targetNet ? (profitByTarget / targetNet) * 100 : 0;
    return { rawMaterial, labor, overhead, total, selling, menuVat, finalPrice, portionYield,
      costPerPortion, sellingPerPortion, profitByPct, targetNet, profitByTarget, marginByTarget, unpriced, ingCount: ings.length };
  }

  const fmt = (n: number) => `€${n.toFixed(2)}`;
  function lineCost(i: { quantity?: unknown; unitCost?: unknown }) {
    return (Number(i.quantity) || 0) * (Number(i.unitCost) || 0);
  }
  const avgMargin = recipes.length > 0 ? recipes.reduce((s, r) => s + Number(r.profitMarginPercent || 0), 0) / recipes.length : 0;
  const avgCost = recipes.length > 0 ? recipes.reduce((s, r) => s + Number(r.totalCost || 0), 0) / recipes.length : 0;

  function handleExportPDF() {
    if (!selectedRecipe) return;
    const c = calcCosting(selectedRecipe);
    const today = new Date().toLocaleDateString("el-GR", { day: "2-digit", month: "2-digit", year: "numeric" });

    const ingredientRows = (selectedRecipe.ingredients ?? []).map((ing, idx) => {
      const bg = idx % 2 === 0 ? "#f8fafc" : "#ffffff";
      return `<tr style="background:${bg}">
        <td style="padding:5px 8px;border-bottom:1px solid #e5e7eb">${ing.ingredientName}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #e5e7eb;text-align:center">${Number(ing.quantity).toFixed(3)}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #e5e7eb;text-align:center">${ing.unit}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #e5e7eb;text-align:right">${Number(ing.unitCost).toFixed(2)} €</td>
        <td style="padding:5px 8px;border-bottom:1px solid #e5e7eb;text-align:right">${lineCost(ing).toFixed(2)} €</td>
      </tr>`;
    }).join("");

    const html = `<!DOCTYPE html><html lang="el"><head><meta charset="UTF-8">
      <title>Recipe Costing – ${selectedRecipe.name}</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 20px; color: #1e293b; font-size: 12px; }
        @media print { body { margin: 10mm; } @page { size: A4; margin: 10mm; } }
        table { width: 100%; border-collapse: collapse; }
      </style>
    </head><body>

      <!-- Title bar -->
      <div style="background:#1e40af;color:#fff;padding:10px 14px;font-size:15px;font-weight:700;letter-spacing:0.5px;margin-bottom:0">
        ${bizName} &nbsp;–&nbsp; RECIPE COSTING
      </div>

      <!-- Header info -->
      <table style="margin-bottom:14px">
        <tr>
          <td style="width:22%;background:#1e40af;color:#fff;font-weight:700;font-size:10px;padding:5px 8px">Συνταγή</td>
          <td style="width:28%;background:#f8fafc;border:1px solid #e2e8f0;font-size:10px;padding:5px 8px">${selectedRecipe.name}</td>
          <td style="width:22%;background:#1e40af;color:#fff;font-weight:700;font-size:10px;padding:5px 8px">Ημερομηνία</td>
          <td style="width:28%;background:#f8fafc;border:1px solid #e2e8f0;font-size:10px;padding:5px 8px">${today}</td>
        </tr>
        <tr>
          <td style="background:#1e40af;color:#fff;font-weight:700;font-size:10px;padding:5px 8px">Απόδοση Μερίδας</td>
          <td style="background:#f8fafc;border:1px solid #e2e8f0;font-size:10px;padding:5px 8px">${selectedRecipe.portionYield} ${selectedRecipe.portionUnit || ""}</td>
          <td style="background:#1e40af;color:#fff;font-weight:700;font-size:10px;padding:5px 8px">Μερίδες</td>
          <td style="background:#f8fafc;border:1px solid #e2e8f0;font-size:10px;padding:5px 8px">${c.portionYield}</td>
        </tr>
        <tr>
          <td style="background:#1e40af;color:#fff;font-weight:700;font-size:10px;padding:5px 8px">Περιθώριο Κέρδους</td>
          <td style="background:#f8fafc;border:1px solid #e2e8f0;font-size:10px;padding:5px 8px">${profitMargin}%</td>
          <td style="background:#1e40af;color:#fff;font-weight:700;font-size:10px;padding:5px 8px">ΦΠΑ</td>
          <td style="background:#f8fafc;border:1px solid #e2e8f0;font-size:10px;padding:5px 8px">${vatPercent}%</td>
        </tr>
      </table>

      <!-- Cost breakdown -->
      <div style="background:#1e40af;color:#fff;padding:6px 10px;font-size:10px;font-weight:700;margin-bottom:0">
        ΑΝΑΛΥΣΗ ΚΟΣΤΟΥΣ
      </div>
      <table style="margin-bottom:14px">
        <tr>
          <td style="background:#f8fafc;border-bottom:1px solid #cbd5e1;padding:5px 10px;font-size:10px">Κόστος Α΄ Υλών</td>
          <td style="background:#f8fafc;border-bottom:1px solid #cbd5e1;padding:5px 10px;font-size:10px;text-align:right">${c.rawMaterial.toFixed(2)} EUR</td>
        </tr>
        <tr>
          <td style="background:#ffffff;border-bottom:1px solid #cbd5e1;padding:5px 10px;font-size:10px">Κόστος Εργασίας</td>
          <td style="background:#ffffff;border-bottom:1px solid #cbd5e1;padding:5px 10px;font-size:10px;text-align:right">${c.labor.toFixed(2)} EUR</td>
        </tr>
        <tr>
          <td style="background:#f8fafc;border-bottom:1px solid #cbd5e1;padding:5px 10px;font-size:10px">Γενικά Έξοδα</td>
          <td style="background:#f8fafc;border-bottom:1px solid #cbd5e1;padding:5px 10px;font-size:10px;text-align:right">${c.overhead.toFixed(2)} EUR</td>
        </tr>
        <tr>
          <td style="background:#f1f5ff;border-bottom:1px solid #cbd5e1;padding:5px 10px;font-size:10px;font-weight:700">Συνολικό Κόστος</td>
          <td style="background:#f1f5ff;border-bottom:1px solid #cbd5e1;padding:5px 10px;font-size:10px;font-weight:700;text-align:right">${c.total.toFixed(2)} EUR</td>
        </tr>
      </table>

      <!-- Pricing -->
      <div style="background:#1e40af;color:#fff;padding:6px 10px;font-size:10px;font-weight:700;margin-bottom:0">
        ΤΙΜΟΛΟΓΗΣΗ
      </div>
      <table style="margin-bottom:14px">
        <tr>
          <td style="background:#f8fafc;border-bottom:1px solid #cbd5e1;padding:5px 10px;font-size:10px">Τιμή Πώλησης (${profitMargin}% περιθώριο)</td>
          <td style="background:#f8fafc;border-bottom:1px solid #cbd5e1;padding:5px 10px;font-size:10px;text-align:right">${c.selling.toFixed(2)} EUR</td>
        </tr>
        <tr>
          <td style="background:#ffffff;border-bottom:1px solid #cbd5e1;padding:5px 10px;font-size:10px">Τιμή Μενού + ΦΠΑ (${vatPercent}%)</td>
          <td style="background:#ffffff;border-bottom:1px solid #cbd5e1;padding:5px 10px;font-size:10px;text-align:right">${c.menuVat.toFixed(2)} EUR</td>
        </tr>
        <tr>
          <td style="background:#1e3a8a;color:#fff;padding:6px 10px;font-size:11px;font-weight:700">Τελική Τιμή Μενού / Μερίδα</td>
          <td style="background:#1e3a8a;color:#fff;padding:6px 10px;font-size:11px;font-weight:700;text-align:right">${c.finalPrice.toFixed(2)} EUR</td>
        </tr>
      </table>

      ${(selectedRecipe.ingredients ?? []).length > 0 ? `
      <!-- Ingredients section header -->
      <div style="background:#1e40af;color:#fff;padding:6px 10px;font-size:10px;font-weight:700;margin-bottom:0">
        ΥΛΙΚΑ ΣΥΝΤΑΓΗΣ
      </div>
      <!-- Ingredients column headers -->
      <table>
        <thead>
          <tr style="background:#475569;color:#fff">
            <th style="padding:6px 8px;text-align:left;font-size:10px;font-weight:700">Προϊόν</th>
            <th style="padding:6px 8px;text-align:center;font-size:10px;font-weight:700">Ποσότητα</th>
            <th style="padding:6px 8px;text-align:center;font-size:10px;font-weight:700">Μονάδα</th>
            <th style="padding:6px 8px;text-align:right;font-size:10px;font-weight:700">Τιμή Μονάδας</th>
            <th style="padding:6px 8px;text-align:right;font-size:10px;font-weight:700">Σύνολο</th>
          </tr>
        </thead>
        <tbody>${ingredientRows}</tbody>
      </table>
      ` : ""}

      <div style="text-align:center;margin-top:30px;font-size:9px;color:#94a3b8">
        ${bizName} &nbsp;|&nbsp; ${selectedRecipe.name} &nbsp;|&nbsp; ${today}
      </div>

    </body></html>`;

    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, "_blank");
    if (win) win.onload = () => URL.revokeObjectURL(url);
  }

  function handleExportExcel() {
    if (!selectedRecipe) return;
    const c = calcCosting(selectedRecipe);
    const today = new Date().toLocaleDateString("el-GR", { day: "2-digit", month: "2-digit", year: "numeric" });

    const wb = XLSX.utils.book_new();
    const rows: (string | number)[][] = [
      [`${bizName} — RECIPE COSTING`],
      [],
      ["Συνταγή:", selectedRecipe.name],
      ["Ημερομηνία:", today],
      ["Απόδοση Μερίδας:", `${selectedRecipe.portionYield} ${selectedRecipe.portionUnit || ""}`],
      ["Περιθώριο Κέρδους:", `${profitMargin}%`],
      ["ΦΠΑ:", `${vatPercent}%`],
      [],
      ["ΑΝΑΛΥΣΗ ΚΟΣΤΟΥΣ"],
      ["Κόστος Α΄ Υλών", c.rawMaterial],
      ["Κόστος Εργασίας", c.labor],
      ["Γενικά Έξοδα", c.overhead],
      ["Συνολικό Κόστος", c.total],
      [],
      ["ΤΙΜΟΛΟΓΗΣΗ"],
      [`Τιμή Πώλησης (${profitMargin}% περιθώριο)`, c.selling],
      [`Τιμή Μενού + ΦΠΑ (${vatPercent}%)`, c.menuVat],
      ["Τελική Τιμή Μενού / Μερίδα", c.finalPrice],
      [],
      ["ΥΛΙΚΑ ΣΥΝΤΑΓΗΣ"],
      ["Προϊόν", "Ποσότητα", "Μονάδα", "Τιμή Μονάδας (EUR)", "Σύνολο (EUR)"],
    ];

    if (selectedRecipe.ingredients) {
      for (const ing of selectedRecipe.ingredients) {
        rows.push([ing.ingredientName, Number(ing.quantity), ing.unit, Number(ing.unitCost), lineCost(ing)]);
      }
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{ wch: 40 }, { wch: 14 }, { wch: 10 }, { wch: 16 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws, "Costing");
    XLSX.writeFile(wb, `Costing_${selectedRecipe.name.replace(/\s+/g,"_")}_${new Date().toISOString().split("T")[0]}.xlsx`);
  }

  return (
    <div>
      <PageHeader title={t("headerRecipeCosting")} subtitle="Κοστολόγηση Συνταγής & Margin Analysis">
        <button onClick={() => window.print()} className="erp-btn-secondary">🖨️ {t("btnPrint")}</button>
        <button onClick={handleExportPDF} disabled={!selectedRecipe} className="erp-btn-secondary">📄 PDF</button>
        <button onClick={handleExportExcel} disabled={!selectedRecipe} className="erp-btn-secondary">📊 Excel</button>
      </PageHeader>

      <RecipePricingPanel />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <KpiCard label={locale === "gr" ? "Μέσο Κόστος" : "Avg Cost"} value={fmt(avgCost)} color="blue" icon="💰" />
        <KpiCard label={locale === "gr" ? "Μέσο Περιθώριο" : "Avg Margin"} value={`${avgMargin.toFixed(1)}%`} color="green" icon="📈" />
        <KpiCard label={locale === "gr" ? "Αριθμός Συνταγών" : "Recipe Count"} value={recipes.length} color="purple" icon="👨‍🍳" />
      </div>

      {/* Global Parameters */}
      <div className="erp-card mb-6">
        <div className="erp-card-header"><h3 className="font-semibold">⚙️ {locale === "gr" ? "Παράμετροι Κοστολόγησης" : "Costing Parameters"}</h3></div>
        <div className="p-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div><label className="erp-label">{t("fieldLaborCost")}</label><input type="number" value={laborCost} onChange={e => { const n = num(e.target.value); setLaborCost(n); scheduleSave({ labor: n }); }} className="erp-input" step="0.01" /></div>
            <div><label className="erp-label">{t("fieldOverheadCost")}</label><input type="number" value={overheadCost} onChange={e => { const n = num(e.target.value); setOverheadCost(n); scheduleSave({ overhead: n }); }} className="erp-input" step="0.01" /></div>
            <div><label className="erp-label">{t("fieldProfitMargin")}</label><input type="number" value={profitMargin} onChange={e => { const n = num(e.target.value); setProfitMargin(n); scheduleSave({ margin: n }); }} className="erp-input" step="1" max="100" /></div>
            <div><label className="erp-label">{t("fieldVatPercent")}</label><input type="number" value={vatPercent} onChange={e => { const n = num(e.target.value); setVatPercent(n); scheduleSave({ vat: n }); }} className="erp-input" step="1" /></div>
          </div>
          <div className="mt-3 text-sm">
            {!selectedRecipe ? <span className="text-slate-400">{locale === "gr" ? "Διάλεξε συνταγή — ό,τι αλλάζεις αποθηκεύεται αυτόματα στη συνταγή." : "Pick a recipe — changes save automatically."}</span>
              : saveState === "saving" ? <span className="text-slate-500">⏳ {locale === "gr" ? "Αποθήκευση…" : "Saving…"}</span>
              : saveState === "saved" ? <span className="text-green-700">✓ {locale === "gr" ? `Αποθηκεύτηκε στη συνταγή «${selectedRecipe.name}»` : "Saved"}</span>
              : saveState === "nocol" ? <span className="text-amber-700">⚠ {locale === "gr" ? "Αποθηκεύτηκαν εργατικά/γενικά/ποσοστό, ΟΧΙ «η τιμή μου»: τρέξε στο Supabase το supabase/migration_recipe_my_price.sql." : "Run migration_recipe_my_price.sql to save your price."}</span>
              : saveState === "error" ? <span className="text-red-600">✖ {locale === "gr" ? "Η αποθήκευση απέτυχε — άλλαξε ξανά μια τιμή για νέα προσπάθεια." : "Save failed."}</span>
              : null}
          </div>
        </div>
      </div>

      <div id="printable-recipe-area" className="flex gap-6">
        {/* Recipe List */}
        <div className="w-full lg:w-1/3">
          <div className="erp-card">
            <div className="erp-card-header"><h3 className="font-semibold">📋 {locale === "gr" ? "Επιλογή Συνταγής" : "Select Recipe"}</h3></div>
            <div className="divide-y max-h-[500px] overflow-y-auto">
              {recipes.map((r, idx) => (
                <div key={r?.id ?? `recipe-${idx}`} onClick={() => selectRecipe(r)} className={`p-4 cursor-pointer hover:bg-blue-50/50 transition-colors ${selectedRecipe?.id === r?.id ? "bg-blue-50 border-l-4 border-blue-500" : ""}`}>
                  <div className="font-medium">{r?.name ?? "—"}</div>
                  {r?.nameEn && <div className="text-xs text-slate-400">{r.nameEn}</div>}
                  <div className="flex gap-2 mt-1">
                    <Badge color="blue">{r?.portionYield} {r?.portionUnit}</Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Costing Display */}
        <div className="flex-1">
          {selectedRecipe ? (() => {
            const c = calcCosting(selectedRecipe);
            return (
              <div className="space-y-6">
                {/* Cost Breakdown */}
                <div className="erp-card">
                  <div className="erp-card-header">
                    <h3 className="font-semibold">💰 {selectedRecipe.name} {selectedRecipe.nameEn && `- ${selectedRecipe.nameEn}`}</h3>
                    <Badge color="blue">{selectedRecipe.portionYield} {selectedRecipe.portionUnit}</Badge>
                  </div>
                  <div className="p-6">
                    {c.unpriced > 0 && (
                      <div className="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-300 text-amber-800 text-sm">
                        ⚠️ {locale === "gr"
                          ? `${c.unpriced} από ${c.ingCount} υλικά δεν έχουν τιμή — το κόστος πρώτης ύλης είναι ελλιπές. Σύνδεσέ τα στο «🔄 Τιμές από αγορές → Εκκρεμότητες» και πάτα «Ενημέρωση τιμών συνταγών».`
                          : `${c.unpriced} of ${c.ingCount} ingredients have no price.`}
                      </div>
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      <div className="space-y-4">
                        <h4 className="font-semibold text-slate-700">{locale === "gr" ? "Κόστος" : "Cost Breakdown"}</h4>
                        <div className="space-y-2">
                          <div className="flex justify-between py-2 border-b"><span className="text-slate-600">{t("fieldRawMaterialCost")}</span><span className="font-medium">{fmt(c.rawMaterial)}</span></div>
                          <div className="flex justify-between py-2 border-b"><span className="text-slate-600">{t("fieldLaborCost")}</span><span className="font-medium">{fmt(c.labor)}</span></div>
                          <div className="flex justify-between py-2 border-b"><span className="text-slate-600">{t("fieldOverheadCost")}</span><span className="font-medium">{fmt(c.overhead)}</span></div>
                          <div className="flex justify-between py-2 border-b border-slate-300 font-bold"><span>{t("fieldTotalCost")}</span><span className="text-lg">{fmt(c.total)}</span></div>
                          <div className="flex justify-between py-2 border-b"><span className="text-slate-600">{locale === "gr" ? `Κόστος ανά μερίδα (÷${c.portionYield})` : "Cost per portion"}</span><span className="font-semibold">{fmt(c.costPerPortion)}</span></div>
                        </div>
                      </div>
                      <div className="space-y-4">
                        <h4 className="font-semibold text-slate-700">{locale === "gr" ? "Τιμολόγηση" : "Pricing"}</h4>
                        <div className="space-y-2">
                          <div className="flex justify-between py-2 border-b"><span className="text-slate-600">{locale === "gr" ? "Περιθώριο Κέρδους" : "Profit Margin"}</span><Badge color="green">{profitMargin}%</Badge></div>
                          <div className="flex justify-between py-2 border-b"><span className="text-slate-600">{t("fieldSellingPrice")}</span><span className="font-medium">{fmt(c.selling)}</span></div>
                          <div className="flex justify-between py-2 border-b"><span className="text-slate-600">{locale === "gr" ? "Τιμή πώλησης ανά μερίδα (χωρίς ΦΠΑ)" : "Selling per portion (net)"}</span><span className="font-medium">{fmt(c.sellingPerPortion)}</span></div>
                          <div className="flex justify-between py-2 border-b"><span className="text-slate-600">{t("fieldMenuPriceVat")} ({vatPercent}%)</span><span className="font-medium">{fmt(c.menuVat)}</span></div>
                          <div className="flex justify-between py-2 border-b border-blue-300 bg-blue-50 -mx-2 px-2 rounded"><span className="font-bold text-blue-700">{t("fieldMenuPriceFinal")}</span><span className="text-xl font-bold text-blue-700">{fmt(c.finalPrice)}</span></div>
                        </div>
                      </div>
                    </div>

                    {/* Κέρδος: με βάση το ποσοστό ↔ με βάση την τιμή που θέλω να πουλήσω */}
                    <div className="mt-6 pt-4 border-t">
                      <div className="flex flex-wrap items-end gap-3 mb-3">
                        <div>
                          <label className="erp-label">{locale === "gr" ? `Τιμή που θέλω να πουλήσω (ανά μερίδα, με ΦΠΑ ${vatPercent}%)` : `My selling price (per portion, incl. VAT ${vatPercent}%)`}</label>
                          <input type="number" step="0.10" min="0" value={targetPrice}
                            onChange={e => { const n = num(e.target.value); setTargetPrice(n); scheduleSave({ price: n }); }}
                            className="erp-input w-40" placeholder="π.χ. 12.50" />
                        </div>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="erp-table">
                          <thead><tr>
                            <th></th>
                            <th>{locale === "gr" ? `Με βάση το ποσοστό (${profitMargin}%)` : `By margin % (${profitMargin}%)`}</th>
                            <th>{locale === "gr" ? "Με βάση την τιμή μου" : "By my price"}</th>
                          </tr></thead>
                          <tbody>
                            <tr><td className="text-slate-600">{locale === "gr" ? "Τιμή μερίδας με ΦΠΑ" : "Portion price incl. VAT"}</td><td>{fmt(c.finalPrice)}</td><td>{fmt(targetPrice)}</td></tr>
                            <tr><td className="text-slate-600">{locale === "gr" ? "Τιμή μερίδας χωρίς ΦΠΑ" : "Portion price net"}</td><td>{fmt(c.sellingPerPortion)}</td><td>{fmt(c.targetNet)}</td></tr>
                            <tr><td className="text-slate-600">{locale === "gr" ? "Κόστος μερίδας" : "Portion cost"}</td><td>{fmt(c.costPerPortion)}</td><td>{targetPrice > 0 ? fmt(c.costPerPortion) : fmt(0)}</td></tr>
                            <tr className="font-bold"><td>{locale === "gr" ? "Κέρδος ανά μερίδα (€)" : "Profit per portion (€)"}</td>
                              <td className="text-green-700">{fmt(c.profitByPct)}</td>
                              <td className={c.profitByTarget >= 0 ? "text-green-700" : "text-red-600"}>{fmt(c.profitByTarget)}</td></tr>
                            <tr className="font-bold"><td>{locale === "gr" ? "Περιθώριο κέρδους (%)" : "Profit margin (%)"}</td>
                              <td>{profitMargin}%</td>
                              <td className={c.marginByTarget >= 0 ? "text-green-700" : "text-red-600"}>{`${c.marginByTarget.toFixed(1)}%`}</td></tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Ingredient Breakdown */}
                {selectedRecipe.ingredients && selectedRecipe.ingredients.length > 0 && (
                  <div className="erp-card">
                    <div className="erp-card-header"><h3 className="font-semibold">🧂 {locale === "gr" ? "Ανάλυση Υλικών" : "Ingredient Breakdown"}</h3></div>
                    <div className="overflow-x-auto">
                      <table className="erp-table">
                        <thead><tr><th>{t("fieldProduct")}</th><th>{t("fieldQuantity")}</th><th>{t("fieldUnit")}</th><th>{locale === "gr" ? "Τιμή Μονάδας" : "Unit Cost"}</th><th>{locale === "gr" ? "Σύνολο" : "Total"}</th></tr></thead>
                        <tbody>
                          {selectedRecipe.ingredients.map((ing, i) => (
                            <tr key={i} className={lineCost(ing) > 0 ? "" : "bg-amber-50"}>
                              <td className="font-medium">{lineCost(ing) > 0 ? "" : "⚠ "}{ing.ingredientName}</td>
                              <td>{Number(ing.quantity).toFixed(3)}</td>
                              <td>{ing.unit}</td>
                              <td>{Number(ing.unitCost) > 0 && Number(ing.unitCost) < 1 ? `€${Number(ing.unitCost).toFixed(4)}` : fmt(Number(ing.unitCost))}</td>
                              <td className="font-semibold">{fmt(lineCost(ing))}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            );
          })() : (
            <div className="erp-card p-12 text-center text-slate-400">
              <div className="text-4xl mb-3">👨‍🍳</div>
              <p>{locale === "gr" ? "Επιλέξτε μια συνταγή για κοστολόγηση" : "Select a recipe for costing analysis"}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
