"use client";
import { useState } from "react";
import { useLanguage } from "@/lib/context";
import { PageHeader, FilterBar, KpiCard, Badge, Modal } from "@/components/shared";
import * as db from "@/lib/supabaseData";

export default function IngredientsPage() {
  const { t, locale, data, refreshAll } = useLanguage();
  const ingredients = data.ingredients;
  const [search, setSearch] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [form, setForm] = useState({ sku: "", name: "", nameEn: "", currentStock: "0", unit: "kg", basePrice: "0", conversionFactor: "1", conversionPerUnit: "", wastageFactor: "0", calories: 0 });

  const filtered = ingredients.filter(i => {
    if (search) {
      const q = search.toLowerCase();
      return i?.name?.toLowerCase().includes(q) || (i?.nameEn && i.nameEn.toLowerCase().includes(q)) || i?.sku?.toLowerCase().includes(q);
    }
    return true;
  });

  const activeCount = ingredients.filter(i => i?.isActive).length;
  const totalStockValue = ingredients.reduce((s, i) => s + (Number(i?.currentStock ?? 0) * Number(i?.basePrice ?? 0)), 0);
  const totalCalories = ingredients.reduce((s, i) => s + (i?.calories || 0), 0);
  const fmt = (n: number) => `€${n.toFixed(2)}`;

  async function addIngredient() {
    if (!form.name || !form.sku) return;
    setSaving(true);
    try {
      await db.createIngredient({
        sku: form.sku, name: form.name, nameEn: form.nameEn || null, currentStock: form.currentStock,
        unit: form.unit, basePrice: form.basePrice, conversionFactor: form.conversionFactor,
        conversionPerUnit: form.conversionPerUnit || null, wastageFactor: form.wastageFactor, calories: form.calories,
      });
      await refreshAll();
      setShowNew(false);
      setForm({ sku: "", name: "", nameEn: "", currentStock: "0", unit: "kg", basePrice: "0", conversionFactor: "1", conversionPerUnit: "", wastageFactor: "0", calories: 0 });
    } catch (err) {
      alert(locale === "gr" ? "Αποτυχία αποθήκευσης: " + String(err) : "Failed to save: " + String(err));
    } finally {
      setSaving(false);
    }
  }

  async function deleteIngredient(id: number) {
    if (!confirm(t("deleteConfirm"))) return;
    setDeletingId(id);
    try {
      await db.deleteIngredient(id);
      await refreshAll();
    } catch (err) {
      alert(locale === "gr" ? "Αποτυχία διαγραφής: " + String(err) : "Failed to delete: " + String(err));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div>
      <PageHeader title={t("headerIngredients")} subtitle="Master Ingredients Register / Σελίδα Με Υλικά">
        <button onClick={() => setShowNew(true)} className="erp-btn-primary">➕ {t("addNewIngredient")}</button>
      </PageHeader>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard label={locale === "gr" ? "Σύνολο Υλικών" : "Total Ingredients"} value={ingredients.length} color="blue" icon="🥘" />
        <KpiCard label={locale === "gr" ? "Ενεργά" : "Active"} value={activeCount} color="green" icon="✅" />
        <KpiCard label={locale === "gr" ? "Αξία Αποθέματος" : "Stock Value"} value={fmt(totalStockValue)} color="amber" icon="💰" />
        <KpiCard label={locale === "gr" ? "Σύνολο Θερμίδων" : "Total Calories"} value={totalCalories.toLocaleString()} color="red" icon="🔥" />
      </div>

      <FilterBar onClear={() => setSearch("")} clearLabel={t("btnClearFilters")}>
        <div><label className="erp-label">{t("filterSearch")}</label><input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder={`${t("fieldProduct")}, SKU...`} className="filter-input" /></div>
      </FilterBar>

      <div className="erp-card">
        <div className="overflow-x-auto">
          <table className="erp-table">
            <thead>
              <tr>
                <th>{t("fieldSku")}</th>
                <th>{t("fieldName")}</th>
                <th>{t("fieldStock")}</th>
                <th>{t("fieldUnit")}</th>
                <th>{t("fieldBasePrice")}</th>
                <th>{locale === "gr" ? "Μετατροπή" : "Conversion"}</th>
                <th>{t("fieldWastage")}</th>
                <th>{t("fieldCalories")}</th>
                <th>{t("fieldIsActive")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? <tr><td colSpan={10} className="text-center py-8 text-slate-400">{t("noData")}</td></tr> :
                filtered.map((i, idx) => (
                  <tr key={i?.id ?? `ing-${idx}`}>
                    <td className="font-mono text-xs">{i?.sku ?? "—"}</td>
                    <td>
                      <div className="font-medium">{i?.name ?? "—"}</div>
                      {i?.nameEn && <div className="text-xs text-slate-400">{i.nameEn}</div>}
                    </td>
                    <td>{Number(i?.currentStock ?? 0).toFixed(2)}</td>
                    <td><Badge color="grey">{i?.unit ?? "—"}</Badge></td>
                    <td className="font-semibold">{fmt(Number(i?.basePrice ?? 0))}</td>
                    <td className="text-xs text-slate-500">{i?.conversionPerUnit || `${i?.conversionFactor ?? 1}x`}</td>
                    <td>{i?.wastageFactor ?? 0}%</td>
                    <td>{i?.calories || 0}</td>
                    <td><Badge color={i?.isActive ? "green" : "red"}>{i?.isActive ? "✓" : "✕"}</Badge></td>
                    <td>
                      <button onClick={() => i?.id && deleteIngredient(i.id)} disabled={deletingId === i?.id} className="text-red-400 hover:text-red-600 text-xs">
                        {deletingId === i?.id ? "…" : t("btnDelete")}
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Ingredient Modal */}
      <Modal isOpen={showNew} onClose={() => setShowNew(false)} title={t("addNewIngredient")}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="erp-label">{t("fieldSku")}</label><input type="text" value={form.sku} onChange={e => setForm({ ...form, sku: e.target.value })} className="erp-input" placeholder="ING-021" /></div>
            <div><label className="erp-label">{locale === "gr" ? "Μονάδα" : "Unit"}</label>
              <select value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} className="erp-select">
                {["kg","g","L","ml","pcs"].map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </div>
          <div><label className="erp-label">{locale === "gr" ? "Ελληνικό Όνομα" : "Greek Name"}</label><input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="erp-input" /></div>
          <div><label className="erp-label">English Name</label><input type="text" value={form.nameEn} onChange={e => setForm({ ...form, nameEn: e.target.value })} className="erp-input" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="erp-label">{locale === "gr" ? "Τρέχον Απόθεμα" : "Current Stock"}</label><input type="number" value={form.currentStock} onChange={e => setForm({ ...form, currentStock: e.target.value })} className="erp-input" step="0.01" /></div>
            <div><label className="erp-label">{t("fieldBasePrice")}</label><input type="number" value={form.basePrice} onChange={e => setForm({ ...form, basePrice: e.target.value })} className="erp-input" step="0.01" /></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="erp-label">{t("fieldConversionFactor")}</label><input type="number" value={form.conversionFactor} onChange={e => setForm({ ...form, conversionFactor: e.target.value })} className="erp-input" step="0.001" /></div>
            <div><label className="erp-label">{t("fieldWastage")}</label><input type="number" value={form.wastageFactor} onChange={e => setForm({ ...form, wastageFactor: e.target.value })} className="erp-input" step="0.1" /></div>
            <div><label className="erp-label">{t("fieldCalories")}</label><input type="number" value={form.calories} onChange={e => setForm({ ...form, calories: Number(e.target.value) })} className="erp-input" /></div>
          </div>
          <div><label className="erp-label">{t("fieldConversionPerUnit")}</label><input type="text" value={form.conversionPerUnit} onChange={e => setForm({ ...form, conversionPerUnit: e.target.value })} className="erp-input" placeholder="1 Item = 250 g" /></div>
          <div className="flex gap-2 pt-2">
            <button onClick={addIngredient} disabled={saving} className="erp-btn-primary">{saving ? "…" : t("btnSave")}</button>
            <button onClick={() => setShowNew(false)} disabled={saving} className="erp-btn-ghost">{t("btnCancel")}</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
