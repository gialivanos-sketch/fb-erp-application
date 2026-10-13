"use client";
import { useState, useMemo } from "react";
import { useLanguage } from "@/lib/context";
import { PageHeader } from "@/components/shared";
import * as db from "@/lib/supabaseData";

// ============================================================
// Σελίδα "Υλικά Συνταγών" — ΕΠΙΠΕΔΟΣ πίνακας, όλες οι γραμμές
// (συνταγή, υλικό) ζευγαριών ορατές εξ αρχής, με σελιδοποίηση
// (100 γραμμές/σελίδα) -- ίδια λογική με το φύλλο ΥΛΙΚΑ ΣΥΝΤΑΓΩΝ
// του Excel. Το φίλτρο ονόματος συνταγής είναι προαιρετικό
// εργαλείο, όχι προϋπόθεση για να δεις δεδομένα.
//
// Με 14.119+ γραμμές συνολικά, η σελιδοποίηση γίνεται ΣΤΗ ΜΝΗΜΗ
// (slice πάνω στο ήδη-φορτωμένο, πλήρες array) -- όχι νέο δικτυακό
// αίτημα ανά σελίδα, αφού όλα τα recipe_ingredients έρχονται ήδη
// μαζί με τις συνταγές τους από το batch fetchRecipes().
// ============================================================

const PAGE_SIZE = 100;

interface FlatRow {
  recipeId: number;
  recipeName: string;
  ingredientRowId: number;
  ingredientName: string;
  quantity: number;
  unit: string;
  unitCost: number;
  totalCost: number;
}

