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
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [shown, setShown] = useState(300);

  const suppliers = useMemo(() => [...new Set(items.map(i => i?.supplierName).filter(Boolean))].sort(), [items]);

  const filtered = useMemo(() => items.filter(i => {
    if (!i) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!i.productName?.toLowerCase().includes(q) && !(i.orderNumber && i.orderNumber.toLowerCase().includes(q)) && !(i.supplierName && i.supplierName.toLowerCase().includes(q))) return false;
    }
    if (filterSupplier && i.supplierName !== filterSupplier) return false;
    if (dateFrom && (i.orderDate ?? "") < dateFrom) return false;
    if (dateTo && (i.orderDate ?? "") > dateTo) return false;
    return true;
  }).sort((a, b) => (b.orderDate ?? "").localeCompare(a.orderDate ?? "") || b.id - a.id), [items, search, filterSupplier, dateFrom, dateTo]);

  const totalNet = filtered.reduce((s, i) => s + Number(i.netAmount || 0), 0);
  const totalVat = filtered.reduce((s, i) => s + Number(i.vatAmount || 0), 0);
  const columnLineTotal = filtered.reduce((s, i) => s + Number(i.grossAmount || 0), 0);
  const fmt = (n: number) => "€" + n.toLocaleString("el-GR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtPrice = (n: number) => "€" + n.toLocaleString("el-GR", { minimumFractionDigits: 2, maximumFractionDigits: 4 });

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

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <KpiCard label={locale === "gr" ? "Σύνολο χωρίς ΦΠΑ" : "Net Total"} value={fmt(totalNet)} color="blue" icon="💶" subtitle={filtered.length + " " + (locale === "gr" ? "εγγραφές" : "entries")} />
        <KpiCard label={locale === "gr" ? "ΦΠΑ" : "VAT"} value={fmt(totalVat)} color="amber" icon="🧾" />
        <KpiCard label={locale === "gr" ? "Σύνολο με ΦΠΑ" : "Gross Total"} value={fmt(columnLineTotal)} color="green" icon="💰" />
      </div>

      <FilterBar onClear={() => { setSearch(""); setFilterSupplier(""); setDateFrom(""); setDateTo(""); }} clearLabel={t("btnClearFilters")}>
        <div><label className="erp-label">{t("filterSearch")}</label><input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder={t("filterSearch")} className="filter-input" /></div>
        <div>
          <label className="erp-label">{t("filterBySupplier")}</label>
          <select value={filterSupplier} onChange={e => setFilterSupplier(e.target.value)} className="erp-select">
            <option value="">{t("filterAll")}</option>
            {suppliers.map(s => <option key={s} value={s!}>{s}</option>)}
          </select>
        </div>
        <div><label className="erp-label">{t("fieldDateFrom")}</label><input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="erp-input max-w-xs" /></div>
        <div><label className="erp-label">{t("fieldDateTo")}</label><input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="erp-input max-w-xs" /></div>
      </FilterBar>

      <div className="erp-card">
        <div className="erp-card-header">
          <h3 className="font-semibold">📋 {locale === "gr" ? "Ιστορικό Στοιχείων Παραγγελίας (Granular Flat-Table)" : "Order Line-Item History (Granular Flat-Table)"}</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="erp-table">
            <thead>
              <tr>
                <th>{locale === "gr" ? "Ημερομηνία" : "Date"}</th>
                <th>{locale === "gr" ? "Παραγγελία" : "Order"}</th>
                <th>{t("fieldSupplier")}</th>
                <th>{t("fieldProduct")}</th>
                <th>{locale === "gr" ? "Ποσότητα" : "Quantity"}</th>
                <th>{locale === "gr" ? "Μ.Μ." : "UoM"}</th>
                <th className="text-right">{locale === "gr" ? "Τιμή χωρίς ΦΠΑ" : "Net Price"}</th>
                <th className="text-right">{locale === "gr" ? "ΦΠΑ %" : "VAT %"}</th>
                <th className="text-right">{locale === "gr" ? "Τιμή με ΦΠΑ" : "Gross Price"}</th>
                <th className="text-right">{locale === "gr" ? "Σύνολο χωρίς ΦΠΑ" : "Net Total"}</th>
                <th className="text-right">{locale === "gr" ? "Σύνολο με ΦΠΑ" : "Gross Total"}</th>
                <th>{t("deleteRow")}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? <tr><td colSpan={12} className="text-center py-8 text-slate-400">{t("noData")}</td></tr> :
                filtered.slice(0, shown).map((i, idx) => (
                  <tr key={i?.id ?? `item-${idx}`} className="hover:bg-slate-50">
                    <td className="text-sm whitespace-nowrap">{i?.orderDate ?? "—"}</td>
                    <td className="font-mono text-xs text-slate-500">{i?.orderNumber ?? "—"}</td>
                    <td className="text-sm font-medium">{locale === "gr" ? i?.supplierName : (i?.supplierNameEn || i?.supplierName)}</td>
                    <td className="font-medium">{i?.productName ?? "—"}</td>
                    <td>{Number(i?.orderedQuantity ?? 0).toFixed(2)} {i?.deliveredQuantity && Number(i.deliveredQuantity) !== Number(i.orderedQuantity)
                      ? <span className="text-xs text-amber-600 ml-1">({Number(i.deliveredQuantity).toFixed(2)} recv.)</span>
                      : null}</td>
                    <td><span className="px-2 py-0.5 bg-slate-100 rounded text-xs">{i?.unit ?? "—"}</span></td>
                    <td className="text-right">{fmtPrice(Number(i?.basePrice ?? 0))}</td>
                    <td className="text-right text-xs text-slate-500">{Number(i?.vatPercent ?? 0)}%</td>
                    <td className="text-right">{fmtPrice(Number(i?.basePrice ?? 0) * (1 + Number(i?.vatPercent ?? 0) / 100))}</td>
                    <td className="text-right">{fmt(Number(i?.netAmount ?? 0))}</td>
                    <td className="text-right font-semibold text-emerald-700">{fmt(Number(i?.grossAmount ?? 0))}</td>
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
                  <td colSpan={9} className="text-right py-3">{locale === "gr" ? "Σύνολο" : "Total"}:</td>
                  <td className="text-right py-3">{fmt(totalNet)}</td>
                  <td className="text-right text-emerald-700 text-base py-3">{fmt(columnLineTotal)}</td>
                  <td></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        {filtered.length > shown && (
          <div className="p-4 text-center">
            <button onClick={() => setShown(n => n + 500)} className="erp-btn-secondary text-sm">
              {locale === "gr" ? `Εμφάνιση περισσότερων (${shown} από ${filtered.length})` : `Show more (${shown} of ${filtered.length})`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
