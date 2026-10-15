"use client";
import { useState, useRef, useMemo, useEffect } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "@/lib/context";
import { PageHeader, Badge, Modal } from "@/components/shared";
import type { Recipe, OrderItem } from "@/lib/types";
import * as db from "@/lib/supabaseData";

// ─── Excel export — υλικά μίας συνταγής (SheetJS CDN) ───────────────────────
async function exportRecipeIngredients(
  recipe: Recipe | null,
  ingredients: DraftIngredient[],
  locale: string,
  costing: { rawMaterial: number; total: number; selling: number; menuVat: number; menuFinal: number }
) {
  if (!recipe) return;
  if (!(window as unknown as Record<string, unknown>).XLSX) {
    await new Promise<void>((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
      s.onload = () => resolve();
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const XLSX = (window as any).XLSX;

  // Φύλλο 1: Υλικά
  const ingRows = ingredients.map((ing, i) => ({
    "#": i + 1,
    [locale === "gr" ? "Υλικό" : "Ingredient"]: ing.productName,
    [locale === "gr" ? "Προμηθευτής" : "Supplier"]: ing.supplierName ?? "",
    [locale === "gr" ? "Ποσότητα" : "Qty"]: ing.quantity,
    [locale === "gr" ? "Μονάδα" : "Unit"]: ing.unit,
    [locale === "gr" ? "Τιμή/μον. €" : "Unit Cost €"]: Number(ing.unitCost),
    [locale === "gr" ? "Σύνολο €" : "Total €"]: Number(ing.totalCost),
  }));
  const wsIng = XLSX.utils.json_to_sheet(ingRows);
  wsIng["!cols"] = [{ wch: 4 }, { wch: 35 }, { wch: 20 }, { wch: 10 }, { wch: 8 }, { wch: 14 }, { wch: 12 }];

  // Φύλλο 2: Κοστολόγηση
  const costRows = [
    { "": locale === "gr" ? "Συνταγή" : "Recipe", " ": recipe.name },
    { "": locale === "gr" ? "Μερίδες" : "Portions", " ": `${recipe.portionYield} ${recipe.portionUnit}` },
    { "": "", " ": "" },
    { "": locale === "gr" ? "Κόστος Υλικών €" : "Raw Material €", " ": costing.rawMaterial },
    { "": locale === "gr" ? "Εργασία €" : "Labor €", " ": Number(recipe.laborCost) },
    { "": locale === "gr" ? "Γεν.Έξοδα €" : "Overhead €", " ": Number(recipe.overheadCost) },
    { "": locale === "gr" ? "Συνολικό Κόστος €" : "Total Cost €", " ": costing.total },
    { "": locale === "gr" ? "Περιθώριο %" : "Margin %", " ": Number(recipe.profitMarginPercent) },
    { "": locale === "gr" ? "Τιμή Πώλησης €" : "Selling Price €", " ": costing.selling },
    { "": locale === "gr" ? "Τιμή Μενού (ΦΠΑ 24%) €" : "Menu Price (VAT 24%) €", " ": costing.menuVat },
    { "": locale === "gr" ? "Τιμή/Μερίδα €" : "Price/Portion €", " ": costing.menuFinal },
  ];
  const wsCost = XLSX.utils.json_to_sheet(costRows);
  wsCost["!cols"] = [{ wch: 28 }, { wch: 20 }];

  // Φύλλο 3: Γενικά στοιχεία + Αλλεργίες + Τεχνικός Οδηγός
  const allergens: string[] = Array.isArray(recipe.allergens) ? recipe.allergens as string[] :
    typeof recipe.allergens === "string" ? JSON.parse(recipe.allergens || "[]") : [];
  const infoRows = [
    { "": locale === "gr" ? "Ονομασία (ΕΛ)" : "Name (GR)", " ": recipe.name },
    { "": locale === "gr" ? "Ονομασία (EN)" : "Name (EN)", " ": recipe.nameEn ?? "" },
    { "": locale === "gr" ? "Μερίδες" : "Portions", " ": `${recipe.portionYield} ${recipe.portionUnit}` },
    { "": locale === "gr" ? "Αλλεργίες" : "Allergens", " ": allergens.join(", ") || "—" },
    { "": "", " ": "" },
    { "": locale === "gr" ? "Τεχνικός Οδηγός" : "Technical Guide", " ": recipe.technicalGuide ?? "" },
  ];
  const wsInfo = XLSX.utils.json_to_sheet(infoRows);
  wsInfo["!cols"] = [{ wch: 22 }, { wch: 80 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsInfo,  locale === "gr" ? "Στοιχεία" : "Details");
  XLSX.utils.book_append_sheet(wb, wsIng,   locale === "gr" ? "Υλικά" : "Ingredients");
  XLSX.utils.book_append_sheet(wb, wsCost,  locale === "gr" ? "Κοστολόγηση" : "Costing");

  const safeName = recipe.name.replace(/[^a-zA-Z0-9Ͱ-Ͽ_-]/g, "_").slice(0, 40);
  XLSX.writeFile(wb, `${safeName}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ─── PDF export — ανοίγει νέο tab με print-ready κάρτα ───────────────────────
function printRecipePDF(recipe: Recipe, ingredients: DraftIngredient[], locale: string) {
  const allergens: string[] = Array.isArray(recipe.allergens) ? recipe.allergens as string[] :
    typeof recipe.allergens === "string" ? JSON.parse(recipe.allergens || "[]") : [];

  const rows = ingredients.map((ing, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${ing.productName}</td>
      <td style="text-align:right">${ing.quantity}</td>
      <td>${ing.unit}</td>
      <td style="text-align:right">€${ing.unitCost.toFixed(4)}</td>
      <td style="text-align:right">€${ing.totalCost.toFixed(3)}</td>
    </tr>`).join("");

  const totalRaw = ingredients.reduce((s, i) => s + i.totalCost, 0);
  const labor = Number(recipe.laborCost);
  const overhead = Number(recipe.overheadCost);
  const total = totalRaw + labor + overhead;
  const margin = Number(recipe.profitMarginPercent);
  const selling = margin < 100 ? total / (1 - margin / 100) : total;
  const menuVat = selling * 1.24;
  const portions = Number(recipe.portionYield) || 1;
  const perPortion = menuVat / portions;

  const html = `<!DOCTYPE html>
<html lang="${locale === "gr" ? "el" : "en"}">
<head>
<meta charset="UTF-8">
<title>${recipe.name}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, sans-serif; font-size: 11px; color: #111; padding: 20mm; }
  h1 { font-size: 20px; margin-bottom: 2px; }
  .sub { color: #666; font-size: 12px; margin-bottom: 16px; }
  .section { margin-bottom: 16px; }
  .section-title { font-size: 12px; font-weight: bold; text-transform: uppercase;
    letter-spacing: 0.05em; color: #444; border-bottom: 1px solid #ccc;
    padding-bottom: 3px; margin-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #f0f0f0; font-size: 10px; text-align: left; padding: 4px 6px; }
  td { padding: 4px 6px; border-bottom: 1px solid #eee; }
  .cost-grid { display: grid; grid-template-columns: repeat(4,1fr); gap: 8px; }
  .cost-box { border: 1px solid #ddd; border-radius: 4px; padding: 8px; text-align: center; }
  .cost-box .label { font-size: 9px; color: #666; text-transform: uppercase; }
  .cost-box .value { font-size: 15px; font-weight: bold; margin-top: 2px; }
  .allergen-tag { display:inline-block; background:#fee2e2; color:#991b1b;
    border-radius:3px; padding:1px 6px; font-size:9px; margin:2px; }
  .guide { white-space: pre-wrap; font-size: 11px; line-height: 1.6; }
  .footer { margin-top: 20px; font-size: 9px; color: #aaa; text-align: right; }
  @media print {
    @page { margin: 15mm; size: A4; }
    body { padding: 0; }
  }
</style>
</head>
<body>
<h1>${recipe.name}${recipe.nameEn ? ` <span style="font-size:13px;color:#666">/ ${recipe.nameEn}</span>` : ""}</h1>
<div class="sub">
  ${locale === "gr" ? "Μερίδες" : "Portions"}: <strong>${recipe.portionYield} ${recipe.portionUnit}</strong>
  &nbsp;·&nbsp; ${locale === "gr" ? "Περιθώριο" : "Margin"}: <strong>${recipe.profitMarginPercent}%</strong>
</div>

<div class="section">
  <div class="section-title">🧂 ${locale === "gr" ? "Υλικά" : "Ingredients"}</div>
  <table>
    <thead><tr>
      <th>#</th>
      <th>${locale === "gr" ? "Υλικό" : "Ingredient"}</th>
      <th style="text-align:right">${locale === "gr" ? "Ποσότητα" : "Qty"}</th>
      <th>${locale === "gr" ? "Μον." : "Unit"}</th>
      <th style="text-align:right">${locale === "gr" ? "Τιμή/μον." : "Unit Cost"}</th>
      <th style="text-align:right">${locale === "gr" ? "Σύνολο" : "Total"}</th>
    </tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr>
      <td colspan="5" style="text-align:right;font-weight:bold;padding-top:6px">
        ${locale === "gr" ? "Κόστος Υλικών" : "Raw Material"}:
      </td>
      <td style="font-weight:bold;padding-top:6px">€${totalRaw.toFixed(2)}</td>
    </tr></tfoot>
  </table>
</div>

<div class="section">
  <div class="section-title">🧮 ${locale === "gr" ? "Κοστολόγηση" : "Costing"}</div>
  <div class="cost-grid">
    <div class="cost-box">
      <div class="label">${locale === "gr" ? "Κόστος Υλικών" : "Raw Material"}</div>
      <div class="value">€${totalRaw.toFixed(2)}</div>
    </div>
    <div class="cost-box">
      <div class="label">${locale === "gr" ? "Συνολικό Κόστος" : "Total Cost"}</div>
      <div class="value">€${total.toFixed(2)}</div>
    </div>
    <div class="cost-box" style="border-color:#10b981">
      <div class="label">${locale === "gr" ? "Τιμή Πώλησης" : "Selling Price"}</div>
      <div class="value" style="color:#059669">€${selling.toFixed(2)}</div>
    </div>
    <div class="cost-box" style="border-color:#3b82f6">
      <div class="label">${locale === "gr" ? "Τιμή/Μερίδα (ΦΠΑ)" : "Price/Portion (VAT)"}</div>
      <div class="value" style="color:#2563eb">€${perPortion.toFixed(2)}</div>
    </div>
  </div>
</div>

${allergens.length > 0 ? `
<div class="section">
  <div class="section-title">⚠️ ${locale === "gr" ? "Αλλεργίες" : "Allergens"}</div>
  ${allergens.map((a) => `<span class="allergen-tag">${a}</span>`).join("")}
</div>` : ""}

${recipe.technicalGuide ? `
<div class="section">
  <div class="section-title">📋 ${locale === "gr" ? "Τεχνικός Οδηγός" : "Technical Guide"}</div>
  <div class="guide">${recipe.technicalGuide.replace(/</g,"&lt;")}</div>
</div>` : ""}

<div class="footer">
  ${locale === "gr" ? "Εκτυπώθηκε" : "Printed"}: ${new Date().toLocaleDateString(locale === "gr" ? "el-GR" : "en-GB")}
</div>
<script>window.onload = () => window.print();</script>
</body></html>`;

  const win = window.open("", "_blank");
  if (win) { win.document.write(html); win.document.close(); }
}

const ALLERGEN_LIST = [
  "gluten","dairy","eggs","fish","shellfish","nuts",
  "peanuts","soy","sesame","celery","mustard","lupin","molluscs","sulphites",
];

// ─── Τύποι ────────────────────────────────────────────────────────────────────

interface DraftIngredient {
  /** Μοναδικό key μόνο για το UI (δεν αποθηκεύεται) */
  _key: string;
  productName: string;
  unit: string;
  unitCost: number;
  supplierName: string | null;
  quantity: number;
  totalCost: number;
}

interface RecipeFormState {
  name: string;
  nameEn: string;
  portionYield: string;
  portionUnit: string;
  allergens: string[];
  technicalGuide: string;
  laborCost: string;
  overheadCost: string;
  profitMarginPercent: string;
}

// ─── Βοηθητικά ────────────────────────────────────────────────────────────────

function calcCosting(items: DraftIngredient[], laborCost: number, overheadCost: number, margin: number, portions: number) {
  const rawMaterial = items.reduce((s, i) => s + i.totalCost, 0);
  const total = rawMaterial + laborCost + overheadCost;
  const selling = margin < 100 ? total / (1 - margin / 100) : total;
  const menuVat = selling * 1.24;
  const menuFinal = portions > 0 ? menuVat / portions : menuVat;
  return { rawMaterial, total, selling, menuVat, menuFinal };
}

const EMPTY_FORM: RecipeFormState = {
  name: "", nameEn: "", portionYield: "1", portionUnit: "pcs",
  allergens: [], technicalGuide: "",
  laborCost: "0", overheadCost: "0", profitMarginPercent: "60",
};

// ─── Κύριο Component ──────────────────────────────────────────────────────────

export default function RecipePage() {
  const { t, locale, data, refreshAll } = useLanguage();
  const recipes = data.recipes;

  // Views
  const [view, setView] = useState<"list" | "form">("list");
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null);

  // Form state
  const [form, setForm] = useState<RecipeFormState>(EMPTY_FORM);

  // Υλικά: draft λίστα (live στο form, αποθηκεύεται μαζί με τη συνταγή)
  const [draftItems, setDraftItems] = useState<DraftIngredient[]>([]);

  // Αναζήτηση υλικών από order_items
  const [ingSearch, setIngSearch] = useState("");
  const [ingResults, setIngResults] = useState<OrderItem[]>([]);
  const [ingLoading, setIngLoading] = useState(false);
  const [showIngDropdown, setShowIngDropdown] = useState(false);
  const [dropdownRect, setDropdownRect] = useState<DOMRect | null>(null);
  const ingSearchRef = useRef<HTMLDivElement>(null);
  const ingInputRef = useRef<HTMLInputElement>(null);
  const ingDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Saving
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // Search modal
  const [showSearch, setShowSearch] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  // ─── Κλείσιμο dropdown με κλικ έξω ─────────────────────────────────────────

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ingSearchRef.current && !ingSearchRef.current.contains(e.target as Node)) {
        setShowIngDropdown(false);
      }
    }
    // Ανανέωση θέσης dropdown κατά scroll/resize
    function updateRect() {
      if (ingInputRef.current && showIngDropdown) {
        setDropdownRect(ingInputRef.current.getBoundingClientRect());
      }
    }
    document.addEventListener("mousedown", handle);
    window.addEventListener("scroll", updateRect, true);
    window.addEventListener("resize", updateRect);
    return () => {
      document.removeEventListener("mousedown", handle);
      window.removeEventListener("scroll", updateRect, true);
      window.removeEventListener("resize", updateRect);
    };
  }, [showIngDropdown]);

  // ─── Αναζήτηση υλικών από order_items (με debounce) ─────────────────────────

  function openDropdown() {
    if (ingInputRef.current) setDropdownRect(ingInputRef.current.getBoundingClientRect());
    setShowIngDropdown(true);
  }

  function handleIngSearchChange(val: string) {
    setIngSearch(val);
    if (val.trim()) openDropdown();
    else setShowIngDropdown(false);
    if (ingDebounce.current) clearTimeout(ingDebounce.current);
    if (!val.trim()) { setIngResults([]); return; }
    // Server-side ILIKE — δεν φορτώνουμε ολόκληρο τον πίνακα
    ingDebounce.current = setTimeout(async () => {
      setIngLoading(true);
      try {
        const results = await db.searchOrderItemsByName(val);
        setIngResults(results);
      } catch {
        setIngResults([]);
      } finally {
        setIngLoading(false);
      }
    }, 300);
  }

  // ─── Προσθήκη υλικού από order_items στη draft λίστα ────────────────────────

  function addIngredientFromOrderItem(item: OrderItem) {
    const key = crypto.randomUUID();
    const unitCost = Number(item.basePrice ?? 0);
    setDraftItems((prev) => [
      ...prev,
      {
        _key: key,
        productName: item.productName,
        unit: item.unit,
        unitCost,
        supplierName: item.supplierName ?? null,
        quantity: 0,
        totalCost: 0,
      },
    ]);
    setIngSearch("");
    setShowIngDropdown(false);
    setIngResults([]);
  }

  // ─── Ενημέρωση γραμμής υλικού ───────────────────────────────────────────────

  function updateDraftItem(key: string, field: "quantity" | "unitCost", val: number) {
    setDraftItems((prev) =>
      prev.map((item) => {
        if (item._key !== key) return item;
        const q = field === "quantity" ? val : item.quantity;
        const c = field === "unitCost" ? val : item.unitCost;
        return { ...item, [field]: val, totalCost: parseFloat((q * c).toFixed(4)) };
      })
    );
  }

  function removeDraftItem(key: string) {
    setDraftItems((prev) => prev.filter((i) => i._key !== key));
  }

  // ─── Costing (υπολογίζεται live) ────────────────────────────────────────────

  const costing = useMemo(() =>
    calcCosting(
      draftItems,
      Number(form.laborCost),
      Number(form.overheadCost),
      Number(form.profitMarginPercent),
      Number(form.portionYield) || 1,
    ),
    [draftItems, form.laborCost, form.overheadCost, form.profitMarginPercent, form.portionYield]
  );

  // ─── Νέα συνταγή ─────────────────────────────────────────────────────────────

  function newRecipe() {
    setSelectedRecipe(null);
    setForm(EMPTY_FORM);
    setDraftItems([]);
    setView("form");
  }

  // ─── Φόρτωση υπάρχουσας συνταγής ─────────────────────────────────────────────

  function loadRecipe(r: Recipe) {
    setSelectedRecipe(r);
    setForm({
      name: r.name,
      nameEn: r.nameEn || "",
      portionYield: r.portionYield,
      portionUnit: r.portionUnit,
      allergens: typeof r.allergens === "string" ? JSON.parse(r.allergens || "[]") : (r.allergens || []) as string[],
      technicalGuide: r.technicalGuide || "",
      laborCost: r.laborCost,
      overheadCost: r.overheadCost,
      profitMarginPercent: r.profitMarginPercent,
    });
    // Φόρτωσε τα υπάρχοντα υλικά ως draft items
    setDraftItems(
      (r.ingredients || []).map((ing) => ({
        _key: crypto.randomUUID(),
        productName: ing.ingredientName,
        unit: ing.unit,
        unitCost: Number(ing.unitCost),
        supplierName: null,
        quantity: Number(ing.quantity),
        totalCost: Number(ing.totalCost),
      }))
    );
    setView("form");
  }

  // ─── Αποθήκευση συνταγής + υλικών ────────────────────────────────────────────

  async function saveRecipe() {
    if (!form.name.trim()) {
      alert(locale === "gr" ? "Συμπλήρωσε το όνομα συνταγής." : "Please fill in the recipe name.");
      return;
    }
    setSaving(true);
    try {
      const details = {
        name: form.name.trim(),
        nameEn: form.nameEn.trim() || null,
        portionYield: form.portionYield,
        portionUnit: form.portionUnit,
        allergens: JSON.stringify(form.allergens),
        technicalGuide: form.technicalGuide || null,
        totalRawMaterialCost: costing.rawMaterial.toFixed(2),
        laborCost: form.laborCost,
        overheadCost: form.overheadCost,
        totalCost: costing.total.toFixed(2),
        profitMarginPercent: form.profitMarginPercent,
        sellingPrice: costing.selling.toFixed(2),
        menuPriceVat: costing.menuVat.toFixed(2),
        menuPriceFinal: costing.menuFinal.toFixed(2),
        isActive: true,
      };

      let recipeId: number;
      if (selectedRecipe?.id) {
        await db.updateRecipeDetails(selectedRecipe.id, details);
        recipeId = selectedRecipe.id;
        // Διέγραψε παλιά υλικά και ξαναγράψε
        for (const old of selectedRecipe.ingredients || []) {
          if (old.id) await db.deleteRecipeIngredient(old.id).catch(() => {});
        }
      } else {
        recipeId = await db.createRecipeDetails(details);
      }

      // Αποθήκευσε τα draft υλικά ως recipe_ingredients
      for (const item of draftItems) {
        await db.addRecipeIngredient(recipeId, {
          ingredientId: 0, // δεν απαιτείται ingredient_id — χρησιμοποιούμε productName
          ingredientName: item.productName,
          quantity: item.quantity,
          unit: item.unit,
          unitCost: item.unitCost,
          totalCost: item.totalCost,
          wastageFactor: 1,
          requiresPrep: false,
          prepNotes: "",
        });
      }

      await refreshAll();
      setView("list");
      setSelectedRecipe(null);
    } catch (err) {
      alert((locale === "gr" ? "Αποτυχία αποθήκευσης: " : "Failed to save: ") + String(err));
    } finally {
      setSaving(false);
    }
  }

  // ─── Διαγραφή συνταγής ───────────────────────────────────────────────────────

  async function deleteRecipe(id: number) {
    if (!confirm(locale === "gr" ? "Διαγραφή συνταγής;" : "Delete recipe?")) return;
    setDeletingId(id);
    try {
      await db.deleteRecipe(id);
      await refreshAll();
      if (selectedRecipe?.id === id) { setSelectedRecipe(null); setView("list"); }
    } catch (err) {
      alert((locale === "gr" ? "Αποτυχία διαγραφής: " : "Failed to delete: ") + String(err));
    } finally {
      setDeletingId(null);
    }
  }

  // ─── Filtered search ──────────────────────────────────────────────────────────

  const filteredRecipes = useMemo(() => {
    if (!searchTerm.trim()) return recipes;
    const q = searchTerm.trim().toLowerCase();
    return recipes.filter((r) =>
      r?.name?.toLowerCase().includes(q) || (r?.nameEn && r.nameEn.toLowerCase().includes(q))
    );
  }, [recipes, searchTerm]);

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div>
      <PageHeader
        title={locale === "gr" ? "Συνταγές" : "Recipes"}
        subtitle={locale === "gr" ? "Δημιουργία & Διαχείριση Συνταγών" : "Create & Manage Recipes"}
      >
        {view === "list" ? (
          <>
            <button onClick={() => setShowSearch(true)} className="erp-btn-secondary">
              🔍 {locale === "gr" ? "Αναζήτηση" : "Search"}
            </button>
            <button onClick={newRecipe} className="erp-btn-primary">
              ➕ {locale === "gr" ? "Νέα Συνταγή" : "New Recipe"}
            </button>
          </>
        ) : (
          <>
            <button onClick={() => setView("list")} className="erp-btn-ghost">
              ← {locale === "gr" ? "Πίσω" : "Back"}
            </button>
            {selectedRecipe && (
              <>
                <button
                  onClick={() => exportRecipeIngredients(selectedRecipe, draftItems, locale, costing)}
                  className="erp-btn-secondary"
                >
                  📊 Excel
                </button>
                <button
                  onClick={() => printRecipePDF(selectedRecipe, draftItems, locale)}
                  className="erp-btn-secondary"
                >
                  🖨️ PDF
                </button>
              </>
            )}
            <button onClick={saveRecipe} disabled={saving} className="erp-btn-success">
              {saving ? "…" : "💾"} {locale === "gr" ? "Αποθήκευση" : "Save"}
            </button>
          </>
        )}
      </PageHeader>

      {/* ── LIST VIEW ─────────────────────────────────────────────────────── */}
      {view === "list" && (
        <div className="erp-card">
          <div className="erp-card-header">
            <h3 className="font-semibold">
              📋 {locale === "gr" ? "Αρχείο Συνταγών" : "Recipe Archive"} — {recipes.length}
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="erp-table">
              <thead>
                <tr>
                  <th>{locale === "gr" ? "Όνομα" : "Name"}</th>
                  <th>{locale === "gr" ? "Κόστος Υλικών" : "Ingredient Cost"}</th>
                  <th>{locale === "gr" ? "Τιμή Πώλησης" : "Selling Price"}</th>
                  <th>{locale === "gr" ? "Μερίδες" : "Portions"}</th>
                  <th>{locale === "gr" ? "Περιθώριο" : "Margin"}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {recipes.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-10 text-slate-400">
                      {locale === "gr" ? "Δεν υπάρχουν συνταγές" : "No recipes yet"}
                    </td>
                  </tr>
                ) : recipes.map((r, idx) => (
                  <tr key={r?.id ?? idx}>
                    <td
                      className="cursor-pointer hover:text-blue-600 font-medium"
                      onClick={() => loadRecipe(r)}
                    >
                      {r?.name ?? "—"}
                      {r?.nameEn && (
                        <div className="text-xs text-slate-400 font-normal">{r.nameEn}</div>
                      )}
                    </td>
                    <td>€{Number(r?.totalRawMaterialCost ?? 0).toFixed(2)}</td>
                    <td className="font-semibold text-emerald-700">
                      €{Number(r?.sellingPrice ?? 0).toFixed(2)}
                    </td>
                    <td>{r?.portionYield} {r?.portionUnit}</td>
                    <td><Badge color="amber">{r?.profitMarginPercent}%</Badge></td>
                    <td>
                      <button
                        onClick={(e) => { e.stopPropagation(); r?.id && deleteRecipe(r.id); }}
                        disabled={deletingId === r?.id}
                        className="text-red-400 hover:text-red-600 text-xs"
                      >
                        {deletingId === r?.id ? "…" : locale === "gr" ? "Διαγραφή" : "Delete"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── FORM VIEW ─────────────────────────────────────────────────────── */}
      {view === "form" && (
        <div className="space-y-6">

          {/* Στοιχεία Συνταγής */}
          <div className="erp-card">
            <div className="erp-card-header">
              <h3 className="font-semibold">👨‍🍳 {locale === "gr" ? "Στοιχεία Συνταγής" : "Recipe Details"}</h3>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="erp-label">{locale === "gr" ? "Ονομασία (ΕΛ)" : "Name (GR)"}</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="erp-input"
                    placeholder={locale === "gr" ? "π.χ. Κοτόπουλο σχάρας" : "e.g. Grilled chicken"}
                  />
                </div>
                <div>
                  <label className="erp-label">Name (EN)</label>
                  <input
                    type="text"
                    value={form.nameEn}
                    onChange={(e) => setForm({ ...form, nameEn: e.target.value })}
                    className="erp-input"
                    placeholder="e.g. Grilled chicken"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <label className="erp-label">{locale === "gr" ? "Μερίδες" : "Portions"}</label>
                  <input
                    type="number"
                    value={form.portionYield}
                    onChange={(e) => setForm({ ...form, portionYield: e.target.value })}
                    className="erp-input"
                    step="0.1"
                    min="0"
                  />
                </div>
                <div>
                  <label className="erp-label">{locale === "gr" ? "Μονάδα" : "Unit"}</label>
                  <select
                    value={form.portionUnit}
                    onChange={(e) => setForm({ ...form, portionUnit: e.target.value })}
                    className="erp-select"
                  >
                    <option value="pcs">{locale === "gr" ? "Μερίδες" : "Portions"}</option>
                    <option value="kg">kg</option>
                    <option value="L">L</option>
                  </select>
                </div>
                <div>
                  <label className="erp-label">{locale === "gr" ? "Κόστος Εργασίας €" : "Labor Cost €"}</label>
                  <input
                    type="number"
                    value={form.laborCost}
                    onChange={(e) => setForm({ ...form, laborCost: e.target.value })}
                    className="erp-input"
                    step="0.01"
                    min="0"
                  />
                </div>
                <div>
                  <label className="erp-label">{locale === "gr" ? "Γεν. Έξοδα €" : "Overhead €"}</label>
                  <input
                    type="number"
                    value={form.overheadCost}
                    onChange={(e) => setForm({ ...form, overheadCost: e.target.value })}
                    className="erp-input"
                    step="0.01"
                    min="0"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="erp-label">{locale === "gr" ? "Περιθώριο Κέρδους %" : "Profit Margin %"}</label>
                  <input
                    type="number"
                    value={form.profitMarginPercent}
                    onChange={(e) => setForm({ ...form, profitMarginPercent: e.target.value })}
                    className="erp-input"
                    step="1"
                    min="0"
                    max="99"
                  />
                </div>
              </div>

              {/* Αλλεργίες */}
              <div>
                <label className="erp-label">{locale === "gr" ? "Αλλεργίες" : "Allergens"}</label>
                <div className="flex flex-wrap gap-2 mt-1">
                  {ALLERGEN_LIST.map((a) => (
                    <button
                      key={a}
                      type="button"
                      onClick={() =>
                        setForm((prev) => ({
                          ...prev,
                          allergens: prev.allergens.includes(a)
                            ? prev.allergens.filter((x) => x !== a)
                            : [...prev.allergens, a],
                        }))
                      }
                      className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                        form.allergens.includes(a)
                          ? "bg-red-500 text-white"
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      }`}
                    >
                      {a}
                    </button>
                  ))}
                </div>
              </div>

              {/* Τεχνικός Οδηγός */}
              <div>
                <label className="erp-label">{locale === "gr" ? "Τεχνικός Οδηγός" : "Technical Guide"}</label>
                <textarea
                  value={form.technicalGuide}
                  onChange={(e) => setForm({ ...form, technicalGuide: e.target.value })}
                  className="erp-input min-h-[100px] font-mono text-sm"
                  placeholder={locale === "gr" ? "Βήμα 1: …\nΒήμα 2: …" : "Step 1: …\nStep 2: …"}
                />
              </div>
            </div>
          </div>

          {/* Υλικά Συνταγής */}
          <div className="erp-card">
            <div className="erp-card-header flex items-center justify-between">
              <h3 className="font-semibold">
                🧂 {locale === "gr" ? "Υλικά Συνταγής" : "Recipe Ingredients"}
              </h3>
              {/* Search box — αναζήτηση μόνο από Ιστορικό Παραγγελιών */}
              <div ref={ingSearchRef}>
                <input
                  ref={ingInputRef}
                  type="text"
                  value={ingSearch}
                  onChange={(e) => handleIngSearchChange(e.target.value)}
                  onFocus={() => { if (ingSearch.trim()) openDropdown(); }}
                  placeholder={locale === "gr" ? "🔍 Αναζήτηση από παραγγελίες…" : "🔍 Search from orders…"}
                  className="erp-input text-xs py-1.5 w-72"
                  autoComplete="off"
                />
                {/* Portal — βγαίνει έξω από κάθε overflow:hidden container */}
                {showIngDropdown && dropdownRect && typeof document !== "undefined" && createPortal(
                  <div
                    style={{
                      position: "fixed",
                      top: dropdownRect.bottom + 4,
                      right: window.innerWidth - dropdownRect.right,
                      width: Math.max(dropdownRect.width, 420),
                      zIndex: 9999,
                    }}
                    className="max-h-80 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-2xl"
                  >
                    {ingLoading ? (
                      <div className="px-4 py-3 text-xs text-slate-400 text-center">
                        {locale === "gr" ? "Αναζήτηση…" : "Searching…"}
                      </div>
                    ) : ingResults.length === 0 ? (
                      <div className="px-4 py-3 text-xs text-slate-400 text-center">
                        {locale === "gr" ? "Δεν βρέθηκαν αποτελέσματα στο ιστορικό παραγγελιών" : "No results found in order history"}
                      </div>
                    ) : (
                      ingResults.map((item) => (
                        <div
                          key={item.id}
                          onMouseDown={(e) => { e.preventDefault(); addIngredientFromOrderItem(item); }}
                          className="px-4 py-2.5 cursor-pointer hover:bg-blue-50 border-b border-slate-50 last:border-0"
                        >
                          <div className="font-medium text-sm text-slate-800">{item.productName}</div>
                          <div className="text-xs text-slate-400 mt-0.5">
                            €{Number(item.basePrice).toFixed(2)}/{item.unit}
                            {item.supplierName && (
                              <span className="ml-2 text-blue-500 font-medium">{item.supplierName}</span>
                            )}
                            {item.orderDate && (
                              <span className="ml-2 text-slate-300">{item.orderDate.slice(0, 10)}</span>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>,
                  document.body
                )}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="erp-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>{locale === "gr" ? "Προϊόν" : "Product"}</th>
                    <th>{locale === "gr" ? "Προμηθευτής" : "Supplier"}</th>
                    <th>{locale === "gr" ? "Ποσότητα" : "Qty"}</th>
                    <th>{locale === "gr" ? "Μονάδα" : "Unit"}</th>
                    <th>{locale === "gr" ? "Τιμή/μον." : "Unit Cost"}</th>
                    <th>{locale === "gr" ? "Σύνολο" : "Total"}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {draftItems.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="text-center py-8 text-slate-400 text-sm">
                        {locale === "gr"
                          ? "Αναζήτησε υλικά από το ιστορικό παραγγελιών →"
                          : "Search ingredients from order history →"}
                      </td>
                    </tr>
                  ) : (
                    draftItems.map((item, i) => (
                      <tr key={item._key}>
                        <td className="text-xs text-slate-400">{i + 1}</td>
                        <td className="font-medium text-sm">{item.productName}</td>
                        <td className="text-xs text-blue-600">{item.supplierName ?? "—"}</td>
                        <td>
                          <input
                            type="number"
                            value={item.quantity === 0 ? "" : item.quantity}
                            onChange={(e) =>
                              updateDraftItem(item._key, "quantity", parseFloat(e.target.value) || 0)
                            }
                            className="erp-input text-xs py-1 w-20"
                            step="0.001"
                            min="0"
                            placeholder="0"
                          />
                        </td>
                        <td className="text-sm">{item.unit}</td>
                        <td>
                          <input
                            type="number"
                            value={item.unitCost}
                            onChange={(e) =>
                              updateDraftItem(item._key, "unitCost", parseFloat(e.target.value) || 0)
                            }
                            className="erp-input text-xs py-1 w-24"
                            step="0.0001"
                            min="0"
                          />
                        </td>
                        <td className="font-semibold">€{item.totalCost.toFixed(3)}</td>
                        <td>
                          <button
                            onClick={() => removeDraftItem(item._key)}
                            className="text-red-400 hover:text-red-600 text-sm"
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Σύνοψη Κόστους */}
          <div className="erp-card">
            <div className="erp-card-header">
              <h3 className="font-semibold">🧮 {locale === "gr" ? "Κοστολόγηση" : "Costing"}</h3>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
                <div className="bg-slate-50 rounded-lg p-3 text-center">
                  <div className="text-xs text-slate-500 mb-1">{locale === "gr" ? "Κόστος Υλικών" : "Raw Material"}</div>
                  <div className="font-bold text-slate-800">€{costing.rawMaterial.toFixed(2)}</div>
                </div>
                <div className="bg-slate-50 rounded-lg p-3 text-center">
                  <div className="text-xs text-slate-500 mb-1">{locale === "gr" ? "Συνολικό Κόστος" : "Total Cost"}</div>
                  <div className="font-bold text-slate-800">€{costing.total.toFixed(2)}</div>
                </div>
                <div className="bg-emerald-50 rounded-lg p-3 text-center">
                  <div className="text-xs text-emerald-600 mb-1">{locale === "gr" ? "Τιμή Πώλησης" : "Selling Price"}</div>
                  <div className="font-bold text-emerald-700">€{costing.selling.toFixed(2)}</div>
                </div>
                <div className="bg-blue-50 rounded-lg p-3 text-center">
                  <div className="text-xs text-blue-600 mb-1">{locale === "gr" ? "Τιμή Μενού (ΦΠΑ 24%)" : "Menu Price (VAT 24%)"}</div>
                  <div className="font-bold text-blue-700">€{costing.menuVat.toFixed(2)}</div>
                </div>
                <div className="bg-amber-50 rounded-lg p-3 text-center">
                  <div className="text-xs text-amber-600 mb-1">{locale === "gr" ? "Τιμή ανά Μερίδα" : "Price per Portion"}</div>
                  <div className="font-bold text-amber-700">€{costing.menuFinal.toFixed(2)}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Αποθήκευση */}
          <div className="flex justify-between items-center pb-6">
            <div className="flex gap-2">
              <button
                onClick={() => {
                  if (selectedRecipe) exportRecipeIngredients(selectedRecipe, draftItems, locale, costing);
                  else alert(locale === "gr" ? "Αποθήκευσε πρώτα τη συνταγή." : "Save the recipe first.");
                }}
                className="erp-btn-secondary"
              >
                📊 {locale === "gr" ? "Excel" : "Excel"}
              </button>
              <button
                onClick={() => {
                  if (selectedRecipe) printRecipePDF(selectedRecipe, draftItems, locale);
                  else alert(locale === "gr" ? "Αποθήκευσε πρώτα τη συνταγή." : "Save the recipe first.");
                }}
                className="erp-btn-secondary"
              >
                🖨️ {locale === "gr" ? "PDF / Εκτύπωση" : "Print / PDF"}
              </button>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setView("list")} className="erp-btn-ghost">
                {locale === "gr" ? "Ακύρωση" : "Cancel"}
              </button>
              <button onClick={saveRecipe} disabled={saving} className="erp-btn-success px-8">
                {saving ? "…" : "💾"} {locale === "gr" ? "Αποθήκευση Συνταγής" : "Save Recipe"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Search Modal */}
      <Modal
        isOpen={showSearch}
        onClose={() => setShowSearch(false)}
        title={locale === "gr" ? "Αναζήτηση Συνταγής" : "Search Recipe"}
        size="lg"
      >
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder={locale === "gr" ? "Πληκτρολόγησε όνομα…" : "Type name…"}
          className="erp-input mb-4"
          autoFocus
        />
        <div className="space-y-1 max-h-[350px] overflow-y-auto">
          {filteredRecipes.length === 0 ? (
            <div className="py-6 text-center text-slate-400 text-sm">
              {locale === "gr" ? "Δεν βρέθηκαν αποτελέσματα" : "No results found"}
            </div>
          ) : filteredRecipes.map((r, idx) => (
            <div
              key={r?.id ?? idx}
              onClick={() => { loadRecipe(r); setShowSearch(false); setSearchTerm(""); }}
              className="p-3 rounded-lg hover:bg-blue-50 cursor-pointer flex items-center justify-between"
            >
              <div>
                <div className="font-medium">{r?.name ?? "—"}</div>
                {r?.nameEn && <div className="text-xs text-slate-400">{r.nameEn}</div>}
              </div>
              <Badge color="green">€{Number(r?.totalCost ?? 0).toFixed(2)}</Badge>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
}
