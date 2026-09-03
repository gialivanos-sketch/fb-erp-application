"use client";
import { useMemo, useState } from "react";
import { useLanguage } from "@/lib/context";
import { PageHeader, FilterBar, KpiCard, Badge, Modal } from "@/components/shared";
import * as db from "@/lib/supabaseData";

// Αφαιρεί τόνους/διαλυτικά και κάνει κεφαλαία, ώστε η αναζήτηση να
// ταιριάζει ανεξάρτητα από τόνους (ίδιο helper με τη σελίδα Παραγγελίας
// Πρόχειρου -- βλέπε src/app/draft-order/page.tsx).
const GREEK_ACCENT_MAP: Record<string, string> = {
  "Ά": "Α", "Έ": "Ε", "Ή": "Η", "Ί": "Ι", "Ϊ": "Ι", "Ό": "Ο", "Ύ": "Υ", "Ϋ": "Υ", "Ώ": "Ω",
  "ά": "α", "έ": "ε", "ή": "η", "ί": "ι", "ϊ": "ι", "ΐ": "ι", "ό": "ο", "ύ": "υ", "ϋ": "υ", "ΰ": "υ", "ώ": "ω",
};
function normalizeGreek(s: string): string {
  let out = "";
  for (const ch of s) out += GREEK_ACCENT_MAP[ch] ?? ch;
  return out.toUpperCase();
}

