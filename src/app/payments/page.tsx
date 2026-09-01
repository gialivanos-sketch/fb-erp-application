"use client";
import { useState } from "react";
import { useLanguage } from "@/lib/context";
import { PageHeader, FilterBar, KpiCard, Badge } from "@/components/shared";
import * as db from "@/lib/supabaseData";

export default function PaymentsPage() {
  const { t, locale, data, refreshAll } = useLanguage();
  const suppliers = data.suppliers;
  const payments = data.supplierPayments;
  const [filterSupplier, setFilterSupplier] = useState(0);
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  // New payment form
  const [newDate, setNewDate] = useState(new Date().toISOString().split("T")[0]);
  const [newSupplier, setNewSupplier] = useState(0);
  const [newAmount, setNewAmount] = useState(0);
  const [newType, setNewType] = useState<"debit" | "payment">("payment");
  const [newRef, setNewRef] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const filtered = payments.filter(p => {
    if (!p) return false;
    if (filterSupplier && p.supplierId !== filterSupplier) return false;
    if (filterDateFrom && p.transactionDate < filterDateFrom) return false;
    if (filterDateTo && p.transactionDate > filterDateTo) return false;
    return true;
  });

  const totalInflow = filtered.filter(p => p.type === "payment").reduce((s, p) => s + Number(p.amount), 0);
  const totalOutflow = filtered.filter(p => p.type === "debit").reduce((s, p) => s + Number(p.amount), 0);
  const fmt = (n: number) => `€${n.toFixed(2)}`;

  async function addPayment() {
    if (!newSupplier || !newAmount) return;
    setSaving(true);
    try {
      await db.createPayment({ supplierId: newSupplier, transactionDate: newDate, amount: String(newAmount), type: newType, reference: newRef || null, notes: newNotes || null });
      await refreshAll();
      setNewAmount(0); setNewRef(""); setNewNotes("");
    } catch (err) {
      alert(locale === "gr" ? "Αποτυχία αποθήκευσης: " + String(err) : "Failed to save: " + String(err));
    } finally {
      setSaving(false);
    }
  }

  async function deletePayment(id: number) {
    setDeletingId(id);
    try {
      await db.deletePayment(id);
      await refreshAll();
    } catch (err) {
      alert(locale === "gr" ? "Αποτυχία διαγραφής: " + String(err) : "Failed to delete: " + String(err));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div>
      <PageHeader title={t("headerPayments")} subtitle="Καρτέλα Πληρωμών" />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <KpiCard label={t("kpiTotalPayments")} value={fmt(totalInflow)} color="green" icon="💰" subtitle={locale === "gr" ? "Εισροή" : "Inflow"} />
        <KpiCard label={locale === "gr" ? "Σύνολο Εξόδων" : "Total Outflows"} value={fmt(totalOutflow)} color="red" icon="📤" subtitle={locale === "gr" ? "Εκροή" : "Outflow"} />
        <KpiCard label={locale === "gr" ? "Καθαρό Υπόλοιπο" : "Net Balance"} value={fmt(totalInflow - totalOutflow)} color="blue" icon="⚖️" />
      </div>

      {/* New Transaction Form */}
      <div className="erp-card mb-6">
        <div className="erp-card-header"><h3 className="font-semibold">➕ {locale === "gr" ? "Νέα Συναλλαγή" : "New Transaction"}</h3></div>
        <div className="p-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div><label className="erp-label">{t("fieldTransactionDate")}</label><input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} className="erp-input" /></div>
            <div><label className="erp-label">{t("fieldSupplier")}</label>
              <select value={newSupplier} onChange={e => setNewSupplier(Number(e.target.value))} className="erp-select">
                <option value={0}>—</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{locale === "gr" ? s.name : (s.nameEn || s.name)}</option>)}
              </select>
            </div>
            <div><label className="erp-label">{t("fieldAmount")}</label><input type="number" value={newAmount || ""} onChange={e => setNewAmount(Number(e.target.value))} className="erp-input" step="0.01" /></div>
            <div><label className="erp-label">{locale === "gr" ? "Τύπος" : "Type"}</label>
              <select value={newType} onChange={e => setNewType(e.target.value as "debit" | "payment")} className="erp-select">
                <option value="payment">{locale === "gr" ? "Πληρωμή" : "Payment"}</option>
                <option value="debit">{locale === "gr" ? "Χρέωση" : "Debit"}</option>
              </select>
            </div>
            <div><label className="erp-label">{t("fieldReference")}</label><input type="text" value={newRef} onChange={e => setNewRef(e.target.value)} className="erp-input" placeholder="Bank Transfer" /></div>
            <div><label className="erp-label">{t("fieldNotes")}</label><input type="text" value={newNotes} onChange={e => setNewNotes(e.target.value)} className="erp-input" /></div>
          </div>
          <button onClick={addPayment} className="erp-btn-primary mt-3" disabled={!newSupplier || !newAmount || saving}>{saving ? "…" : "💾"} {t("btnSave")}</button>
        </div>
      </div>

      {/* Filters */}
      <FilterBar onClear={() => { setFilterSupplier(0); setFilterDateFrom(""); setFilterDateTo(""); }} clearLabel={t("btnClearFilters")}>
        <div>
          <label className="erp-label">{t("filterBySupplier")}</label>
          <select value={filterSupplier} onChange={e => setFilterSupplier(Number(e.target.value))} className="erp-select">
            <option value={0}>{t("filterAll")}</option>
            {suppliers.map(s => <option key={s.id} value={s.id}>{locale === "gr" ? s.name : (s.nameEn || s.name)}</option>)}
          </select>
        </div>
        <div><label className="erp-label">{t("fieldDateFrom")}</label><input type="date" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)} className="erp-input max-w-xs" /></div>
        <div><label className="erp-label">{t("fieldDateTo")}</label><input type="date" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)} className="erp-input max-w-xs" /></div>
      </FilterBar>

      {/* Transactions Table */}
      <div className="erp-card">
        <div className="overflow-x-auto">
          <table className="erp-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>{t("fieldTransactionDate")}</th>
                <th>{t("fieldSupplier")}</th>
                <th>{locale === "gr" ? "Τύπος" : "Type"}</th>
                <th>{t("fieldAmount")}</th>
                <th>{t("fieldReference")}</th>
                <th>{t("fieldNotes")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? <tr><td colSpan={8} className="text-center py-8 text-slate-400">{t("noData")}</td></tr> :
                filtered.map((p, idx) => (
                  <tr key={p?.id ?? `payment-${idx}`}>
                    <td className="text-xs text-slate-400">{p?.id ?? "—"}</td>
                    <td className="text-sm">{p?.transactionDate ?? "—"}</td>
                    <td className="text-sm">{locale === "gr" ? p?.supplierName : (p?.supplierNameEn || p?.supplierName)}</td>
                    <td><Badge color={p?.type === "payment" ? "green" : "red"}>{p?.type === "payment" ? (locale === "gr" ? "Πληρωμή" : "Payment") : (locale === "gr" ? "Χρέωση" : "Debit")}</Badge></td>
                    <td className={`font-semibold ${p?.type === "payment" ? "text-emerald-600" : "text-red-600"}`}>{fmt(Number(p?.amount ?? 0))}</td>
                    <td className="text-sm">{p?.reference || "—"}</td>
                    <td className="text-sm text-slate-500">{p?.notes || "—"}</td>
                    <td>
                      <button onClick={() => p?.id && deletePayment(p.id)} disabled={deletingId === p?.id} className="text-red-400 hover:text-red-600 text-xs">
                        {deletingId === p?.id ? "…" : "✕"}
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
