"use client";
import { useState, useRef, useMemo, useEffect } from "react";
import { useLanguage } from "@/lib/context";
import { PageHeader, Badge, Modal } from "@/components/shared";
import type { Recipe } from "@/lib/types";
import * as db from "@/lib/supabaseData";

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
  const [ingResults, setIngResults] = useState<db.OrderItem[]>([]);
  const [ingLoading, setIngLoading] = useState(false);
  const [showIngDropdown, setShowIngDropdown] = useState(false);
  const ingSearchRef = useRef<HTMLDivElement>(null);
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
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  // ─── Αναζήτηση υλικών από order_items (με debounce) ─────────────────────────

  function handleIngSearchChange(val: string) {
    setIngSearch(val);
    setShowIngDropdown(!!val.trim());
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

  function addIngredientFromOrderItem(item: db.OrderItem) {
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
        const created = await db.createRecipeDetails(details);
        recipeId = created.id;
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
              <div className="relative" ref={ingSearchRef}>
                <input
                  type="text"
                  value={ingSearch}
                  onChange={(e) => handleIngSearchChange(e.target.value)}
                  onFocus={() => { if (ingSearch.trim()) setShowIngDropdown(true); }}
                  placeholder={locale === "gr" ? "🔍 Αναζήτηση από παραγγελίες…" : "🔍 Search from orders…"}
                  className="erp-input text-xs py-1.5 w-64"
                  autoComplete="off"
                />
                {showIngDropdown && (
                  <div className="absolute right-0 z-30 mt-1 w-96 max-h-72 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-2xl">
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
                          onClick={() => addIngredientFromOrderItem(item)}
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
                  </div>
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
          <div className="flex justify-end gap-3 pb-6">
            <button onClick={() => setView("list")} className="erp-btn-ghost">
              {locale === "gr" ? "Ακύρωση" : "Cancel"}
            </button>
            <button onClick={saveRecipe} disabled={saving} className="erp-btn-success px-8">
              {saving ? "…" : "💾"} {locale === "gr" ? "Αποθήκευση Συνταγής" : "Save Recipe"}
            </button>
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
