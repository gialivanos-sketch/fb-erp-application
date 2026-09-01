"use client";
import { useState, useRef, useMemo, useEffect } from "react";
import { useLanguage } from "@/lib/context";
import { PageHeader, Badge, Modal } from "@/components/shared";
import type { Recipe, RecipeIngredient } from "@/lib/types";
import * as db from "@/lib/supabaseData";
import { parseSpreadsheetFile, rowsToObjects, pick, exportRowsToExcel } from "@/lib/csv";

const ALLERGEN_LIST = ["gluten","dairy","eggs","fish","shellfish","nuts","peanuts","soy","sesame","celery","mustard","lupin","molluscs","sulphites"];

interface RecipeFormState {
  name: string;
  nameEn: string;
  portionYield: string;
  portionUnit: string;
  allergens: string[];
  technicalGuide: string;
  totalRawMaterialCost: string;
  laborCost: string;
  overheadCost: string;
  totalCost: string;
  profitMarginPercent: string;
  sellingPrice: string;
  menuPriceVat: string;
  menuPriceFinal: string;
  caloriesPerPortion: string;
  gramsPerPortion: string;
}

export default function RecipePage() {
  const { t, locale, data, refreshAll } = useLanguage();
  const recipes = data.recipes;
  const allIngredients = data.ingredients;
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [form, setForm] = useState<RecipeFormState>({
    name: "", nameEn: "", portionYield: "1", portionUnit: "pcs",
    allergens: [], technicalGuide: "",
    totalRawMaterialCost: "0", laborCost: "0", overheadCost: "0",
    totalCost: "0", profitMarginPercent: "60", sellingPrice: "0",
    menuPriceVat: "0", menuPriceFinal: "0",
    caloriesPerPortion: "0", gramsPerPortion: "0",
  });
  const [recipeItems, setRecipeItems] = useState<RecipeIngredient[]>([]);
  const [showSearch, setShowSearch] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  // Αναζήτηση υλικού με πληκτρολόγηση + dropdown, για προσθήκη υλικού
  // απευθείας μέσα στη φόρμα συνταγής (ενοποιημένη ξανά, κατόπιν
  // ρητού αιτήματος του χρήστη να ακυρωθεί ο χωρισμός σε σελίδες).
  const [ingredientSearchTerm, setIngredientSearchTerm] = useState("");
  const [showIngredientSearch, setShowIngredientSearch] = useState(false);
  const [savingIngredientRowId, setSavingIngredientRowId] = useState<number | "new" | null>(null);
  const ingredientSearchRef = useRef<HTMLDivElement>(null);

  const ingredientSearchResults = useMemo(() => {
    const q = ingredientSearchTerm.trim().toLowerCase();
    if (!q) return [];
    return allIngredients
      .filter((ing) => {
        const name = (locale === "gr" ? ing.name : (ing.nameEn || ing.name)).toLowerCase();
        return name.includes(q) || ing.sku.toLowerCase().includes(q);
      })
      .slice(0, 20);
  }, [ingredientSearchTerm, allIngredients, locale]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ingredientSearchRef.current && !ingredientSearchRef.current.contains(e.target as Node)) {
        setShowIngredientSearch(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);
  // Πλατιά προβολή λίστας: πίνακας με όλες τις συνταγές, checkboxes
  // για πολλαπλή επιλογή (θεμέλιο για μαζικές ενέργειες όπως export
  // ή μαζική διαγραφή). Ξεχωριστό state από το selectedRecipe/editing
  // — η λίστα-πίνακας και η φόρμα επεξεργασίας δεν είναι ποτέ ορατές
  // ταυτόχρονα.
  const [listView, setListView] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const RECIPE_PAGE_SIZE = 100;
  const [recipePage, setRecipePage] = useState(1);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  // Bulk import (1000+ recipes from a single .xlsx/.csv)
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [bulkFile, setBulkFile] = useState<File | null>(null);
  const [bulkImporting, setBulkImporting] = useState(false);
  const [bulkMsg, setBulkMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const bulkFileInputRef = useRef<HTMLInputElement>(null);

  function newRecipe() {
    setEditing(true);
    setSelectedRecipe(null);
    setForm({ name: "", nameEn: "", portionYield: "1", portionUnit: "pcs", allergens: [], technicalGuide: "", totalRawMaterialCost: "0", laborCost: "0", overheadCost: "0", totalCost: "0", profitMarginPercent: "60", sellingPrice: "0", menuPriceVat: "0", menuPriceFinal: "0", caloriesPerPortion: "0", gramsPerPortion: "0" });
    setRecipeItems([]);
  }

  function loadRecipe(r: Recipe) {
    if (!r) return;
    setSelectedRecipe(r);
    setEditing(true);
    setForm({
      name: r.name, nameEn: r.nameEn || "", portionYield: r.portionYield, portionUnit: r.portionUnit,
      allergens: typeof r.allergens === "string" ? JSON.parse(r.allergens || "[]") : (r.allergens || []) as string[],
      technicalGuide: r.technicalGuide || "",
      totalRawMaterialCost: r.totalRawMaterialCost, laborCost: r.laborCost, overheadCost: r.overheadCost,
      totalCost: r.totalCost, profitMarginPercent: r.profitMarginPercent, sellingPrice: r.sellingPrice,
      menuPriceVat: r.menuPriceVat, menuPriceFinal: r.menuPriceFinal,
      caloriesPerPortion: r.caloriesPerPortion ?? "0", gramsPerPortion: r.gramsPerPortion ?? "0",
    });
    setRecipeItems(r.ingredients || []);
  }

  function calculateCosting() {
    const rawMaterial = recipeItems.reduce((s, i) => s + Number(i.totalCost || 0), 0);
    const labor = Number(form.laborCost);
    const overhead = Number(form.overheadCost);
    const total = rawMaterial + labor + overhead;
    const margin = Number(form.profitMarginPercent);
    const selling = total / (1 - margin / 100);
    const menuVat = selling * 1.24;
    setForm(prev => ({
      ...prev,
      totalRawMaterialCost: rawMaterial.toFixed(2),
      totalCost: total.toFixed(2),
      sellingPrice: selling.toFixed(2),
      menuPriceVat: menuVat.toFixed(2),
      menuPriceFinal: (menuVat / Number(prev.portionYield || 1)).toFixed(2),
    }));
  }

  // Καλείται όταν ο χρήστης διαλέγει ένα υλικό από το αποτέλεσμα
  // αναζήτησης. Γράφει ΑΜΕΣΩΣ στη βάση (addRecipeIngredient) --
  // απαιτεί ότι η συνταγή ήδη υπάρχει (έχει selectedRecipe.id), αφού
  // recipe_ingredients χρειάζεται πραγματικό recipe_id.
  async function addIngredientToRecipe(ing: (typeof allIngredients)[number]) {
    if (!selectedRecipe?.id) return;
    setSavingIngredientRowId("new");
    try {
      let unitCost = Number(ing.basePrice);
      try {
        const price = await db.getIngredientCurrentPrice(ing.id);
        if (price) unitCost = price.unitCost;
      } catch {
        // εφεδρικά η στατική τιμή, αν αποτύχει το αίτημα δυναμικής τιμής
      }
      await db.addRecipeIngredient(selectedRecipe.id, {
        ingredientId: ing.id, ingredientName: locale === "gr" ? ing.name : (ing.nameEn || ing.name),
        quantity: 0, unit: ing.unit, unitCost, totalCost: 0,
        wastageFactor: Number(ing.wastageFactor), requiresPrep: false, prepNotes: "",
      });
      await refreshAll();
      setIngredientSearchTerm("");
      setShowIngredientSearch(false);
    } catch (err) {
      alert(locale === "gr" ? "Αποτυχία προσθήκης: " + String(err) : "Failed to add: " + String(err));
    } finally {
      setSavingIngredientRowId(null);
    }
  }

  async function updateIngredientRow(rowId: number, field: string, value: string | number | boolean) {
    const row = recipeItems.find((i) => i.id === rowId);
    if (!row) return;
    const patch: Record<string, unknown> = { [field]: value };
    if (field === "quantity" || field === "unitCost") {
      const newQuantity = field === "quantity" ? Number(value) : Number(row.quantity);
      const newUnitCost = field === "unitCost" ? Number(value) : Number(row.unitCost);
      patch.totalCost = Number((newQuantity * newUnitCost).toFixed(2));
    }
    setSavingIngredientRowId(rowId);
    try {
      await db.updateRecipeIngredient(rowId, patch);
      await refreshAll();
    } catch (err) {
      alert(locale === "gr" ? "Αποτυχία ενημέρωσης: " + String(err) : "Failed to update: " + String(err));
    } finally {
      setSavingIngredientRowId(null);
    }
  }

  async function deleteIngredientRow(rowId: number) {
    setSavingIngredientRowId(rowId);
    try {
      await db.deleteRecipeIngredient(rowId);
      await refreshAll();
    } catch (err) {
      alert(locale === "gr" ? "Αποτυχία διαγραφής: " + String(err) : "Failed to delete: " + String(err));
    } finally {
      setSavingIngredientRowId(null);
    }
  }

  async function saveRecipe() {
    if (!form.name) return;
    setSaving(true);
    try {
      const details = {
        name: form.name,
        nameEn: form.nameEn || null,
        portionYield: form.portionYield,
        portionUnit: form.portionUnit,
        allergens: JSON.stringify(form.allergens),
        technicalGuide: form.technicalGuide || null,
        totalRawMaterialCost: form.totalRawMaterialCost,
        laborCost: form.laborCost,
        overheadCost: form.overheadCost,
        totalCost: form.totalCost,
        profitMarginPercent: form.profitMarginPercent,
        sellingPrice: form.sellingPrice,
        menuPriceVat: form.menuPriceVat,
        menuPriceFinal: form.menuPriceFinal,
        caloriesPerPortion: form.caloriesPerPortion,
        gramsPerPortion: form.gramsPerPortion,
        isActive: true,
      };
      if (selectedRecipe?.id) {
        await db.updateRecipeDetails(selectedRecipe.id, details);
      } else {
        await db.createRecipeDetails(details);
      }
      await refreshAll();
      setEditing(false);
    } catch (err) {
      alert(locale === "gr" ? "Αποτυχία αποθήκευσης: " + String(err) : "Failed to save: " + String(err));
    } finally {
      setSaving(false);
    }
  }

  async function deleteRecipe(id: number) {
    if (!confirm(t("deleteConfirm"))) return;
    setDeletingId(id);
    try {
      await db.deleteRecipe(id);
      await refreshAll();
      if (selectedRecipe?.id === id) { setSelectedRecipe(null); setEditing(false); }
    } catch (err) {
      alert(locale === "gr" ? "Αποτυχία διαγραφής: " + String(err) : "Failed to delete: " + String(err));
    } finally {
      setDeletingId(null);
    }
  }

  function toggleSelect(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds((prev) =>
      prev.size === recipes.length ? new Set() : new Set(recipes.map((r) => r.id))
    );
  }

  // Μαζική διαγραφή: τα deletes τρέχουν παράλληλα (Promise.all) αφού
  // είναι ανεξάρτητες εγγραφές — δεν υπάρχει λόγος να περιμένει η μία
  // την άλλη διαδοχικά, όπως ήδη κάνουμε στο bulk recipe import.
  async function deleteSelected() {
    if (selectedIds.size === 0) return;
    const label = locale === "gr" ? `Διαγραφή ${selectedIds.size} επιλεγμένων συνταγών;` : `Delete ${selectedIds.size} selected recipes?`;
    if (!confirm(label)) return;
    setBulkDeleting(true);
    try {
      await Promise.all(Array.from(selectedIds).map((id) => db.deleteRecipe(id)));
      await refreshAll();
      setSelectedIds(new Set());
    } catch (err) {
      alert(locale === "gr" ? "Αποτυχία μαζικής διαγραφής: " + String(err) : "Bulk delete failed: " + String(err));
    } finally {
      setBulkDeleting(false);
    }
  }

  // Εξάγει τις επιλεγμένες συνταγές σε .xlsx (ή ΟΛΕΣ, αν καμία δεν
  // είναι επιλεγμένη) -- ίδια στήλες με τον πίνακα που ήδη βλέπει
  // ο χρήστης, ώστε το αρχείο να αντιστοιχεί ακριβώς σε αυτό που
  // περίμενε να κατεβάσει.
  function exportRecipesExcel() {
    const toExport = selectedIds.size > 0 ? recipes.filter((r) => selectedIds.has(r.id)) : recipes;
    if (toExport.length === 0) return;
    const rows = toExport.map((r) => ({
      [locale === "gr" ? "Όνομα" : "Name"]: r.name,
      [locale === "gr" ? "Αγγλικό Όνομα" : "English Name"]: r.nameEn ?? "",
      [locale === "gr" ? "Μερίδες" : "Portions"]: Number(r.portionYield),
      [locale === "gr" ? "Μονάδα" : "Unit"]: r.portionUnit,
      [locale === "gr" ? "Κόστος Υλικών" : "Ingredient Cost"]: Number(r.totalRawMaterialCost),
      [locale === "gr" ? "Συνολικό Κόστος" : "Total Cost"]: Number(r.totalCost),
      [locale === "gr" ? "Τιμή Πώλησης" : "Selling Price"]: Number(r.sellingPrice),
      [locale === "gr" ? "Τιμή Μενού (ΦΠΑ)" : "Menu Price (VAT)"]: Number(r.menuPriceVat),
      [locale === "gr" ? "Περιθώριο %" : "Margin %"]: Number(r.profitMarginPercent),
    }));
    const filename = locale === "gr" ? "συνταγές" : "recipes";
    exportRowsToExcel(rows, filename, locale === "gr" ? "Συνταγές" : "Recipes");
  }

  function openForEdit(r: Recipe) {
    loadRecipe(r);
  }

  // Bulk import: reads a flat .xlsx/.csv where each row is one
  // (recipe, ingredient) pair — exactly the shape of a real recipe
  // catalog export, where a 5-ingredient recipe appears as 5 rows
  // sharing the same recipe name. Handles files with hundreds or
  // thousands of rows in a small, fixed number of network calls
  // (see bulkImportRecipesWithIngredients in supabaseData.ts) rather
  // than one call per recipe, which would be impractically slow for
  // a genuinely large catalog.
  async function handleBulkImport() {
    if (!bulkFile) return;
    setBulkImporting(true);
    setBulkMsg(null);
    try {
      const table = await parseSpreadsheetFile(bulkFile);
      const objs = rowsToObjects(table);
      if (objs.length === 0) {
        setBulkMsg({ kind: "err", text: locale === "gr" ? "Το αρχείο είναι κενό ή μη αναγνώσιμο." : "File is empty or unreadable." });
        return;
      }

      const rows: db.RecipeImportRow[] = [];
      for (const row of objs) {
        const recipeName = pick(row, ["recipename", "όνομασυνταγής", "ονομασυνταγης", "recipe", "συνταγή", "συνταγη"]);
        const ingredientName = pick(row, ["ingredient", "υλικό", "υλικο", "είδος", "ειδος"]);
        if (!recipeName || !ingredientName) continue;
        rows.push({
          recipeName,
          category: pick(row, ["category", "κατηγορία", "κατηγορια"]) || null,
          portions: pick(row, ["portions", "μερίδες", "μεριδες"]) || "1",
          ingredientName,
          quantity: pick(row, ["quantity", "ποσότητα", "ποσοτητα"]) || "0",
          unit: pick(row, ["unit", "μονάδαμέτρησης", "μονάδα", "μεμ"]) || "kg",
          instructions: pick(row, ["instructions", "οδηγίες", "οδηγιες"]) || null,
        });
      }

      if (rows.length === 0) {
        setBulkMsg({
          kind: "err",
          text: locale === "gr"
            ? "⚠️ Δεν αναγνωρίστηκαν στήλες συνταγής/υλικού. Ελέγξτε ότι οι επικεφαλίδες λένε \"Όνομα Συνταγής\" και \"Υλικό\"."
            : "⚠️ No recipe/ingredient columns were recognized. Check that the headers read \"Όνομα Συνταγής\" and \"Υλικό\".",
        });
        return;
      }

      const result = await db.bulkImportRecipesWithIngredients(rows);
      await refreshAll();

      const skippedNote = result.recipesSkipped.length > 0
        ? (locale === "gr"
            ? ` (${result.recipesSkipped.length} συνταγές παραλείφθηκαν λόγω μηδενικών υλικών: ${result.recipesSkipped.slice(0, 5).join(", ")}${result.recipesSkipped.length > 5 ? "…" : ""})`
            : ` (${result.recipesSkipped.length} recipes skipped for having no ingredient rows: ${result.recipesSkipped.slice(0, 5).join(", ")}${result.recipesSkipped.length > 5 ? "…" : ""})`)
        : "";

      setBulkMsg({
        kind: "ok",
        text: locale === "gr"
          ? `✅ ${result.recipesCreated} συνταγές δημιουργήθηκαν, ${result.ingredientLinesInserted} γραμμές υλικών, ${result.ingredientsCreated} νέα υλικά προστέθηκαν στο μητρώο.${skippedNote}`
          : `✅ ${result.recipesCreated} recipes created, ${result.ingredientLinesInserted} ingredient lines, ${result.ingredientsCreated} new ingredients added to the register.${skippedNote}`,
      });
      setTimeout(() => { setShowBulkImport(false); setBulkMsg(null); setBulkFile(null); }, 3500);
    } catch (err) {
      setBulkMsg({ kind: "err", text: locale === "gr" ? "Αποτυχία εισαγωγής: " + String(err) : "Import failed: " + String(err) });
    } finally {
      setBulkImporting(false);
    }
  }

  const recipeTotalPages = Math.max(1, Math.ceil(recipes.length / RECIPE_PAGE_SIZE));
  const recipeSafePage = Math.min(recipePage, recipeTotalPages);
  const paginatedRecipes = recipes.slice((recipeSafePage - 1) * RECIPE_PAGE_SIZE, recipeSafePage * RECIPE_PAGE_SIZE);

  return (
    <div>
      <PageHeader title={t("headerRecipe")} subtitle="Interactive Recipe Composition / Φόρμα Συνταγής">
        <button onClick={() => setListView((v) => !v)} className={listView ? "erp-btn-primary" : "erp-btn-secondary"}>
          📊 {listView ? (locale === "gr" ? "Κανονική Προβολή" : "Normal View") : (locale === "gr" ? "Προβολή Λίστας" : "List View")}
        </button>
        <button onClick={newRecipe} className="erp-btn-primary">➕ {t("btnNewRecipe")}</button>
        <button onClick={() => setShowBulkImport(true)} className="erp-btn-success">📥 {locale === "gr" ? "Μαζική Εισαγωγή Excel" : "Bulk Import Excel"}</button>
      </PageHeader>

      {listView ? (
        <div className="erp-card">
          <div className="erp-card-header flex items-center justify-between">
            <h3 className="font-semibold">📋 {locale === "gr" ? "Αρχείο Συνταγών" : "Recipe Archive"} — {recipes.length} {locale === "gr" ? "συνταγές" : "recipes"}</h3>
            <div className="flex items-center gap-3">
              {selectedIds.size > 0 && (
                <>
                  <Badge color="blue">{selectedIds.size} {locale === "gr" ? "επιλεγμένες" : "selected"}</Badge>
                  <button onClick={deleteSelected} disabled={bulkDeleting} className="erp-btn-danger text-xs px-3 py-1.5">
                    {bulkDeleting ? "…" : "🗑️"} {locale === "gr" ? "Διαγραφή Επιλεγμένων" : "Delete Selected"}
                  </button>
                </>
              )}
              <button onClick={exportRecipesExcel} className="erp-btn-secondary text-xs px-3 py-1.5">
                📊 {selectedIds.size > 0
                  ? (locale === "gr" ? `Εξαγωγή Επιλεγμένων (${selectedIds.size})` : `Export Selected (${selectedIds.size})`)
                  : (locale === "gr" ? "Εξαγωγή Excel" : "Export Excel")}
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="erp-table">
              <thead>
                <tr>
                  <th className="w-10">
                    <input
                      type="checkbox"
                      checked={recipes.length > 0 && selectedIds.size === recipes.length}
                      onChange={toggleSelectAll}
                      className="w-4 h-4"
                    />
                  </th>
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
                  <tr><td colSpan={7} className="text-center py-8 text-slate-400">{t("noData")}</td></tr>
                ) : paginatedRecipes.map((r, idx) => (
                  <tr key={r?.id ?? `recipe-row-${idx}`} className={selectedIds.has(r.id) ? "bg-blue-50/50" : ""}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(r.id)}
                        onChange={() => toggleSelect(r.id)}
                        className="w-4 h-4"
                      />
                    </td>
                    <td className="cursor-pointer hover:text-blue-600 font-medium" onClick={() => openForEdit(r)}>
                      {r?.name ?? "—"}
                      {r?.nameEn && <div className="text-xs text-slate-400 font-normal">{r.nameEn}</div>}
                    </td>
                    <td>€{Number(r?.totalRawMaterialCost ?? 0).toFixed(2)}</td>
                    <td className="font-semibold text-emerald-700">€{Number(r?.sellingPrice ?? 0).toFixed(2)}</td>
                    <td>{r?.portionYield} {r?.portionUnit}</td>
                    <td><Badge color="amber">{r?.profitMarginPercent}%</Badge></td>
                    <td>
                      <button onClick={(e) => { e.stopPropagation(); r?.id && deleteRecipe(r.id); }} disabled={deletingId === r?.id} className="text-red-400 hover:text-red-600 text-xs">
                        {deletingId === r?.id ? "…" : t("btnDelete")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {recipes.length > RECIPE_PAGE_SIZE && (
            <div className="flex items-center justify-between px-4 py-3 border-t text-sm">
              <div className="text-slate-500">
                {locale === "gr" ? `Σελίδα ${recipeSafePage} από ${recipeTotalPages}` : `Page ${recipeSafePage} of ${recipeTotalPages}`}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setRecipePage((p) => Math.max(1, p - 1))}
                  disabled={recipeSafePage <= 1}
                  className="erp-btn-secondary text-xs px-3 py-1.5 disabled:opacity-40"
                >
                  ← {locale === "gr" ? "Προηγούμενη" : "Previous"}
                </button>
                <button
                  onClick={() => setRecipePage((p) => Math.min(recipeTotalPages, p + 1))}
                  disabled={recipeSafePage >= recipeTotalPages}
                  className="erp-btn-secondary text-xs px-3 py-1.5 disabled:opacity-40"
                >
                  {locale === "gr" ? "Επόμενη" : "Next"} →
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
      <div className="flex gap-6">
        {/* Recipe List */}
        <div className="w-full">
          <div className="erp-card">
            <div className="erp-card-header"><h3 className="font-semibold">📋 {locale === "gr" ? "Αρχείο Συνταγών" : "Recipe Archive"}</h3></div>
            <div className="divide-y max-h-[600px] overflow-y-auto">
              {recipes.length === 0 ? <div className="p-8 text-center text-slate-400">{t("noData")}</div> :
                recipes.map((r, idx) => (
                  <div key={r?.id ?? `recipe-${idx}`} className={`p-4 cursor-pointer hover:bg-blue-50/50 transition-colors ${selectedRecipe?.id === r?.id ? "bg-blue-50 border-l-4 border-blue-500" : ""}`} onClick={() => openForEdit(r)}>
                    <div className="font-medium">{r?.name ?? "—"}</div>
                    {r?.nameEn && <div className="text-xs text-slate-400">{r.nameEn}</div>}
                    <div className="flex items-center gap-2 mt-1">
                      <Badge color="blue">{r?.portionYield} {r?.portionUnit}</Badge>
                      <Badge color="green">€{Number(r?.totalCost ?? 0).toFixed(2)}</Badge>
                      <Badge color="amber">{r?.profitMarginPercent}%</Badge>
                    </div>
                    <button onClick={e => { e.stopPropagation(); r?.id && deleteRecipe(r.id); }} disabled={deletingId === r?.id} className="text-red-400 hover:text-red-600 text-xs mt-2">
                      {deletingId === r?.id ? "…" : t("btnDelete")}
                    </button>
                  </div>
                ))}
            </div>
          </div>
        </div>
      </div>
      )}

      {/* Recipe Form Modal — ανοίγει με κλικ πάνω σε μια συνταγή ή στο
          "Νέα Συνταγή", αντί για ενσωματωμένο πάνελ. */}
      <Modal
        isOpen={editing}
        onClose={() => setEditing(false)}
        title={selectedRecipe ? (locale === "gr" ? "Επεξεργασία Συνταγής" : "Edit Recipe") : (locale === "gr" ? "Νέα Συνταγή" : "New Recipe")}
        size="xl"
      >
        <div id="printable-recipe-area">
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <button onClick={saveRecipe} disabled={saving} className="erp-btn-success">{saving ? "…" : "💾"} {t("btnSaveRecipe")}</button>
            <button onClick={calculateCosting} className="erp-btn-secondary">🧮 {locale === "gr" ? "Υπολογισμός Κόστους" : "Calculate Costing"}</button>
            <button onClick={() => setShowSearch(true)} className="erp-btn-secondary">🔍 {t("btnSearchRestore")}</button>
            <button onClick={() => window.print()} className="erp-btn-secondary">🖨️ {t("btnPrint")}</button>
          </div>

          <div className="erp-card mb-6">
            <div className="erp-card-header"><h3 className="font-semibold">👨‍🍳 {locale === "gr" ? "Στοιχεία Συνταγής" : "Recipe Details"}</h3></div>
            <div className="p-6">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                <div className="col-span-2"><label className="erp-label">{locale === "gr" ? "Ελληνική Ονομασία" : "Greek Name"}</label><input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="erp-input" /></div>
                <div className="col-span-2"><label className="erp-label">English Name</label><input type="text" value={form.nameEn} onChange={e => setForm({ ...form, nameEn: e.target.value })} className="erp-input" /></div>
                <div><label className="erp-label">{t("fieldPortionYield")}</label><input type="number" value={form.portionYield} onChange={e => setForm({ ...form, portionYield: e.target.value })} className="erp-input" step="0.1" /></div>
                <div><label className="erp-label">{t("fieldUnit")}</label>
                  <select value={form.portionUnit} onChange={e => setForm({ ...form, portionUnit: e.target.value })} className="erp-select">
                    <option value="pcs">{locale === "gr" ? "Μερίδες" : "Portions"}</option><option value="L">L</option><option value="kg">kg</option>
                  </select>
                </div>
                <div><label className="erp-label">{locale === "gr" ? "Κόστος Εργασίας" : "Labor Cost"}</label><input type="number" value={form.laborCost} onChange={e => setForm({ ...form, laborCost: e.target.value })} className="erp-input" step="0.01" /></div>
                <div><label className="erp-label">{locale === "gr" ? "Γενικά Έξοδα" : "Overhead Cost"}</label><input type="number" value={form.overheadCost} onChange={e => setForm({ ...form, overheadCost: e.target.value })} className="erp-input" step="0.01" /></div>
                <div><label className="erp-label">{locale === "gr" ? "Περιθώριο Κέρδους %" : "Profit Margin %"}</label><input type="number" value={form.profitMarginPercent} onChange={e => setForm({ ...form, profitMarginPercent: e.target.value })} className="erp-input" step="1" /></div>
                <div><label className="erp-label">{locale === "gr" ? "Θερμίδες / Μερίδα" : "Calories / Portion"}</label><input type="number" value={form.caloriesPerPortion} onChange={e => setForm({ ...form, caloriesPerPortion: e.target.value })} className="erp-input" step="1" /></div>
                <div><label className="erp-label">{locale === "gr" ? "Γραμμάρια / Μερίδα" : "Grams / Portion"}</label><input type="number" value={form.gramsPerPortion} onChange={e => setForm({ ...form, gramsPerPortion: e.target.value })} className="erp-input" step="1" /></div>
              </div>

              {/* Allergens */}
              <div className="mb-4">
                <label className="erp-label">{t("fieldAllergens")}</label>
                <div className="flex flex-wrap gap-2">
                  {ALLERGEN_LIST.map(a => (
                    <button key={a} onClick={() => setForm((prev) => ({
                      ...prev,
                      allergens: prev.allergens.includes(a) ? prev.allergens.filter((x) => x !== a) : [...prev.allergens, a],
                    }))} className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${form.allergens.includes(a) ? "bg-red-500 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
                      {a}
                    </button>
                  ))}
                </div>
              </div>

              {/* Technical Guide */}
              <div className="mb-4">
                <label className="erp-label">{t("fieldTechnicalGuide")}</label>
                <textarea value={form.technicalGuide} onChange={e => setForm({ ...form, technicalGuide: e.target.value })} className="erp-input min-h-[120px] font-mono text-sm" placeholder={locale === "gr" ? "Βήμα 1: ... Βήμα 2: ..." : "Step 1: ... Step 2: ..."} />
              </div>

              {/* Costing Summary */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 bg-slate-50 rounded-lg p-4">
                <div><div className="text-xs text-slate-500">{locale === "gr" ? "Κόστος Υλικών" : "Raw Material Cost"}</div><div className="font-bold">€{Number(form.totalRawMaterialCost).toFixed(2)}</div></div>
                <div><div className="text-xs text-slate-500">{locale === "gr" ? "Συνολικό Κόστος" : "Total Cost"}</div><div className="font-bold">€{Number(form.totalCost).toFixed(2)}</div></div>
                <div><div className="text-xs text-slate-500">{locale === "gr" ? "Τιμή Πώλησης" : "Selling Price"}</div><div className="font-bold text-emerald-700">€{Number(form.sellingPrice).toFixed(2)}</div></div>
                <div><div className="text-xs text-slate-500">{locale === "gr" ? "Τιμή Μενού (ΦΠΑ)" : "Menu Price (VAT)"}</div><div className="font-bold text-blue-700">€{Number(form.menuPriceVat).toFixed(2)}</div></div>
                <div><div className="text-xs text-slate-500">{locale === "gr" ? "Συνολικά Γραμμάρια" : "Total Grams"}</div><div className="font-bold">{(Number(form.gramsPerPortion) * Number(form.portionYield || 1)).toFixed(0)} g</div></div>
              </div>
            </div>
          </div>

          {/* Ingredient Matrix — ενοποιημένη ξανά μέσα στη φόρμα
              συνταγής, κατόπιν ρητού αιτήματος του χρήστη. */}
          {selectedRecipe && (
            <div className="erp-card mb-6">
              <div className="erp-card-header flex items-center justify-between">
                <h3 className="font-semibold">🧂 {locale === "gr" ? "Υλικά Συνταγής" : "Recipe Ingredients"}</h3>
                <div className="relative" ref={ingredientSearchRef}>
                  <input
                    type="text"
                    value={ingredientSearchTerm}
                    onChange={(e) => { setIngredientSearchTerm(e.target.value); setShowIngredientSearch(true); }}
                    onFocus={() => setShowIngredientSearch(true)}
                    placeholder={locale === "gr" ? "🔍 Αναζήτηση υλικού…" : "🔍 Search ingredient…"}
                    className="erp-input text-xs py-1.5 w-56"
                    autoComplete="off"
                  />
                  {showIngredientSearch && ingredientSearchTerm.trim() && (
                    <div className="absolute right-0 z-30 mt-1 w-80 max-h-72 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-2xl">
                      {ingredientSearchResults.length === 0 ? (
                        <div className="px-3 py-3 text-xs text-slate-400 text-center">
                          {locale === "gr" ? "Δεν βρέθηκαν υλικά" : "No ingredients found"}
                        </div>
                      ) : (
                        <table className="w-full text-xs">
                          <tbody>
                            {ingredientSearchResults.map((ing) => (
                              <tr
                                key={ing.id}
                                onClick={() => addIngredientToRecipe(ing)}
                                className="cursor-pointer hover:bg-blue-50 border-b border-slate-50"
                              >
                                <td className="px-3 py-2">
                                  <div className="font-medium text-slate-700">{locale === "gr" ? ing.name : (ing.nameEn || ing.name)}</div>
                                  <div className="text-slate-400">{ing.sku} · €{Number(ing.basePrice).toFixed(2)}/{ing.unit}</div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
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
                      <th className="min-w-[220px]">{t("fieldProduct")}</th>
                      <th>{t("fieldQuantity")}</th>
                      <th>{t("fieldUnit")}</th>
                      <th>{locale === "gr" ? "Τιμή Μονάδας" : "Unit Cost"}</th>
                      <th>{locale === "gr" ? "Σύνολο" : "Total"}</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {recipeItems.length === 0 ? (
                      <tr><td colSpan={7} className="text-center py-6 text-slate-400">{t("noData")}</td></tr>
                    ) : recipeItems.filter((item): item is typeof item & { id: number } => item.id != null).map((item, i) => (
                      <tr key={item.id} className={savingIngredientRowId === item.id ? "opacity-50" : ""}>
                        <td className="text-xs text-slate-400">{i + 1}</td>
                        <td className="min-w-[220px] font-medium">{item.ingredientName}</td>
                        <td>
                          <input
                            type="number" defaultValue={item.quantity}
                            onBlur={(e) => updateIngredientRow(item.id, "quantity", Number(e.target.value))}
                            className="erp-input text-xs py-1 w-20" step="0.001"
                          />
                        </td>
                        <td>{item.unit}</td>
                        <td>€{Number(item.unitCost).toFixed(2)}</td>
                        <td className="font-semibold">€{Number(item.totalCost).toFixed(2)}</td>
                        <td>
                          <button onClick={() => deleteIngredientRow(item.id)} disabled={savingIngredientRowId === item.id} className="text-red-400 hover:text-red-600">
                            {savingIngredientRowId === item.id ? "…" : "✕"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Plating Gallery */}
          <div className="erp-card">
            <div className="erp-card-header"><h3 className="font-semibold">📸 {t("fieldPlating")}</h3></div>
            <div className="p-6">
              <div className="grid grid-cols-3 gap-4">
                {[1, 2, 3].map(n => (
                  <div key={n} className="border-2 border-dashed border-slate-300 rounded-xl p-8 text-center hover:border-blue-400 transition-colors cursor-pointer">
                    <div className="text-3xl mb-2">📷</div>
                    <div className="text-xs text-slate-400">{locale === "gr" ? `Εικόνα ${n}` : `Image ${n}`}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </Modal>

      {/* Search Modal */}
      <Modal isOpen={showSearch} onClose={() => setShowSearch(false)} title={t("btnSearchRestore")} size="lg">
        <input type="text" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder={t("filterSearch")} className="erp-input mb-4" />
        <div className="space-y-2 max-h-[300px] overflow-y-auto">
          {recipes.filter(r => {
            if (!searchTerm) return true;
            const q = searchTerm.toLowerCase();
            return r?.name?.toLowerCase().includes(q) || (r?.nameEn && r.nameEn.toLowerCase().includes(q));
          }).map((r, idx) => (
            <div key={r?.id ?? `search-${idx}`} onClick={() => { loadRecipe(r); setShowSearch(false); }} className="p-3 rounded-lg hover:bg-blue-50 cursor-pointer flex items-center justify-between">
              <div><div className="font-medium">{r?.name ?? "—"}</div><div className="text-xs text-slate-400">{r?.nameEn}</div></div>
              <Badge color="green">€{Number(r?.totalCost ?? 0).toFixed(2)}</Badge>
            </div>
          ))}
        </div>
      </Modal>

      {/* Bulk Import Modal */}
      <Modal
        isOpen={showBulkImport}
        onClose={() => { if (!bulkImporting) { setShowBulkImport(false); setBulkMsg(null); setBulkFile(null); } }}
        title={locale === "gr" ? "Μαζική Εισαγωγή Συνταγών" : "Bulk Recipe Import"}
        size="lg"
      >
        <div className="space-y-4">
          {bulkMsg && (
            <div className={`p-3 rounded-lg text-sm ${bulkMsg.kind === "ok" ? "bg-emerald-50 border border-emerald-300 text-emerald-800" : "bg-red-50 border border-red-300 text-red-800"}`}>
              {bulkMsg.text}
            </div>
          )}

          <div
            onClick={() => bulkFileInputRef.current?.click()}
            className="border-2 border-dashed border-slate-300 rounded-xl p-8 text-center hover:border-blue-400 transition-colors cursor-pointer"
          >
            <div className="text-4xl mb-3">📄</div>
            <div className="font-medium text-slate-700">
              {bulkFile ? bulkFile.name : (locale === "gr" ? "Κάντε κλικ για επιλογή αρχείου Excel/CSV" : "Click to select an Excel/CSV file")}
            </div>
            <div className="text-xs text-slate-400 mt-2">
              {locale === "gr"
                ? "Στήλες: Όνομα Συνταγής, Κατηγορία, Μερίδες, Υλικό, Ποσότητα, Μονάδα Μέτρησης, Οδηγίες"
                : "Columns: Recipe Name, Category, Portions, Ingredient, Quantity, Unit, Instructions"}
            </div>
            <input
              ref={bulkFileInputRef} type="file" accept=".csv,.xlsx,.xls,.ods,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              onChange={(e) => setBulkFile(e.target.files?.[0] ?? null)} className="hidden"
            />
          </div>

          <div className="text-xs text-slate-400 bg-slate-50 rounded-lg p-3">
            {locale === "gr" ? (
              <>
                <strong>Πώς λειτουργεί:</strong> κάθε γραμμή του αρχείου αντιστοιχεί σε ένα (συνταγή, υλικό) ζευγάρι — μια συνταγή με 6 υλικά εμφανίζεται ως 6 γραμμές με το ίδιο &quot;Όνομα Συνταγής&quot;. Τα υλικά αντιστοιχίζονται στο υπάρχον Μητρώο Υλικών βάσει ονόματος· αν δεν βρεθεί αντιστοιχία, δημιουργείται αυτόματα νέο υλικό. Υποστηρίζει αρχεία με χιλιάδες γραμμές.
              </>
            ) : (
              <>
                <strong>How it works:</strong> each row in the file is one (recipe, ingredient) pair — a recipe with 6 ingredients appears as 6 rows sharing the same &quot;Recipe Name&quot;. Ingredients are matched against the existing Ingredients Register by name; unmatched ones are created automatically. Supports files with thousands of rows.
              </>
            )}
          </div>

          <div className="flex gap-2 pt-2">
            <button onClick={handleBulkImport} disabled={!bulkFile || bulkImporting} className="erp-btn-success">
              {bulkImporting ? (locale === "gr" ? "Εισαγωγή…" : "Importing…") : "📥 " + (locale === "gr" ? "Εισαγωγή" : "Import")}
            </button>
            <button onClick={() => { setShowBulkImport(false); setBulkMsg(null); setBulkFile(null); }} disabled={bulkImporting} className="erp-btn-ghost">
              {t("btnCancel")}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
