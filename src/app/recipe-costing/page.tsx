"use client";
import { useState } from "react";
import { useLanguage } from "@/lib/context";
import { PageHeader, KpiCard, Badge, FilterBar } from "@/components/shared";
import type { Recipe } from "@/lib/types";
import * as XLSX from "xlsx";

export default function RecipeCostingPage() {
  const { t, locale, data } = useLanguage();
  const recipes = data.recipes;
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null);
  const [laborCost, setLaborCost] = useState(4.00);
  const [overheadCost, setOverheadCost] = useState(2.00);
  const [profitMargin, setProfitMargin] = useState(60);
  const [vatPercent, setVatPercent] = useState(24);

  function calcCosting(r: Recipe) {
    const rawMaterial = Number(r.totalRawMaterialCost);
    const labor = laborCost;
    const overhead = overheadCost;
    const total = rawMaterial + labor + overhead;
    const selling = total / (1 - profitMargin / 100);
    const menuVat = selling * (1 + vatPercent / 100);
    const portionYield = Number(r.portionYield) || 1;
    const finalPrice = menuVat / portionYield;
    return { rawMaterial, labor, overhead, total, selling, menuVat, finalPrice, portionYield };
  }

  const fmt = (n: number) => `€${n.toFixed(2)}`;
  const avgMargin = recipes.length > 0 ? recipes.reduce((s, r) => s + Number(r.profitMarginPercent || 0), 0) / recipes.length : 0;
  const avgCost = recipes.length > 0 ? recipes.reduce((s, r) => s + Number(r.totalCost || 0), 0) / recipes.length : 0;

  async function handleExportPDF() {
    if (!selectedRecipe) return;
    const { jsPDF } = await import("jspdf");
    const c = calcCosting(selectedRecipe);
    const today = new Date().toLocaleDateString("el-GR", { day: "2-digit", month: "2-digit", year: "numeric" });
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const W = 210; const MAR = 14; const COL = W - MAR * 2;
    let y = MAR;

    // Title bar
    doc.setFillColor(30, 64, 175);
    doc.rect(MAR, y, COL, 10, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(13); doc.setFont("helvetica", "bold");
    doc.text("NOE BEACH CLUB  -  RECIPE COSTING", MAR + 4, y + 7);
    y += 14;

    // Header grid
    const hRowH = 8; const labelW = 42;
    const col1X = MAR; const col2X = MAR + labelW;
    const col3X = MAR + COL / 2 + 2; const col4X = col3X + labelW;
    const col2W = COL / 2 - labelW - 2; const col4W = COL / 2 - labelW;

    const headerRows = [
      ["Recipe", selectedRecipe.name, "Date", today],
      ["Portion Yield", `${selectedRecipe.portionYield} ${selectedRecipe.portionUnit || ""}`, "Portions", String(c.portionYield)],
      ["Profit Margin", `${profitMargin}%`, "VAT", `${vatPercent}%`],
    ];
    for (const [l1, v1, l2, v2] of headerRows) {
      doc.setFillColor(30, 64, 175); doc.rect(col1X, y, labelW, hRowH, "F");
      doc.setTextColor(255, 255, 255); doc.setFontSize(8); doc.setFont("helvetica", "bold");
      doc.text(l1, col1X + 2, y + 5.5);
      doc.setFillColor(248, 250, 252); doc.rect(col2X, y, col2W, hRowH, "F");
      doc.setDrawColor(200, 200, 200); doc.rect(col2X, y, col2W, hRowH, "S");
      doc.setTextColor(30, 30, 30); doc.setFont("helvetica", "normal");
      doc.text(String(v1).substring(0, 38), col2X + 2, y + 5.5);
      doc.setFillColor(30, 64, 175); doc.rect(col3X, y, labelW, hRowH, "F");
      doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold");
      doc.text(l2, col3X + 2, y + 5.5);
      doc.setFillColor(248, 250, 252); doc.rect(col4X, y, col4W, hRowH, "F");
      doc.setDrawColor(200, 200, 200); doc.rect(col4X, y, col4W, hRowH, "S");
      doc.setTextColor(30, 30, 30); doc.setFont("helvetica", "normal");
      doc.text(String(v2), col4X + 2, y + 5.5);
      y += hRowH;
    }
    y += 6;

    // Cost breakdown section
    doc.setFillColor(30, 64, 175); doc.rect(MAR, y, COL, 7, "F");
    doc.setTextColor(255, 255, 255); doc.setFontSize(9); doc.setFont("helvetica", "bold");
    doc.text("COST BREAKDOWN", MAR + 4, y + 5);
    y += 7;

    const costRows: [string, string, boolean][] = [
      ["Raw Material Cost", `${c.rawMaterial.toFixed(2)} EUR`, false],
      ["Labor Cost", `${c.labor.toFixed(2)} EUR`, false],
      ["Overhead Cost", `${c.overhead.toFixed(2)} EUR`, false],
      ["Total Cost", `${c.total.toFixed(2)} EUR`, true],
    ];
    for (const [label, val, bold] of costRows) {
      doc.setFillColor(bold ? 241 : 248, bold ? 245 : 250, bold ? 255 : 252);
      doc.rect(MAR, y, COL, 8, "F");
      doc.setDrawColor(203, 213, 225); doc.line(MAR, y + 8, MAR + COL, y + 8);
      doc.setTextColor(30, 30, 30); doc.setFontSize(9);
      doc.setFont("helvetica", bold ? "bold" : "normal");
      doc.text(label, MAR + 4, y + 5.5);
      doc.text(val, MAR + COL - 4, y + 5.5, { align: "right" });
      y += 8;
    }
    y += 6;

    // Pricing section
    doc.setFillColor(30, 64, 175); doc.rect(MAR, y, COL, 7, "F");
    doc.setTextColor(255, 255, 255); doc.setFontSize(9); doc.setFont("helvetica", "bold");
    doc.text("PRICING", MAR + 4, y + 5);
    y += 7;

    const priceRows: [string, string, boolean][] = [
      [`Selling Price (${profitMargin}% margin)`, `${c.selling.toFixed(2)} EUR`, false],
      [`Menu Price + VAT (${vatPercent}%)`, `${c.menuVat.toFixed(2)} EUR`, false],
      ["Final Menu Price / Portion", `${c.finalPrice.toFixed(2)} EUR`, true],
    ];
    for (const [label, val, bold] of priceRows) {
      doc.setFillColor(bold ? 30 : 248, bold ? 58 : 250, bold ? 138 : 252);
      doc.rect(MAR, y, COL, 8, "F");
      if (!bold) { doc.setDrawColor(203, 213, 225); doc.line(MAR, y + 8, MAR + COL, y + 8); }
      doc.setTextColor(bold ? 255 : 30, bold ? 255 : 30, bold ? 255 : 30);
      doc.setFontSize(bold ? 10 : 9);
      doc.setFont("helvetica", bold ? "bold" : "normal");
      doc.text(label, MAR + 4, y + 5.5);
      doc.text(val, MAR + COL - 4, y + 5.5, { align: "right" });
      y += 8;
    }
    y += 8;

    // Ingredients table
    if (selectedRecipe.ingredients && selectedRecipe.ingredients.length > 0) {
      doc.setFillColor(30, 64, 175); doc.rect(MAR, y, COL, 7, "F");
      doc.setTextColor(255, 255, 255); doc.setFontSize(9); doc.setFont("helvetica", "bold");
      doc.text("INGREDIENT BREAKDOWN", MAR + 4, y + 5);
      y += 7;

      const colW = [74, 22, 20, 28, 28]; // Product, Qty, Unit, Unit Cost, Total
      const colXi = [MAR, MAR+74, MAR+96, MAR+116, MAR+144];
      const hdrs = ["Product", "Qty", "Unit", "Unit Cost", "Total"];
      const ali: ("left"|"right"|"center")[] = ["left","center","center","right","right"];

      doc.setFillColor(71, 85, 105); doc.rect(MAR, y, COL, 7, "F");
      doc.setTextColor(255, 255, 255); doc.setFontSize(8); doc.setFont("helvetica", "bold");
      for (let c2 = 0; c2 < hdrs.length; c2++) {
        const x = c2===0 ? colXi[c2]+2 : c2===4 ? colXi[c2]+colW[c2]-2 : colXi[c2]+colW[c2]/2;
        doc.text(hdrs[c2], x, y+5, { align: ali[c2] });
      }
      y += 7;

      for (let i = 0; i < selectedRecipe.ingredients.length; i++) {
        const ing = selectedRecipe.ingredients[i];
        const isEven = i % 2 === 0;
        doc.setFillColor(isEven?248:255, isEven?250:255, isEven?252:255);
        doc.rect(MAR, y, COL, 7, "F");
        doc.setDrawColor(229, 231, 235); doc.line(MAR, y+7, MAR+COL, y+7);
        doc.setTextColor(30,30,30); doc.setFontSize(8); doc.setFont("helvetica","normal");
        const vals2 = [
          ing.ingredientName.substring(0,38),
          Number(ing.quantity).toFixed(3),
          ing.unit,
          `${Number(ing.unitCost).toFixed(2)} EUR`,
          `${Number(ing.totalCost).toFixed(2)} EUR`,
        ];
        for (let c2 = 0; c2 < vals2.length; c2++) {
          const x = c2===0 ? colXi[c2]+2 : c2===4 ? colXi[c2]+colW[c2]-2 : colXi[c2]+colW[c2]/2;
          doc.text(vals2[c2], x, y+5, { align: ali[c2] });
        }
        y += 7;
        if (y > 265) { doc.addPage(); y = MAR; }
      }
    }

    // Footer
    doc.setTextColor(148,163,184); doc.setFontSize(8); doc.setFont("helvetica","normal");
    doc.text(`NOE BEACH CLUB  |  ${selectedRecipe.name}  |  ${today}`, W/2, 287, { align:"center" });

    window.open(doc.output("bloburl"), "_blank");
  }

  function handleExportExcel() {
    if (!selectedRecipe) return;
    const c = calcCosting(selectedRecipe);
    const today = new Date().toLocaleDateString("el-GR", { day: "2-digit", month: "2-digit", year: "numeric" });

    const wb = XLSX.utils.book_new();
    const rows: (string | number)[][] = [
      ["NOE BEACH CLUB — RECIPE COSTING"],
      [],
      ["Recipe:", selectedRecipe.name],
      ["Date:", today],
      ["Portion Yield:", `${selectedRecipe.portionYield} ${selectedRecipe.portionUnit || ""}`],
      ["Profit Margin:", `${profitMargin}%`],
      ["VAT:", `${vatPercent}%`],
      [],
      ["COST BREAKDOWN"],
      ["Raw Material Cost", c.rawMaterial],
      ["Labor Cost", c.labor],
      ["Overhead Cost", c.overhead],
      ["Total Cost", c.total],
      [],
      ["PRICING"],
      [`Selling Price (${profitMargin}% margin)`, c.selling],
      [`Menu Price + VAT (${vatPercent}%)`, c.menuVat],
      ["Final Menu Price / Portion", c.finalPrice],
      [],
      ["INGREDIENT BREAKDOWN"],
      ["Product", "Quantity", "Unit", "Unit Cost (EUR)", "Total (EUR)"],
    ];

    if (selectedRecipe.ingredients) {
      for (const ing of selectedRecipe.ingredients) {
        rows.push([ing.ingredientName, Number(ing.quantity), ing.unit, Number(ing.unitCost), Number(ing.totalCost)]);
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
        <button onClick={handleExportPDF} disabled={!selectedRecipe} className="erp-btn-secondary">📄 PDF</button>
        <button onClick={handleExportExcel} disabled={!selectedRecipe} className="erp-btn-secondary">📊 Excel</button>
      </PageHeader>

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
            <div><label className="erp-label">{t("fieldLaborCost")}</label><input type="number" value={laborCost} onChange={e => setLaborCost(Number(e.target.value))} className="erp-input" step="0.01" /></div>
            <div><label className="erp-label">{t("fieldOverheadCost")}</label><input type="number" value={overheadCost} onChange={e => setOverheadCost(Number(e.target.value))} className="erp-input" step="0.01" /></div>
            <div><label className="erp-label">{t("fieldProfitMargin")}</label><input type="number" value={profitMargin} onChange={e => setProfitMargin(Number(e.target.value))} className="erp-input" step="1" max="100" /></div>
            <div><label className="erp-label">{t("fieldVatPercent")}</label><input type="number" value={vatPercent} onChange={e => setVatPercent(Number(e.target.value))} className="erp-input" step="1" /></div>
          </div>
        </div>
      </div>

      <div className="flex gap-6">
        {/* Recipe List */}
        <div className="w-full lg:w-1/3">
          <div className="erp-card">
            <div className="erp-card-header"><h3 className="font-semibold">📋 {locale === "gr" ? "Επιλογή Συνταγής" : "Select Recipe"}</h3></div>
            <div className="divide-y max-h-[500px] overflow-y-auto">
              {recipes.map((r, idx) => (
                <div key={r?.id ?? `recipe-${idx}`} onClick={() => setSelectedRecipe(r)} className={`p-4 cursor-pointer hover:bg-blue-50/50 transition-colors ${selectedRecipe?.id === r?.id ? "bg-blue-50 border-l-4 border-blue-500" : ""}`}>
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
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      <div className="space-y-4">
                        <h4 className="font-semibold text-slate-700">{locale === "gr" ? "Κόστος" : "Cost Breakdown"}</h4>
                        <div className="space-y-2">
                          <div className="flex justify-between py-2 border-b"><span className="text-slate-600">{t("fieldRawMaterialCost")}</span><span className="font-medium">{fmt(c.rawMaterial)}</span></div>
                          <div className="flex justify-between py-2 border-b"><span className="text-slate-600">{t("fieldLaborCost")}</span><span className="font-medium">{fmt(c.labor)}</span></div>
                          <div className="flex justify-between py-2 border-b"><span className="text-slate-600">{t("fieldOverheadCost")}</span><span className="font-medium">{fmt(c.overhead)}</span></div>
                          <div className="flex justify-between py-2 border-b border-slate-300 font-bold"><span>{t("fieldTotalCost")}</span><span className="text-lg">{fmt(c.total)}</span></div>
                        </div>
                      </div>
                      <div className="space-y-4">
                        <h4 className="font-semibold text-slate-700">{locale === "gr" ? "Τιμολόγηση" : "Pricing"}</h4>
                        <div className="space-y-2">
                          <div className="flex justify-between py-2 border-b"><span className="text-slate-600">{locale === "gr" ? "Περιθώριο Κέρδους" : "Profit Margin"}</span><Badge color="green">{profitMargin}%</Badge></div>
                          <div className="flex justify-between py-2 border-b"><span className="text-slate-600">{t("fieldSellingPrice")}</span><span className="font-medium">{fmt(c.selling)}</span></div>
                          <div className="flex justify-between py-2 border-b"><span className="text-slate-600">{t("fieldMenuPriceVat")} ({vatPercent}%)</span><span className="font-medium">{fmt(c.menuVat)}</span></div>
                          <div className="flex justify-between py-2 border-b border-blue-300 bg-blue-50 -mx-2 px-2 rounded"><span className="font-bold text-blue-700">{t("fieldMenuPriceFinal")}</span><span className="text-xl font-bold text-blue-700">{fmt(c.finalPrice)}</span></div>
                        </div>
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
                            <tr key={i}>
                              <td className="font-medium">{ing.ingredientName}</td>
                              <td>{Number(ing.quantity).toFixed(3)}</td>
                              <td>{ing.unit}</td>
                              <td>{fmt(Number(ing.unitCost))}</td>
                              <td className="font-semibold">{fmt(Number(ing.totalCost))}</td>
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
