"use client";
import { useState, useMemo } from "react";
import { useLanguage } from "@/lib/context";
import { PageHeader, FilterBar, KpiCard } from "@/components/shared";
import * as db from "@/lib/supabaseData";

export default function OrderHistoryPage() {
  const { t, locale, data, refreshAll } = useLanguage();
  const items = data.orderItems;
  const [search, setSearch] = useState("");
  const [filterSupplier, setFilterSupplier] = useState("");
  const [deleteMsg, setDeleteMsg] = useState("");
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const suppliers = useMemo(() => [...new Set(items.map(i => i?.supplierName).filter(Boolean))].sort(), [items]);

  const filtered = useMemo(() => items.filter(i => {
    if (!i) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!i.productName?.toLowerCase().includes(q) && !(i.orderNumber && i.orderNumber.toLowerCase().includes(q)) && !(i.supplierName && i.supplierName.toLowerCase().includes(q))) return false;
    }
    if (filterSupplier && i.supplierName !== filterSupplier) return false;
    return true;
  }), [items, search, filterSupplier]);

  const columnLineTotal = filtered.reduce((s, i) => s + Number(i.grossAmount || 0), 0);
  const fmt = (n: number) => "€" + n.toFixed(2);

  async function deleteRow(id: number) {
    if (!confirm(t("deleteConfirm"))) return;
    setDeletingId(id);
    try {
      await db.deleteOrderItem(id);
      await refreshAll();
      setDeleteMsg(locale === "gr" ? "✅ Γραμμή διαγράφηκε" : "✅ Row deleted");
      setTimeout(() => setDeleteMsg(""), 2000);
    } catch (err) {
      setDeleteMsg(locale === "gr" ? "⚠️ Αποτυχία διαγραφής: " + String(err) : "⚠️ Failed to delete: " + String(err));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div>
      <PageHeader title={t("headerOrderHistory")} subtitle={locale === "gr" ? "Ιστορικό Στοιχείων Παραγγελίας" : "Line-Item Order History Log"}>
        <button onClick={() => window.print()} className="erp-btn-secondary">🖨️ {t("btnPrint")}</button>
      </PageHeader>

      {deleteMsg && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-300 text-amber-800 rounded-lg text-sm font-medium">{deleteMsg}</div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <KpiCard label={t("columnLineTotal")} value={fmt(columnLineTotal)} color="blue" icon="📋" subtitle={filtered.length + " " + (locale === "gr" ? "εγγραφές" : "entries")} />
        <KpiCard label={locale === "gr" ? "Στήλες Δεδομένων" : "Data Columns"} value={8} color="green" icon="📊" subtitle={locale === "gr" ? "ID, Ημ/νία, Προμηθευτής, Προϊόν, Ποσότητα, Τιμή, Μ.Μ., Σύνολο" : "ID, Date, Supplier, Product, Qty, Price, Unit, Total"} />
      </div>

      <FilterBar onClear={() => { setSearch(""); setFilterSupplier(""); }} clearLabel={t("btnClearFilters")}>
        <div><label className="erp-label">{t("filterSearch")}</label><input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder={t("filterSearch")} className="filter-input" /></div>
        <div>
          <label className="erp-label">{t("filterBySupplier")}</label>
          <select value={filterSupplier} onChange={e => setFilterSupplier(e.target.value)} className="erp-select">
            <option value="">{t("filterAll")}</option>
            {suppliers.map(s => <option key={s} value={s!}>{s}</option>)}
          </select>
        </div>
      </FilterBar>

      <div className="erp-card">
        <div className="erp-card-header">
          <h3 className="font-semibold">📋 {locale === "gr" ? "Ιστορικό Στοιχείων Παραγγελίας (Granular Flat-Table)" : "Order Line-Item History (Granular Flat-Table)"}</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="erp-table">
            <thead>
              <tr>
                <th>{t("idField")}</th>
                <th>{locale === "gr" ? "Ημερομηνία" : "Date"}</th>
                <th>{t("fieldSupplier")}</th>
                <th>{t("fieldProduct")}</th>
                <th>{locale === "gr" ? "Ποσότητα" : "Quantity"}</th>
                <th>{t("fieldPrice")}</th>
                <th>{locale === "gr" ? "Μ.Μ." : "UoM"}</th>
                <th>{t("columnLineTotal")}</th>
                <th>{t("deleteRow")}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? <tr><td colSpan={9} className="text-center py-8 text-slate-400">{t("noData")}</td></tr> :
                filtered.map((i, idx) => (
                  <tr key={i?.id ?? `item-${idx}`} className="hover:bg-slate-50">
                    <td className="font-mono text-xs text-slate-500">{i?.id ?? "—"}</td>
                    <td className="text-sm">{i?.orderDate ?? "—"}</td>
                    <td className="text-sm font-medium">{locale === "gr" ? i?.supplierName : (i?.supplierNameEn || i?.supplierName)}</td>
                    <td className="font-medium">{i?.productName ?? "—"}</td>
                    <td>{Number(i?.orderedQuantity ?? 0).toFixed(2)} {i?.deliveredQuantity && Number(i.deliveredQuantity) !== Number(i.orderedQuantity)
                      ? <span className="text-xs text-amber-600 ml-1">({Number(i.deliveredQuantity).toFixed(2)} recv.)</span>
                      : null}</td>
                    <td>{fmt(Number(i?.basePrice ?? 0))}</td>
                    <td><span className="px-2 py-0.5 bg-slate-100 rounded text-xs">{i?.unit ?? "—"}</span></td>
                    <td className="font-semibold text-emerald-700">{fmt(Number(i?.grossAmount ?? 0))}</td>
                    <td>
                      <button onClick={() => i?.id && deleteRow(i.id)} disabled={deletingId === i?.id} className="erp-btn-danger text-xs px-2 py-1">
                        {deletingId === i?.id ? "…" : "🗑️"} {t("deleteRow")}
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
            {filtered.length > 0 && (
              <tfoot>
                <tr className="bg-slate-50 font-bold text-sm">
                  <td colSpan={7} className="text-right py-3">{t("columnLineTotal")}:</td>
                  <td className="text-emerald-700 text-base py-3">{fmt(columnLineTotal)}</td>
                  <td></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
