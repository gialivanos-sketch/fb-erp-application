"use client";
import { useState } from "react";
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

  function loadMenu(menu: Menu) {
    if (!menu) return;
    setSelectedMenu(menu);
    setEditing(true);
    setMenuTitle(menu.title);
    setMenuTitleEn(menu.titleEn || "");
    setMenuRecipes(menu.recipes || []);
  }

  function newMenu() {
    setSelectedMenu(null);
    setEditing(true);
    setMenuTitle("");
    setMenuTitleEn("");
    setMenuRecipes([]);
  }

  function addRecipe(recipe: Recipe) {
    const cost = Number(recipe.totalCost);
    const sell = cost / (1 - Number(recipe.profitMarginPercent || 60) / 100);
    const portionYield = Number(recipe.portionYield) || 1;
    setMenuRecipes(prev => [...prev, {
      recipeId: recipe.id,
      recipeName: recipe.name,
      portions: portionYield,
      foodCost: cost.toFixed(2),
      sellingPrice: sell.toFixed(2),
      profitMargin: recipe.profitMarginPercent || "60",
    }]);
    setShowAddRecipe(false);
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
  const avgMargin = menuRecipes.length > 0 ? menuRecipes.reduce((s, r) => s + Number(r.profitMargin), 0) / menuRecipes.length : 0;
  const fmt = (n: number) => `€${n.toFixed(2)}`;

  async function saveMenu() {
    if (!menuTitle) return;
    setSaving(true);
    try {
      const recipesForSave: MenuRecipe[] = menuRecipes.map(r => ({
        recipeId: r.recipeId, recipeName: r.recipeName, portions: r.portions,
        foodCost: r.foodCost, sellingPrice: r.sellingPrice, profitMargin: r.profitMargin,
      }));
      await db.upsertMenu({
        id: selectedMenu?.id,
        title: menuTitle,
        titleEn: menuTitleEn || null,
        status: selectedMenu?.status ?? "active",
        totalRecipes, totalPortions,
        avgProfitMargin: avgMargin.toFixed(2),
        totalFoodCost: totalFoodCost.toFixed(2),
        recipes: recipesForSave,
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
        {editing && <button onClick={() => window.print()} className="erp-btn-secondary">🖨️ {t("btnPrint")}</button>}
        {editing && <button className="erp-btn-warning">📊 {t("btnViewReport")}</button>}
        {editing && <button className="erp-btn-secondary">📥 {t("btnExportExcel")}</button>}
      </PageHeader>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard label={locale === "gr" ? "Σύνολο Συνταγών" : "Total Recipes"} value={totalRecipes} color="blue" icon="👨‍🍳" />
        <KpiCard label={locale === "gr" ? "Σύνολο Μερίδων" : "Total Portions"} value={totalPortions} color="green" icon="🍽️" />
        <KpiCard label={locale === "gr" ? "Σύνολο Κόστους" : "Total Food Cost"} value={fmt(totalFoodCost)} color="amber" icon="💰" />
        <KpiCard label={t("fieldProfitMargin")} value={`${avgMargin.toFixed(1)}%`} color="purple" icon="📈" />
      </div>

      <div className="flex gap-6">
        {/* Menu List */}
        <div className={`${editing ? "hidden lg:block lg:w-1/4" : "w-full"}`}>
          <div className="erp-card">
            <div className="erp-card-header"><h3 className="font-semibold">📚 {t("headerMenuArchive")}</h3></div>
            <div className="divide-y max-h-[500px] overflow-y-auto">
              {menus.length === 0 ? <div className="p-8 text-center text-slate-400">{t("noData")}</div> :
                menus.map((m, idx) => (
                  <div key={m?.id ?? `menu-${idx}`} onClick={() => loadMenu(m)} className={`p-4 cursor-pointer hover:bg-blue-50/50 transition-colors ${selectedMenu?.id === m?.id ? "bg-blue-50 border-l-4 border-blue-500" : ""}`}>
                    <div className="font-medium">{m?.title ?? "—"}</div>
                    {m?.titleEn && <div className="text-xs text-slate-400">{m.titleEn}</div>}
                    <div className="flex gap-2 mt-1">
                      <Badge color="blue">{m?.totalRecipes} {locale === "gr" ? "συντ." : "rec."}</Badge>
                      <Badge color="green">{m?.avgProfitMargin}%</Badge>
                    </div>
                    <button onClick={e => { e.stopPropagation(); m?.id && deleteMenu(m.id); }} disabled={deletingId === m?.id} className="text-red-400 hover:text-red-600 text-xs mt-1">
                      {deletingId === m?.id ? "…" : t("btnDelete")}
                    </button>
                  </div>
                ))}
            </div>
          </div>
        </div>

        {/* Menu Editor */}
        {editing && (
          <div className="flex-1">
            <div className="erp-card mb-6">
              <div className="p-6">
                <div className="grid grid-cols-2 gap-4">
                  <div><label className="erp-label">{locale === "gr" ? "Τίτλος Μενού" : "Menu Title"}</label><input type="text" value={menuTitle} onChange={e => setMenuTitle(e.target.value)} className="erp-input" placeholder="Μενού Χειμώνα 2026" /></div>
                  <div><label className="erp-label">English Title</label><input type="text" value={menuTitleEn} onChange={e => setMenuTitleEn(e.target.value)} className="erp-input" placeholder="Winter Menu 2026" /></div>
                </div>
              </div>
            </div>

            {/* Menu Recipes Grid */}
            <div className="erp-card mb-6">
              <div className="erp-card-header flex items-center justify-between">
                <h3 className="font-semibold">🍽️ {locale === "gr" ? "Συνταγές Μενού" : "Menu Recipes"}</h3>
                <button onClick={() => setShowAddRecipe(true)} className="erp-btn-primary text-xs">➕ {locale === "gr" ? "Προσθήκη Συνταγής" : "Add Recipe"}</button>
              </div>
              <div className="overflow-x-auto">
                <table className="erp-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>{t("fieldRecipeName")}</th>
                      <th>{locale === "gr" ? "Μερίδες" : "Portions"}</th>
                      <th>{locale === "gr" ? "Κόστος Φαγητού" : "Food Cost"}</th>
                      <th>{locale === "gr" ? "Τιμή Πώλησης" : "Selling Price"}</th>
                      <th>{t("fieldProfitMargin")}</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {menuRecipes.length === 0 ? <tr><td colSpan={7} className="text-center py-6 text-slate-400">{t("noData")}</td></tr> :
                      menuRecipes.map((mr, i) => (
                        <tr key={i}>
                          <td className="text-xs text-slate-400">{i + 1}</td>
                          <td className="font-medium">{mr.recipeName}</td>
                          <td><input type="number" value={mr.portions} onChange={e => updateMenuRecipe(i, "portions", Number(e.target.value))} className="erp-input w-20 text-sm py-1" min="1" /></td>
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
                        <td colSpan={2} className="text-right">{t("total")}:</td>
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

      {/* Add Recipe Modal */}
      <Modal isOpen={showAddRecipe} onClose={() => setShowAddRecipe(false)} title={locale === "gr" ? "Προσθήκη Συνταγής" : "Add Recipe"} size="lg">
        <div className="space-y-2 max-h-[400px] overflow-y-auto">
          {allRecipes.map((r, idx) => (
            <div key={r?.id ?? `recipe-${idx}`} onClick={() => addRecipe(r)} className="flex items-center justify-between p-3 rounded-lg hover:bg-blue-50 cursor-pointer border">
              <div>
                <div className="font-medium">{r?.name ?? "—"}</div>
                {r?.nameEn && <div className="text-xs text-slate-400">{r.nameEn}</div>}
              </div>
              <div className="flex gap-2">
                <Badge color="blue">{r?.portionYield} {locale === "gr" ? "μερ." : "pcs"}</Badge>
                <Badge color="green">€{Number(r?.totalCost ?? 0).toFixed(2)}</Badge>
              </div>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
}