export default function IngredientsPage() {
  const { t, locale, data, refreshAll } = useLanguage();
  const ingredients = data.ingredients;
  const [search, setSearch] = useState("");
  const [filterUnit, setFilterUnit] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | "active" | "inactive">("all");
  const [filterUsage, setFilterUsage] = useState<"all" | "unused" | "used">("all");
  const [filterZeroPrice, setFilterZeroPrice] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMsg, setBulkMsg] = useState("");
  const [form, setForm] = useState({ sku: "", name: "", nameEn: "", currentStock: "0", unit: "kg", basePrice: "0", conversionFactor: "1", conversionPerUnit: "", wastageFactor: "0", calories: 0 });

  // Ποια ingredientId χρησιμοποιούνται σε τουλάχιστον μία συνταγή --
  // αυτό είναι το κριτήριο "χρησιμοποιείται" για το φίλτρο Χρήσης, και
  // δίνει στον χρήστη έναν αξιόπιστο τρόπο να εντοπίσει τι είναι από
  // μαζική εισαγωγή και ασφαλές να διαγραφεί (δεν το χρησιμοποιεί καμία συνταγή).
  const usedIngredientIds = useMemo(() => {
    const set = new Set<number>();
    for (const r of data.recipes) {
      for (const ri of r.ingredients) {
        if (ri.ingredientId) set.add(ri.ingredientId);
      }
    }
    return set;
  }, [data.recipes]);

  const availableUnits = useMemo(() => {
    const set = new Set<string>();
    for (const i of ingredients) if (i?.unit) set.add(i.unit);
    return Array.from(set).sort();
  }, [ingredients]);

  const filtered = useMemo(() => {
    const q = normalizeGreek(search.trim());
    return ingredients.filter((i) => {
      if (q) {
        const hay = normalizeGreek(`${i?.name ?? ""} ${i?.nameEn ?? ""} ${i?.sku ?? ""}`);
        if (!hay.includes(q)) return false;
      }
      if (filterUnit && i?.unit !== filterUnit) return false;
      if (filterStatus === "active" && !i?.isActive) return false;
      if (filterStatus === "inactive" && i?.isActive) return false;
      const isUsed = i?.id != null && usedIngredientIds.has(i.id);
      if (filterUsage === "unused" && isUsed) return false;
      if (filterUsage === "used" && !isUsed) return false;
      if (filterZeroPrice && Number(i?.basePrice ?? 0) !== 0) return false;
      return true;
    });
  }, [ingredients, search, filterUnit, filterStatus, filterUsage, filterZeroPrice, usedIngredientIds]);

  const activeCount = ingredients.filter(i => i?.isActive).length;
  const unusedCount = ingredients.filter(i => i?.id != null && !usedIngredientIds.has(i.id)).length;
  const totalStockValue = ingredients.reduce((s, i) => s + (Number(i?.currentStock ?? 0) * Number(i?.basePrice ?? 0)), 0);
  const totalCalories = ingredients.reduce((s, i) => s + (i?.calories || 0), 0);
  const fmt = (n: number) => `€${n.toFixed(2)}`;

  function clearFilters() {
    setSearch(""); setFilterUnit(""); setFilterStatus("all"); setFilterUsage("all"); setFilterZeroPrice(false);
  }

  function toggleOne(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAllFiltered() {
    setSelected((prev) => {
      const filteredIds = filtered.map((i) => i?.id).filter((id): id is number => id != null);
      const allSelected = filteredIds.length > 0 && filteredIds.every((id) => prev.has(id));
      if (allSelected) return new Set();
      return new Set(filteredIds);
    });
  }

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
      setSelected((prev) => { const next = new Set(prev); next.delete(id); return next; });
      await refreshAll();
    } catch (err) {
      alert(locale === "gr" ? "Αποτυχία διαγραφής: " + String(err) : "Failed to delete: " + String(err));
    } finally {
      setDeletingId(null);
    }
  }

  async function deleteSelected() {
    if (selected.size === 0) return;
    if (!confirm(t("confirmBulkDelete"))) return;
    setBulkBusy(true);
    setBulkMsg("");
    let deleted = 0, skipped = 0;
    try {
      for (const id of selected) {
        try {
          await db.deleteIngredient(id);
          deleted++;
        } catch {
          // Πιθανότατα foreign-key: το υλικό χρησιμοποιείται ήδη σε
          // συνταγή -- παραλείπεται με ασφάλεια αντί να μπλοκάρει
          // ολόκληρη τη μαζική διαγραφή.
          skipped++;
        }
      }
      await refreshAll();
      setSelected(new Set());
      setBulkMsg(`✅ ${t("bulkDeleteResult")}: ${deleted}${skipped > 0 ? ` — ${skipped} ${t("bulkDeleteSkipped")}` : ""}`);
      setTimeout(() => setBulkMsg(""), 6000);
    } finally {
      setBulkBusy(false);
    }
  }

  const filteredIds = filtered.map((i) => i?.id).filter((id): id is number => id != null);
  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every((id) => selected.has(id));

  return (
    <div className="pb-24">
      <PageHeader title={t("headerIngredients")} subtitle="Master Ingredients Register / Σελίδα Με Υλικά">
        <button onClick={() => setShowNew(true)} className="erp-btn-primary">➕ {t("addNewIngredient")}</button>
      </PageHeader>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        <KpiCard label={locale === "gr" ? "Σύνολο Υλικών" : "Total Ingredients"} value={ingredients.length} color="blue" icon="🥘" />
        <KpiCard label={locale === "gr" ? "Ενεργά" : "Active"} value={activeCount} color="green" icon="✅" />
        <KpiCard label={locale === "gr" ? "Αχρησιμοποίητα" : "Unused"} value={unusedCount} color="red" icon="🗑️" subtitle={locale === "gr" ? "Καμία συνταγή δεν τα χρησιμοποιεί" : "No recipe uses them"} />
        <KpiCard label={locale === "gr" ? "Αξία Αποθέματος" : "Stock Value"} value={fmt(totalStockValue)} color="amber" icon="💰" />
        <KpiCard label={locale === "gr" ? "Σύνολο Θερμίδων" : "Total Calories"} value={totalCalories.toLocaleString()} color="red" icon="🔥" />
      </div>

      <FilterBar onClear={clearFilters} clearLabel={t("btnClearFilters")}>
        <div><label className="erp-label">{t("filterSearch")}</label><input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder={`${t("fieldProduct")}, SKU...`} className="filter-input" /></div>
        <div>
          <label className="erp-label">{t("filterUnit")}</label>
          <select value={filterUnit} onChange={(e) => setFilterUnit(e.target.value)} className="erp-select">
            <option value="">{t("filterAllUnits")}</option>
            {availableUnits.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
        <div>
          <label className="erp-label">{t("filterActiveStatus")}</label>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as typeof filterStatus)} className="erp-select">
            <option value="all">{t("filterAllStatuses")}</option>
            <option value="active">{t("filterActiveOnly")}</option>
            <option value="inactive">{t("filterInactiveOnly")}</option>
          </select>
        </div>
        <div>
          <label className="erp-label">{t("filterUsage")}</label>
          <select value={filterUsage} onChange={(e) => setFilterUsage(e.target.value as typeof filterUsage)} className="erp-select">
            <option value="all">{t("filterUsageAll")}</option>
            <option value="unused">{t("filterUsageUnused")}</option>
            <option value="used">{t("filterUsageUsed")}</option>
          </select>
        </div>
        <div className="flex items-end pb-2">
          <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
            <input type="checkbox" checked={filterZeroPrice} onChange={(e) => setFilterZeroPrice(e.target.checked)} className="w-4 h-4" />
            {t("filterZeroPrice")}
          </label>
        </div>
      </FilterBar>

      <div className="text-xs text-slate-500 mb-2">
        {filtered.length} {t("showingOf")} {ingredients.length}
      </div>

      <div className="erp-card">
        <div className="overflow-x-auto">
          <table className="erp-table">
            <thead>
              <tr>
                <th className="w-8">
                  <input type="checkbox" checked={allFilteredSelected} onChange={toggleAllFiltered} className="w-4 h-4" title={t("selectAllFiltered")} />
                </th>
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
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? <tr><td colSpan={12} className="text-center py-8 text-slate-400">{t("noData")}</td></tr> :
                filtered.map((i, idx) => {
                  const isUsed = i?.id != null && usedIngredientIds.has(i.id);
                  return (
                  <tr key={i?.id ?? `ing-${idx}`} className={i?.id != null && selected.has(i.id) ? "bg-blue-50" : undefined}>
                    <td>
                      {i?.id != null && (
                        <input type="checkbox" checked={selected.has(i.id)} onChange={() => toggleOne(i.id)} className="w-4 h-4" />
                      )}
                    </td>
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
                    <td>{!isUsed && <Badge color="amber">{t("badgeUnused")}</Badge>}</td>
                    <td>
                      <button onClick={() => i?.id && deleteIngredient(i.id)} disabled={deletingId === i?.id} className="text-red-400 hover:text-red-600 text-xs">
                        {deletingId === i?.id ? "…" : t("btnDelete")}
                      </button>
                    </td>
                  </tr>
                  );
                })}
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

      {/* Floating bulk-delete bar -- εμφανίζεται μόνο όταν υπάρχει έστω μία επιλογή */}
      {selected.size > 0 && (
        <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:w-[420px] max-w-[95vw] z-50 bg-white border-2 border-red-300 shadow-2xl rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="font-semibold text-slate-800">{selected.size} {t("selectedCount")}</div>
            <button onClick={() => setSelected(new Set())} className="erp-btn-ghost text-xs">✕ {locale === "gr" ? "Καθαρισμός" : "Clear"}</button>
          </div>
          <button onClick={deleteSelected} disabled={bulkBusy} className="erp-btn-danger w-full py-2.5 font-semibold">
            {bulkBusy ? "…" : t("btnDeleteSelected")}
          </button>
          {bulkMsg && <div className="text-xs text-slate-600 mt-2">{bulkMsg}</div>}
        </div>
      )}
    </div>
  );
}
