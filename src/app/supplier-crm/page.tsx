"use client";
import { useState } from "react";
import { useLanguage } from "@/lib/context";
import { PageHeader, FilterBar, KpiCard, Badge, Modal } from "@/components/shared";
import * as db from "@/lib/supabaseData";

export default function SupplierCRMPage() {
  const { t, locale, data, refreshAll } = useLanguage();
  const suppliers = data.suppliers;
  const payments = data.supplierPayments;
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newNameEn, setNewNameEn] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [newCategory, setNewCategory] = useState("Produce");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  function getSupplierPayments(sId: number) {
    return payments.filter(p => p?.supplierId === sId);
  }

  function getDebits(sId: number) {
    return getSupplierPayments(sId).filter(p => p.type === "debit").reduce((s, p) => s + Number(p.amount), 0);
  }

  function getPayments(sId: number) {
    return getSupplierPayments(sId).filter(p => p.type === "payment").reduce((s, p) => s + Number(p.amount), 0);
  }

  const totalDebits = payments.filter(p => p?.type === "debit").reduce((s, p) => s + Number(p.amount), 0);
  const totalPayments = payments.filter(p => p?.type === "payment").reduce((s, p) => s + Number(p.amount), 0);
  const openBalance = totalDebits - totalPayments;

  const fmt = (n: number) => `€${n.toFixed(2)}`;
  const categories = [...new Set(suppliers.map(s => s?.category).filter(Boolean))].sort();

  const filtered = suppliers.filter(s => {
    if (!s) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!s.name?.toLowerCase().includes(q) && !(s.nameEn && s.nameEn.toLowerCase().includes(q))) return false;
    }
    if (filterCategory && s.category !== filterCategory) return false;
    return true;
  });

  async function addSupplier() {
    if (!newName) return;
    setSaving(true);
    try {
      await db.createSupplier({ name: newName, nameEn: newNameEn || null, contactEmail: newEmail || null, contactPhone: newPhone || null, address: newAddress || null, category: newCategory });
      await refreshAll();
      setShowNew(false);
      setNewName(""); setNewNameEn(""); setNewEmail(""); setNewPhone(""); setNewAddress("");
    } catch (err) {
      alert(locale === "gr" ? "Αποτυχία αποθήκευσης: " + String(err) : "Failed to save: " + String(err));
    } finally {
      setSaving(false);
    }
  }

  async function deleteSupplier(id: number) {
    if (!confirm(t("deleteConfirm"))) return;
    setDeletingId(id);
    try {
      await db.deleteSupplier(id);
      await refreshAll();
    } catch (err) {
      alert(locale === "gr" ? "Αποτυχία διαγραφής: " + String(err) : "Failed to delete: " + String(err));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div>
      <PageHeader title={t("headerSupplierCRM")} subtitle="Καρτέλα Προμηθευτών & Οικονομικό Λογιστικό">
        <button onClick={() => setShowNew(true)} className="erp-btn-primary">➕ {t("btnNewSupplier")}</button>
      </PageHeader>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <KpiCard label={t("kpiTotalDebits")} value={fmt(totalDebits)} color="red" icon="📊" />
        <KpiCard label={t("kpiTotalPayments")} value={fmt(totalPayments)} color="green" icon="✅" />
        <KpiCard label={t("kpiOpenBalance")} value={fmt(openBalance)} color="amber" icon="⚖️" subtitle={locale === "gr" ? "Χρεώσεις - Πληρωμές" : "Debits - Payments"} />
      </div>

      <FilterBar onClear={() => { setSearch(""); setFilterCategory(""); }} clearLabel={t("btnClearFilters")}>
        <div>
          <label className="erp-label">{t("filterSearch")}</label>
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder={t("filterSearch")} className="filter-input" />
        </div>
        <div>
          <label className="erp-label">{t("filterByCategory")}</label>
          <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} className="erp-select max-w-xs">
            <option value="">{t("filterAll")}</option>
            {categories.map(c => <option key={c} value={c!}>{c}</option>)}
          </select>
        </div>
      </FilterBar>

      <div className="erp-card">
        <div className="overflow-x-auto">
          <table className="erp-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>{t("fieldName")}</th>
                <th>{t("fieldContactEmail")}</th>
                <th>{t("fieldContactPhone")}</th>
                <th>{t("fieldCategory")}</th>
                <th>{t("kpiTotalDebits")}</th>
                <th>{t("kpiTotalPayments")}</th>
                <th>{t("kpiOpenBalance")}</th>
                <th>{t("actions")}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-8 text-slate-400">{t("noData")}</td></tr>
              ) : filtered.map((s, idx) => {
                const debits = getDebits(s.id);
                const pays = getPayments(s.id);
                const balance = debits - pays;
                return (
                  <tr key={s?.id ?? `supplier-${idx}`}>
                    <td className="text-xs text-slate-400">{s?.id ?? "—"}</td>
                    <td>
                      <div className="font-medium">{locale === "gr" ? s?.name : (s?.nameEn || s?.name)}</div>
                      {s?.address && <div className="text-xs text-slate-400">{s.address}</div>}
                    </td>
                    <td className="text-sm">{s?.contactEmail || "—"}</td>
                    <td className="text-sm">{s?.contactPhone || "—"}</td>
                    <td><Badge color="grey">{s?.category ?? "—"}</Badge></td>
                    <td className="font-medium text-red-600">{fmt(debits)}</td>
                    <td className="font-medium text-emerald-600">{fmt(pays)}</td>
                    <td className={`font-bold ${balance > 0 ? "text-amber-600" : "text-emerald-600"}`}>{fmt(balance)}</td>
                    <td>
                      <button onClick={() => s?.id && deleteSupplier(s.id)} disabled={deletingId === s?.id} className="text-red-400 hover:text-red-600 text-sm">
                        {deletingId === s?.id ? "…" : t("btnDelete")}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* New Supplier Modal */}
      <Modal isOpen={showNew} onClose={() => setShowNew(false)} title={t("btnNewSupplier")}>
        <div className="space-y-4">
          <div><label className="erp-label">{locale === "gr" ? "Ελληνικό Όνομα" : "Greek Name"}</label><input type="text" value={newName} onChange={e => setNewName(e.target.value)} className="erp-input" /></div>
          <div><label className="erp-label">English Name</label><input type="text" value={newNameEn} onChange={e => setNewNameEn(e.target.value)} className="erp-input" /></div>
          <div><label className="erp-label">{t("fieldContactEmail")}</label><input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} className="erp-input" /></div>
          <div><label className="erp-label">{t("fieldContactPhone")}</label><input type="text" value={newPhone} onChange={e => setNewPhone(e.target.value)} className="erp-input" /></div>
          <div><label className="erp-label">{locale === "gr" ? "Διεύθυνση" : "Address"}</label><input type="text" value={newAddress} onChange={e => setNewAddress(e.target.value)} className="erp-input" /></div>
          <div><label className="erp-label">{t("fieldCategory")}</label>
            <select value={newCategory} onChange={e => setNewCategory(e.target.value)} className="erp-select">
              {["Produce","Grocery","Seafood","Cleaning","Beverages","Meat","Dairy"].map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="flex gap-2 pt-2">
            <button onClick={addSupplier} disabled={saving} className="erp-btn-primary">{saving ? "…" : t("btnSave")}</button>
            <button onClick={() => setShowNew(false)} disabled={saving} className="erp-btn-ghost">{t("btnCancel")}</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
