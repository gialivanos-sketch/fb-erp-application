"use client";
import { useState } from "react";
import { useLanguage } from "@/lib/context";
import { PageHeader, KpiCard, Badge } from "@/components/shared";

const SUPPLIER_MAP: Record<string, string> = {
  "Ντομάτα": "Τσιαούσης Α.Ε.",
  "Κρεμμύδι": "Τσιαούσης Α.Ε.",
  "Πατάτα": "Τσιαούσης Α.Ε.",
  "Αγγούρι": "Τσιαούσης Α.Ε.",
  "Μαρούλι": "Τσιαούσης Α.Ε.",
  "Λάδι": "Περιστέρης Τροφικά",
  "Αλεύρι": "Περιστέρης Τροφικά",
  "Ρύζι": "Περιστέρης Τροφικά",
  "Αλάτι": "Περιστέρης Τροφικά",
  "Τσιπούρα": "Θαλάσσια Πρεβέζας",
  "Λαβράκι": "Θαλάσσια Πρεβέζας",
  "Μοσχάρι": "Κρεοπωλείο Ζαχαρόπουλος",
  "Χοιρινό": "Κρεοπωλείο Ζαχαρόπουλος",
  "Κοτόπουλο": "Κρεοπωλείο Ζαχαρόπουλος",
  "Φέτα": "Γαλακτοκομικά Κρήτης",
  "Γιαούρτι": "Γαλακτοκομικά Κρήτης",
  "Βούτυρο": "Γαλακτοκομικά Κρήτης",
  "Μυζήθρα": "Γαλακτοκομικά Κρήτης",
};

interface ConsumptionLine { name: string; totalQty: number; unit: string; unitCost: number; totalCost: number; supplier: string; }

function getSupplier(name: string): string {
  for (const [key, val] of Object.entries(SUPPLIER_MAP)) {
    if (name.includes(key)) return val;
  }
  return "—";
}

export default function ConsumptionPage() {
  const { t, locale, data } = useLanguage();
  const recipes = data.recipes;
  const menus = data.menus;
  const [selectedMenu, setSelectedMenu] = useState<number>(0);

  const menu = menus.find(m => m?.id === selectedMenu);
  const consumption: ConsumptionLine[] = [];
  if (menu) {
    const lineMap = new Map<string, ConsumptionLine>();
    for (const mr of menu.recipes || []) {
      const recipe = recipes.find(r => r?.name === mr?.recipeName);
      if (!recipe) continue;
      for (const ing of recipe.ingredients || []) {
        const key = ing.ingredientName;
        const existing = lineMap.get(key);
        const qty = Number(ing.quantity) * (mr.portions || 1);
        if (existing) {
          existing.totalQty += qty;
          existing.totalCost += Number(ing.totalCost) * (mr.portions || 1);
        } else {
          lineMap.set(key, {
            name: ing.ingredientName,
            totalQty: qty,
            unit: ing.unit,
            unitCost: Number(ing.unitCost),
            totalCost: Number(ing.totalCost) * (mr.portions || 1),
            supplier: getSupplier(ing.ingredientName),
          });
        }
      }
    }
    consumption.push(...lineMap.values());
  }

  const fmt = (n: number) => `€${n.toFixed(2)}`;
  const totalCost = consumption.reduce((s, c) => s + c.totalCost, 0);

  return (
    <div>
      <PageHeader title={t("headerConsumption")} subtitle="Warehouse Consumption Forecaster / Αναφορά Ανάλωσης">
        <button onClick={() => window.print()} className="erp-btn-secondary">🖨️ {t("btnPrint")}</button>
        <button className="erp-btn-secondary">📄 {t("btnExportPDF")}</button>
      </PageHeader>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <KpiCard label={locale === "gr" ? "Σύνολο Αναλώσεων" : "Total Consumption"} value={fmt(totalCost)} color="blue" icon="📈" />
        <KpiCard label={locale === "gr" ? "Μοναδικά Υλικά" : "Unique Ingredients"} value={consumption.length} color="green" icon="🥘" />
        <KpiCard label={locale === "gr" ? "Μενού" : "Menu"} value={menu ? menu.title : "—"} color="purple" icon="🍽️" />
      </div>

      {/* Menu Selector */}
      <div className="erp-card mb-6">
        <div className="p-4">
          <label className="erp-label">{locale === "gr" ? "Επιλογή Μενού" : "Select Menu"}</label>
          <select value={selectedMenu} onChange={e => setSelectedMenu(Number(e.target.value))} className="erp-select max-w-md">
            <option value={0}>— {locale === "gr" ? "Επιλέξτε μενού" : "Select a menu"} —</option>
            {menus.map((m, idx) => <option key={m?.id ?? `menu-${idx}`} value={m?.id}>{m?.title} {m?.titleEn && `(${m.titleEn})`}</option>)}
          </select>
        </div>
      </div>

      {/* Consumption Table */}
      {menu && (
        <div className="erp-card">
          <div className="erp-card-header">
            <h3 className="font-semibold">📊 {locale === "gr" ? `Ανάλωση: ${menu.title}` : `Consumption: ${menu.titleEn || menu.title}`}</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="erp-table">
              <thead>
                <tr>
                  <th>A/A</th>
                  <th>{t("fieldProduct")}</th>
                  <th>{locale === "gr" ? "Ποσότητα" : "Quantity"}</th>
                  <th>{t("fieldUnit")}</th>
                  <th>{locale === "gr" ? "Τιμή Μονάδας" : "Unit Cost"}</th>
                  <th>{locale === "gr" ? "Σύνολο Κόστους" : "Total Cost"}</th>
                  <th>{t("fieldSupplier")}</th>
                </tr>
              </thead>
              <tbody>
                {consumption.map((c, i) => (
                  <tr key={i}>
                    <td className="text-xs text-slate-400">{i + 1}</td>
                    <td className="font-medium">{c.name}</td>
                    <td>{c.totalQty.toFixed(3)}</td>
                    <td><Badge color="grey">{c.unit}</Badge></td>
                    <td>{fmt(c.unitCost)}</td>
                    <td className="font-semibold">{fmt(c.totalCost)}</td>
                    <td className="text-sm text-slate-500">{c.supplier}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 font-bold">
                  <td colSpan={5} className="text-right">{t("total")}:</td>
                  <td className="text-lg text-emerald-700">{fmt(totalCost)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {!menu && (
        <div className="erp-card p-12 text-center text-slate-400">
          <div className="text-4xl mb-3">📈</div>
          <p>{locale === "gr" ? "Επιλέξτε ένα μενού για υπολογισμό ανάλωσης" : "Select a menu to calculate consumption forecast"}</p>
        </div>
      )}
    </div>
  );
}
