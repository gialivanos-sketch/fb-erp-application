"use client";
import { useState } from "react";
import { useLanguage } from "@/lib/context";
import { PageHeader, KpiCard, Badge, FilterBar } from "@/components/shared";
import type { Recipe } from "@/lib/types";

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

  return (
    <div>
      <PageHeader title={t("headerRecipeCosting")} subtitle="Κοστολόγηση Συνταγής & Margin Analysis">
        <button onClick={() => window.print()} className="erp-btn-secondary">🖨️ {t("btnPrint")}</button>
        <button className="erp-btn-secondary">📄 {t("btnExportPDF")}</button>
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
