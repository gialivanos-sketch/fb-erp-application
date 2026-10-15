"use client";
import { useState, useMemo } from "react";
import { useLanguage } from "@/lib/context";
import { PageHeader, KpiCard, Badge, Modal } from "@/components/shared";
import type { Recipe, Menu, MenuRecipe } from "@/lib/types";
import * as db from "@/lib/supabaseData";

export default function MenuPlannerPage() {
  const { t, locale, data, refreshAll } = useLanguage();
  const menus = data.menus;
  const allRecipes = data.recipes;

  const [selectedMenu, setSelectedMenu] = useState<Menu | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [menuTitle, setMenuTitle] = useState("");
  const [menuTitleEn, setMenuTitleEn] = useState("");
  const [menuRecipes, setMenuRecipes] = useState<MenuRecipe[]>([]);
  const [showAddRecipe, setShowAddRecipe] = useState(false);
  const [recipeSearch, setRecipeSearch] = useState("");
  const [showConsumption, setShowConsumption] = useState(false);
  const [coverCount, setCoverCount] = useState(1); // αριθμός ατόμων για αναφορά

  // Φιλτράρισμα συνταγών βάσει αναζήτησης
  const filteredRecipes = useMemo(() => {
    const q = recipeSearch.trim().toLowerCase();
    if (!q) return allRecipes;
    return allRecipes.filter(r =>
      r.name.toLowerCase().includes(q) ||
      (r.nameEn && r.nameEn.toLowerCase().includes(q))
    );
  }, [allRecipes, recipeSearch]);

  // Υπολογισμός ανάλωσης υλικών για δεδομένο αριθμό ατόμων
  const consumptionItems = useMemo(() => {
    if (!showConsumption) return [];
    const map = new Map<string, { name: string; unit: string; qty: number; cost: number }>();
    for (const mr of menuRecipes) {
      // Βρίσκουμε τη συνταγή στο context
      const recipe = allRecipes.find(r => r.id === mr.recipeId);
      if (!recipe) continue;
      // Πολλαπλασιαστής: για μερίδα × covers, για kg × 1 (ως έχει)
      const multiplier = mr.portionType === "portion"
        ? coverCount / (Number(recipe.portionYield) || 1)
        : 1;
      for (const ing of recipe.ingredients || []) {
        const key = `${ing.ingredientName}__${ing.unit}`;
        const existing = map.get(key);
        const qty = Number(ing.quantity) * multiplier;
        const cost = Number(ing.totalCost) * multiplier;
        if (existing) {
          existing.qty += qty;
          existing.cost += cost;
        } else {
          map.set(key, { name: ing.ingredientName, unit: ing.unit, qty, cost });
        }
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, "el"));
  }, [showConsumption, menuRecipes, allRecipes, coverCount]);

  function loadMenu(menu: Menu) {
    if (!menu) return;
    setSelectedMenu(menu);
    setEditing(true);
    setMenuTitle(menu.title);
    setMenuTitleEn(menu.titleEn || "");
    setMenuRecipes((menu.recipes || []).map(r => ({
      ...r,
      portionType: (r.portionType ?? "portion") as "portion" | "kg",
    })));
  }

  function newMenu() {
    setSelectedMenu(null);
    setEditing(true);
    setMenuTitle("");
    setMenuTitleEn("");
    setMenuRecipes([]);
  }

  function addRecipe(recipe: Recipe, portionType: "portion" | "kg") {
    const cost = Number(recipe.totalCost);
    const sell = cost > 0 ? cost / (1 - Number(recipe.profitMarginPercent || 60) / 100) : 0;
    const portionYield = Number(recipe.portionYield) || 1;
    const newRow: MenuRecipe = {
      recipeId: recipe.id,
      recipeName: recipe.name,
      portions: portionType === "kg" ? 1 : portionYield,
      portionType,
      foodCost: cost.toFixed(2),
      sellingPrice: sell.toFixed(2),
      profitMargin: recipe.profitMarginPercent || "60",
    };
    setMenuRecipes(prev => [...prev, newRow]);
    setShowAddRecipe(false);
    setRecipeSearch("");
  }

  function removeMenuRecipe(idx: number) {
    setMenuRecipes(prev => prev.filter((_, i) => i !== idx));
  }

  function updateMenuRecipe(idx: number, field: string, value: number | string) {
    setMenuRecipes(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  }

  const totalRecipes = menuRecipes.length;
  const totalPortions = menuRecipes.reduce((s, r) => s + r.portions, 0);
  const totalFoodCost = menuRecipes.reduce((s, r) => s + Number(r.foodCost) * r.portions, 0);
  const avgMargin = menuRecipes.length > 0
    ? menuRecipes.reduce((s, r) => s + Number(r.profitMargin), 0) / menuRecipes.length
    : 0;
  const fmt = (n: number) => `€${n.toFixed(2)}`;

  async function saveMenu() {
    if (!menuTitle) return;
    setSaving(true);
    try {
      await db.upsertMenu({
        id: selectedMenu?.id,
        title: menuTitle,
        titleEn: menuTitleEn || null,
        status: selectedMenu?.status ?? "active",
        totalRecipes,
        totalPortions,
        avgProfitMargin: avgMargin.toFixed(2),
        totalFoodCost: totalFoodCost.toFixed(2),
        recipes: menuRecipes,
      });
      await refreshAll();
      setEditing(false);
    } catch (err) {
      alert(locale === "gr" ? "Αποτυχία αποθήκευσης: " + String(err) : "Failed to save: " + String(err));
    } finally {
      setSaving(false);
    }
  }

  async function deleteMenu(id: number) {
    if (!confirm(t("deleteConfirm"))) return;
    setDeletingId(id);
    try {
      await db.deleteMenu(id);
      await refreshAll();
      if (selectedMenu?.id === id) { setSelectedMenu(null); setEditing(false); }
    } catch (err) {
      alert(locale === "gr" ? "Αποτυχία διαγραφής: " + String(err) : "Failed to delete: " + String(err));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div>
      <PageHeader title={t("headerMenuPlanner")} subtitle="Κοστολόγηση Μενού & Εξαγωγή">
        <button onClick={newMenu} className="erp-btn-primary">➕ {t("btnNewMenu")}</button>
        {editing && <button onClick={saveMenu} disabled={saving} className="erp-btn-success">{saving ? "…" : "💾"} {t("btnSaveMenu")}</button>}
        {editing && menuRecipes.length > 0 && (
          <button onClick={() => setShowConsumption(true)} className="erp-btn-secondary">
            📋 {locale === "gr" ? "Αναφορά Ανάλωσης" : "Consumption Report"}
          </button>
        )}
        {editing && <button onClick={() => setEditing(false)} className="erp-btn-secondary">✕ {locale === "gr" ? "Ακύρωση" : "Cancel"}</button>}
        {editing && <button onClick={() => window.print()} className="erp-btn-secondary">🖨️ {t("btnPrint")}</button>}
      </PageHeader>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard label={locale === "gr" ? "Σύνολο Συνταγών" : "Total Recipes"} value={totalRecipes} color="blue" icon="👨‍🍳" />
        <KpiCard label={locale === "gr" ? "Σύνολο Μερίδων" : "Total Portions"} value={totalPortions} color="green" icon="🍽️" />
        <KpiCard label={locale === "gr" ? "Σύνολο Κόστους" : "Total Food Cost"} value={fmt(totalFoodCost)} color="amber" icon="💰" />
        <KpiCard label={t("fieldProfitMargin")} value={`${avgMargin.toFixed(1)}%`} color="purple" icon="📈" />
      </div>

      <div className="flex gap-6">
        {/* Λίστα μενού */}
        <div className={`${editing ? "hidden lg:block lg:w-1/4" : "w-full"}`}>
          <div className="erp-card">
            <div className="erp-card-header"><h3 className="font-semibold">📚 {t("headerMenuArchive")}</h3></div>
            <div className="divide-y max-h-[500px] overflow-y-auto">
              {menus.length === 0
                ? <div className="p-8 text-center text-slate-400">{t("noData")}</div>
                : menus.map((m, idx) => (
                  <div
                    key={m?.id ?? `menu-${idx}`}
                    onClick={() => loadMenu(m)}
                    className={`p-4 cursor-pointer hover:bg-blue-50/50 transition-colors ${selectedMenu?.id === m?.id ? "bg-blue-50 border-l-4 border-blue-500" : ""}`}
                  >
                    <div className="font-medium">{m?.title ?? "—"}</div>
                    {m?.titleEn && <div className="text-xs text-slate-400">{m.titleEn}</div>}
                    <div className="flex gap-2 mt-1">
                      <Badge color="blue">{m?.totalRecipes} {locale === "gr" ? "συντ." : "rec."}</Badge>
                      <Badge color="green">{m?.avgProfitMargin}%</Badge>
                    </div>
                    <button
                      onClick={e => { e.stopPropagation(); m?.id && deleteMenu(m.id); }}
                      disabled={deletingId === m?.id}
                      className="text-red-400 hover:text-red-600 text-xs mt-1"
                    >
                      {deletingId === m?.id ? "…" : t("btnDelete")}
                    </button>
                  </div>
                ))}
            </div>
          </div>
        </div>

        {/* Επεξεργαστής μενού */}
        {editing && (
          <div className="flex-1">
            {/* Τίτλοι */}
            <div className="erp-card mb-6">
              <div className="p-6">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="erp-label">{locale === "gr" ? "Τίτλος Μενού" : "Menu Title"}</label>
                    <input
                      type="text"
                      value={menuTitle}
                      onChange={e => setMenuTitle(e.target.value)}
                      className="erp-input"
                      placeholder="Μενού Χειμώνα 2026"
                    />
                  </div>
                  <div>
                    <label className="erp-label">English Title</label>
                    <input
                      type="text"
                      value={menuTitleEn}
                      onChange={e => setMenuTitleEn(e.target.value)}
                      className="erp-input"
                      placeholder="Winter Menu 2026"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Πίνακας συνταγών */}
            <div className="erp-card mb-6">
              <div className="erp-card-header flex items-center justify-between">
                <h3 className="font-semibold">🍽️ {locale === "gr" ? "Συνταγές Μενού" : "Menu Recipes"}</h3>
                <button onClick={() => { setShowAddRecipe(true); setRecipeSearch(""); }} className="erp-btn-primary text-xs">
                  ➕ {locale === "gr" ? "Προσθήκη Συνταγής" : "Add Recipe"}
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="erp-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>{t("fieldRecipeName")}</th>
                      <th>{locale === "gr" ? "Τύπος" : "Type"}</th>
                      <th>{locale === "gr" ? "Ποσότητα" : "Qty"}</th>
                      <th>{locale === "gr" ? "Κόστος/μον." : "Cost/unit"}</th>
                      <th>{locale === "gr" ? "Τιμή Πώλησης" : "Selling Price"}</th>
                      <th>{t("fieldProfitMargin")}</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {menuRecipes.length === 0
                      ? <tr><td colSpan={8} className="text-center py-6 text-slate-400">{t("noData")}</td></tr>
                      : menuRecipes.map((mr, i) => (
                        <tr key={i}>
                          <td className="text-xs text-slate-400">{i + 1}</td>
                          <td className="font-medium">{mr.recipeName}</td>
                          <td>
                            <select
                              value={mr.portionType ?? "portion"}
                              onChange={e => updateMenuRecipe(i, "portionType", e.target.value)}
                              className="erp-input text-sm py-1 w-28"
                            >
                              <option value="portion">{locale === "gr" ? "Μερίδα" : "Portion"}</option>
                              <option value="kg">{locale === "gr" ? "Κιλό (μπουφές)" : "Kg (buffet)"}</option>
                            </select>
                          </td>
                          <td>
                            <input
                              type="number"
                              value={mr.portions}
                              onChange={e => updateMenuRecipe(i, "portions", Number(e.target.value))}
                              className="erp-input w-20 text-sm py-1"
                              min="0.1"
                              step={mr.portionType === "kg" ? "0.1" : "1"}
                            />
                            <span className="text-xs text-slate-400 ml-1">
                              {mr.portionType === "kg" ? "kg" : (locale === "gr" ? "μερ." : "pcs")}
                            </span>
                          </td>
                          <td className="font-medium">{fmt(Number(mr.foodCost))}</td>
                          <td className="font-semibold text-emerald-700">{fmt(Number(mr.sellingPrice))}</td>
                          <td><Badge color={Number(mr.profitMargin) >= 60 ? "green" : "amber"}>{mr.profitMargin}%</Badge></td>
                          <td><button onClick={() => removeMenuRecipe(i)} className="text-red-400 hover:text-red-600">✕</button></td>
                        </tr>
                      ))}
                  </tbody>
                  {menuRecipes.length > 0 && (
                    <tfoot>
                      <tr className="bg-slate-50 font-bold">
                        <td colSpan={3} className="text-right">{t("total")}:</td>
                        <td>{totalPortions}</td>
                        <td>{fmt(totalFoodCost)}</td>
                        <td className="text-emerald-700">{fmt(menuRecipes.reduce((s, r) => s + Number(r.sellingPrice) * r.portions, 0))}</td>
                        <td><Badge color="green">{avgMargin.toFixed(1)}%</Badge></td>
                        <td></td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Modal προσθήκης συνταγής */}
      <Modal
        isOpen={showAddRecipe}
        onClose={() => { setShowAddRecipe(false); setRecipeSearch(""); }}
        title={locale === "gr" ? "Προσθήκη Συνταγής στο Μενού" : "Add Recipe to Menu"}
        size="lg"
      >
        <div className="space-y-3">
          <input
            type="text"
            autoFocus
            value={recipeSearch}
            onChange={e => setRecipeSearch(e.target.value)}
            className="erp-input"
            placeholder={locale === "gr" ? "🔍 Αναζήτηση συνταγής…" : "🔍 Search recipe…"}
          />
          <div className="text-xs text-slate-400">
            {filteredRecipes.length} {locale === "gr" ? "συνταγές" : "recipes"}
            {recipeSearch && ` (από ${allRecipes.length})`}
          </div>
          <div className="space-y-1 max-h-[380px] overflow-y-auto">
            {filteredRecipes.length === 0
              ? <div className="text-center py-8 text-slate-400">{locale === "gr" ? "Δεν βρέθηκαν συνταγές" : "No recipes found"}</div>
              : filteredRecipes.map((r, idx) => (
                <div key={r?.id ?? `recipe-${idx}`} className="flex items-center justify-between p-3 rounded-lg hover:bg-blue-50 border">
                  <div className="flex-1 min-w-0 mr-3">
                    <div className="font-medium truncate">{r?.name ?? "—"}</div>
                    {r?.nameEn && <div className="text-xs text-slate-400 truncate">{r.nameEn}</div>}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Badge color="blue">{r?.portionYield} {locale === "gr" ? "μερ." : "pcs"}</Badge>
                    <Badge color="green">€{Number(r?.totalCost ?? 0).toFixed(2)}</Badge>
                    <button
                      onClick={() => addRecipe(r, "portion")}
                      className="erp-btn-primary text-xs px-2 py-1"
                      title={locale === "gr" ? "Προσθήκη ως μερίδα" : "Add as portion"}
                    >
                      🍽️ {locale === "gr" ? "Μερίδα" : "Portion"}
                    </button>
                    <button
                      onClick={() => addRecipe(r, "kg")}
                      className="erp-btn-secondary text-xs px-2 py-1"
                      title={locale === "gr" ? "Προσθήκη ως κιλό (μπουφές)" : "Add as kg (buffet)"}
                    >
                      ⚖️ Kg
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </div>
      </Modal>

      {/* Modal Αναφοράς Ανάλωσης */}
      <Modal
        isOpen={showConsumption}
        onClose={() => setShowConsumption(false)}
        title={locale === "gr" ? `📋 Αναφορά Ανάλωσης — ${menuTitle}` : `📋 Consumption Report — ${menuTitle}`}
        size="lg"
      >
        <div className="space-y-4">
          {/* Επιλογή αριθμού ατόμων */}
          <div className="flex items-center gap-4 p-4 bg-blue-50 rounded-lg">
            <label className="font-medium text-sm whitespace-nowrap">
              {locale === "gr" ? "👥 Αριθμός Ατόμων:" : "👥 Number of Covers:"}
            </label>
            <input
              type="number"
              value={coverCount}
              onChange={e => setCoverCount(Math.max(1, Number(e.target.value)))}
              className="erp-input w-24 text-center font-bold text-lg"
              min="1"
              step="1"
            />
            <span className="text-xs text-slate-500">
              {locale === "gr"
                ? "Οι ποσότητες υλικών υπολογίζονται για τις συνταγές Μερίδας. Οι συνταγές Κιλό δεν αλλάζουν."
                : "Ingredient quantities are calculated for Portion-type recipes. Kg-type recipes stay fixed."}
            </span>
          </div>

          {/* Σύνοψη */}
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="bg-blue-50 rounded-lg p-3">
              <div className="text-2xl font-bold text-blue-700">{menuRecipes.length}</div>
              <div className="text-xs text-slate-500">{locale === "gr" ? "Συνταγές" : "Recipes"}</div>
            </div>
            <div className="bg-green-50 rounded-lg p-3">
              <div className="text-2xl font-bold text-green-700">{coverCount}</div>
              <div className="text-xs text-slate-500">{locale === "gr" ? "Άτομα" : "Covers"}</div>
            </div>
            <div className="bg-amber-50 rounded-lg p-3">
              <div className="text-2xl font-bold text-amber-700">{consumptionItems.length}</div>
              <div className="text-xs text-slate-500">{locale === "gr" ? "Υλικά" : "Ingredients"}</div>
            </div>
          </div>

          {/* Πίνακας υλικών */}
          {consumptionItems.length === 0 ? (
            <div className="text-center py-8 text-slate-400">
              {locale === "gr"
                ? "Δεν βρέθηκαν υλικά. Οι συνταγές πρέπει να έχουν καταχωρημένα υλικά."
                : "No ingredients found. Recipes must have ingredients recorded."}
            </div>
          ) : (
            <div className="overflow-y-auto max-h-[400px]">
              <table className="erp-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>{locale === "gr" ? "Υλικό" : "Ingredient"}</th>
                    <th>{locale === "gr" ? "Ποσότητα" : "Quantity"}</th>
                    <th>{locale === "gr" ? "Μονάδα" : "Unit"}</th>
                    <th>{locale === "gr" ? "Κόστος" : "Cost"}</th>
                  </tr>
                </thead>
                <tbody>
                  {consumptionItems.map((item, i) => (
                    <tr key={i}>
                      <td className="text-xs text-slate-400">{i + 1}</td>
                      <td className="font-medium">{item.name}</td>
                      <td className="font-bold text-blue-700">
                        {item.qty % 1 === 0 ? item.qty.toFixed(0) : item.qty.toFixed(3)}
                      </td>
                      <td className="text-slate-500">{item.unit}</td>
                      <td className="text-emerald-700">{fmt(item.cost)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 font-bold">
                    <td colSpan={4} className="text-right">{t("total")}:</td>
                    <td className="text-emerald-700">{fmt(consumptionItems.reduce((s, i) => s + i.cost, 0))}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* Print button */}
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => window.print()} className="erp-btn-secondary">
              🖨️ {locale === "gr" ? "Εκτύπωση" : "Print"}
            </button>
            <button onClick={() => setShowConsumption(false)} className="erp-btn-primary">
              ✓ {locale === "gr" ? "Κλείσιμο" : "Close"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