export default function RecipeIngredientsPage() {
  const { t, locale, data, refreshAll } = useLanguage();
  const recipes = data.recipes;

  const [filterTerm, setFilterTerm] = useState("");
  const [page, setPage] = useState(1);
  const [savingRowId, setSavingRowId] = useState<number | null>(null);

  // Πλήρης επίπεδη λίστα, ΟΛΩΝ των συνταγών (ή φιλτραρισμένη αν
  // υπάρχει filterTerm) -- υπολογίζεται μία φορά ανά αλλαγή data/
  // filterTerm, όχι ανά render.
  const allFlatRows: FlatRow[] = useMemo(() => {
    const q = filterTerm.trim().toLowerCase();
    const rows: FlatRow[] = [];
    for (const r of recipes) {
      const name = locale === "gr" ? r.name : (r.nameEn || r.name);
      if (q && !name.toLowerCase().includes(q)) continue;
      for (const ing of r.ingredients) {
        if (ing.id == null) continue; // ασφαλές: μόνο γραμμές που ήδη υπάρχουν στη βάση
        rows.push({
          recipeId: r.id, recipeName: name, ingredientRowId: ing.id,
          ingredientName: ing.ingredientName, quantity: Number(ing.quantity),
          unit: ing.unit, unitCost: Number(ing.unitCost), totalCost: Number(ing.totalCost),
        });
      }
    }
    return rows;
  }, [recipes, filterTerm, locale]);

  const totalPages = Math.max(1, Math.ceil(allFlatRows.length / PAGE_SIZE));
  // Αν το φίλτρο άλλαξε και η τρέχουσα σελίδα δεν υπάρχει πια (π.χ.
  // ήσουν στη σελίδα 40, το φίλτρο άφησε μόνο 2 σελίδες), γύρνα στη 1.
  const safePage = Math.min(page, totalPages);
  const pageRows = useMemo(
    () => allFlatRows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [allFlatRows, safePage]
  );

  function handleFilterChange(value: string) {
    setFilterTerm(value);
    setPage(1); // κάθε νέο φίλτρο ξαναρχίζει από τη σελίδα 1
  }

  async function handleUpdateQuantity(rowId: number, quantity: number, unitCost: number) {
    setSavingRowId(rowId);
    try {
      const totalCost = Number((quantity * unitCost).toFixed(2));
      await db.updateRecipeIngredient(rowId, { quantity, totalCost });
      await refreshAll();
    } catch (err) {
      alert(locale === "gr" ? "Αποτυχία ενημέρωσης: " + String(err) : "Failed to update: " + String(err));
    } finally {
      setSavingRowId(null);
    }
  }

  async function handleDeleteRow(rowId: number) {
    setSavingRowId(rowId);
    try {
      await db.deleteRecipeIngredient(rowId);
      await refreshAll();
    } catch (err) {
      alert(locale === "gr" ? "Αποτυχία διαγραφής: " + String(err) : "Failed to delete: " + String(err));
    } finally {
      setSavingRowId(null);
    }
  }

  return (
    <div>
      <PageHeader
        title={locale === "gr" ? "Υλικά Συνταγών" : "Recipe Ingredients"}
        subtitle={`${allFlatRows.length} ${locale === "gr" ? "γραμμές συνολικά" : "total rows"}`}
      />

      <div className="erp-card">
        <div className="erp-card-header">
          <input
            type="text" value={filterTerm} onChange={(e) => handleFilterChange(e.target.value)}
            placeholder={locale === "gr" ? "🔍 Φίλτρο με όνομα συνταγής (προαιρετικό)…" : "🔍 Filter by recipe name (optional)…"}
            className="erp-input text-sm w-full max-w-md"
          />
        </div>

        {allFlatRows.length === 0 ? (
          <div className="p-12 text-center text-slate-400">{t("noData")}</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="erp-table">
                <thead>
                  <tr>
                    <th>{locale === "gr" ? "Όνομα Συνταγής" : "Recipe Name"}</th>
                    <th>{locale === "gr" ? "Υλικό" : "Ingredient"}</th>
                    <th>{t("fieldQuantity")}</th>
                    <th>{t("fieldUnit")}</th>
                    <th>{locale === "gr" ? "Κόστος/Μονάδα" : "Cost/Unit"}</th>
                    <th>{locale === "gr" ? "Συνολικό Κόστος" : "Total Cost"}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((row) => (
                    <tr key={row.ingredientRowId} className={savingRowId === row.ingredientRowId ? "opacity-50" : ""}>
                      <td className="font-medium text-slate-700">{row.recipeName}</td>
                      <td>{row.ingredientName}</td>
                      <td>
                        <input
                          type="number" defaultValue={row.quantity}
                          onBlur={(e) => handleUpdateQuantity(row.ingredientRowId, Number(e.target.value), row.unitCost)}
                          className="erp-input text-xs py-1 w-24" step="0.001"
                        />
                      </td>
                      <td>{row.unit}</td>
                      <td>€{row.unitCost.toFixed(4)}</td>
                      <td className="font-semibold">€{row.totalCost.toFixed(2)}</td>
                      <td>
                        <button
                          onClick={() => handleDeleteRow(row.ingredientRowId)}
                          disabled={savingRowId === row.ingredientRowId}
                          className="text-red-400 hover:text-red-600"
                        >
                          {savingRowId === row.ingredientRowId ? "…" : "✕"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Σελιδοποίηση */}
            <div className="flex items-center justify-between px-4 py-3 border-t text-sm">
              <div className="text-slate-500">
                {locale === "gr"
                  ? `Σελίδα ${safePage} από ${totalPages} — γραμμές ${(safePage - 1) * PAGE_SIZE + 1}-${Math.min(safePage * PAGE_SIZE, allFlatRows.length)} από ${allFlatRows.length}`
                  : `Page ${safePage} of ${totalPages} — rows ${(safePage - 1) * PAGE_SIZE + 1}-${Math.min(safePage * PAGE_SIZE, allFlatRows.length)} of ${allFlatRows.length}`}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={safePage <= 1}
                  className="erp-btn-secondary text-xs px-3 py-1.5 disabled:opacity-40"
                >
                  ← {locale === "gr" ? "Προηγούμενη" : "Previous"}
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={safePage >= totalPages}
                  className="erp-btn-secondary text-xs px-3 py-1.5 disabled:opacity-40"
                >
                  {locale === "gr" ? "Επόμενη" : "Next"} →
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
