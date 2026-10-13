"use client";
import { useState } from "react";
import { useLanguage } from "@/lib/context";
import { PageHeader, FilterBar, KpiCard, Badge, Modal } from "@/components/shared";
import type { Order } from "@/lib/types";
import * as db from "@/lib/supabaseData";

interface RestoreItem {
  id?: number;
  orderId?: number;
  productName: string;
  orderedQuantity: number;
  deliveredQuantity: number;
  unit: string;
  basePrice: number;
  vatPercent: number;
  discountPercent: number;
  netAmount: number;
  vatAmount: number;
  grossAmount: number;
}

export default function OrdersArchivePage() {
  const { t, locale, data, refreshAll } = useLanguage();
  const orders = data.orders;
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  // Restore modal
  const [showRestore, setShowRestore] = useState(false);
  const [restoreItems, setRestoreItems] = useState<RestoreItem[]>([]);
  const [restoreInvoiceNum, setRestoreInvoiceNum] = useState("");
  const [restoreMsg, setRestoreMsg] = useState("");

  const filtered = orders.filter(o => {
    if (!o) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!o.orderNumber?.toLowerCase().includes(q) && !(o.supplierName && o.supplierName.toLowerCase().includes(q)) && !(o.invoiceNumber && o.invoiceNumber.toLowerCase().includes(q))) return false;
    }
    if (filterStatus && o.status !== filterStatus) return false;
    if (filterDateFrom && o.orderDate < filterDateFrom) return false;
    if (filterDateTo && o.orderDate > filterDateTo) return false;
    return true;
  });

  const masterTotal = filtered.reduce((s, o) => s + Number(o.totalGross || 0), 0);
  const fmt = (n: number) => "€" + n.toLocaleString("el-GR", { minimumFractionDigits: 2 });

  async function deleteOrder(id: number) {
    if (!confirm(t("deleteConfirm"))) return;
    setDeletingId(id);
    try {
      await db.deleteOrder(id);
      await refreshAll();
    } catch (err) {
      alert(locale === "gr" ? "Αποτυχία διαγραφής: " + String(err) : "Failed to delete: " + String(err));
    } finally {
      setDeletingId(null);
    }
  }

  // Restore order: pulls its line items from already-loaded data — no
  // extra network round trip needed, since fetchOrderItems() already
  // loaded every item for every order into `data.orderItems`.
  function restoreOrder(order: Order) {
    setSelectedOrder(order);
    setRestoreInvoiceNum(order.invoiceNumber || "");
    const orderItems = data.orderItems.filter((i) => i.orderId === order.id);
    setRestoreItems(orderItems.map((i) => ({
      id: i.id,
      orderId: i.orderId,
      productName: i.productName || "",
      orderedQuantity: Number(i.orderedQuantity || 0),
      deliveredQuantity: Number(i.deliveredQuantity || i.orderedQuantity || 0),
      unit: i.unit || "kg",
      basePrice: Number(i.basePrice || 0),
      vatPercent: Number(i.vatPercent || 24),
      discountPercent: Number(i.discountPercent || 0),
      netAmount: Number(i.netAmount || 0),
      vatAmount: Number(i.vatAmount || 0),
      grossAmount: Number(i.grossAmount || 0),
    })));
    setRestoreMsg("");
    setShowRestore(true);
  }

  function updateRestoreItem(idx: number, field: string, value: number | string) {
    setRestoreItems(prev => prev.map((item, i) => {
      if (i !== idx) return item;
      const updated = { ...item, [field]: typeof value === "string" && field !== "productName" ? Number(value) : value };
      if (field === "deliveredQuantity" || field === "basePrice") {
        const net = Number(updated.basePrice) * Number(updated.deliveredQuantity || updated.orderedQuantity) * (1 - (Number(updated.discountPercent) || 0) / 100);
        const vatAmt = net * (Number(updated.vatPercent) / 100);
        updated.netAmount = net;
        updated.vatAmount = vatAmt;
        updated.grossAmount = net + vatAmt;
      }
      return updated;
    }));
  }

  async function handleSaveRestore() {
    if (!selectedOrder) return;
    setSaving(true);
    try {
      const totalNet = restoreItems.reduce((s, i) => s + i.netAmount, 0).toFixed(2);
      const totalVat = restoreItems.reduce((s, i) => s + i.vatAmount, 0).toFixed(2);
      const totalGross = restoreItems.reduce((s, i) => s + i.grossAmount, 0).toFixed(2);
      await db.updateOrderStatus(selectedOrder.id, {
        invoiceNumber: restoreInvoiceNum, status: "delivered", totalNet, totalVat, totalGross,
      });
      // Line items are updated in parallel — each is an independent row,
      // so there's no ordering dependency between these writes.
      await Promise.all(
        restoreItems
          .filter((item) => item.id != null)
          .map((item) =>
            db.updateOrderItem(item.id as number, {
              deliveredQuantity: item.deliveredQuantity,
              basePrice: item.basePrice,
              netAmount: item.netAmount,
              vatAmount: item.vatAmount,
              grossAmount: item.grossAmount,
            })
          )
      );
      await refreshAll();
      setRestoreMsg(locale === "gr" ? "✅ Παραγγελία ενημερώθηκε και τιμολόγιο καταχωρήθηκε!" : "✅ Order updated and invoice recorded!");
      setTimeout(() => { setShowRestore(false); setRestoreMsg(""); }, 1500);
    } catch (err) {
      setRestoreMsg(locale === "gr" ? "⚠️ Αποτυχία αποθήκευσης: " + String(err) : "⚠️ Failed to save: " + String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader title={t("headerOrdersArchive")} subtitle={locale === "gr" ? "Ιστορικό Παραγγελιών" : "Orders Archive Log"}>
        <button onClick={() => window.print()} className="erp-btn-secondary">🖨️ {t("btnPrint")}</button>
      </PageHeader>

      <div className="mb-6">
        <KpiCard label={t("kpiMasterPurchaseValue")} value={fmt(masterTotal)} color="blue" icon="💰" subtitle={filtered.length + " " + (locale === "gr" ? "παραγγελίες" : "orders")} />
      </div>

      <FilterBar onClear={() => { setSearch(""); setFilterStatus(""); setFilterDateFrom(""); setFilterDateTo(""); }} clearLabel={t("btnClearFilters")}>
        <div><label className="erp-label">{t("filterSearch")}</label><input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder={t("filterSearch")} className="filter-input" /></div>
        <div>
          <label className="erp-label">{t("filterByStatus")}</label>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="erp-select">
            <option value="">{t("filterAll")}</option>
            <option value="draft">{t("statusDraft")}</option>
            <option value="confirmed">{t("statusConfirmed")}</option>
            <option value="delivered">{t("statusDelivered")}</option>
            <option value="cancelled">{t("statusCancelled")}</option>
          </select>
        </div>
        <div><label className="erp-label">{t("fieldDateFrom")}</label><input type="date" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)} className="erp-input max-w-xs" /></div>
        <div><label className="erp-label">{t("fieldDateTo")}</label><input type="date" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)} className="erp-input max-w-xs" /></div>
      </FilterBar>

      <div className="erp-card">
        <div className="erp-card-header">
          <h3 className="font-semibold">📋 {locale === "gr" ? "Μητρώο Παραγγελιών" : "Order Registry"}</h3>
          <p className="text-xs text-slate-400 mt-1">{t("clickToRestore")}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="erp-table">
            <thead>
              <tr>
                <th>{t("fieldOrderNumber")}</th>
                <th>{t("fieldOrderDate")}</th>
                <th>{t("fieldSupplier")}</th>
                <th>{t("fieldInvoiceNumber")}</th>
                <th>{t("fieldGrossAmount")}</th>
                <th>{t("fieldNotes")}</th>
                <th>{t("fieldStatus")}</th>
                <th colSpan={2}>{t("actions")}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? <tr><td colSpan={9} className="text-center py-8 text-slate-400">{t("noData")}</td></tr> :
                filtered.map((o, idx) => (
                  <tr key={o?.id ?? `order-${idx}`} className="cursor-pointer hover:bg-blue-50/50" onClick={() => o && restoreOrder(o)}>
                    <td className="font-mono text-xs font-semibold">{o?.orderNumber ?? "—"}</td>
                    <td className="text-sm">{o?.orderDate ?? "—"}</td>
                    <td className="text-sm">{locale === "gr" ? o?.supplierName : (o?.supplierNameEn || o?.supplierName)}</td>
                    <td className="text-sm">{o?.invoiceNumber || <span className="text-slate-300">—</span>}</td>
                    <td className="font-semibold">{fmt(Number(o?.totalGross ?? 0))}</td>
                    <td className="text-sm text-slate-500 max-w-[150px] truncate">{o?.notes || "—"}</td>
                    <td>
                      <Badge color={o?.status === "delivered" ? "green" : o?.status === "draft" ? "amber" : o?.status === "confirmed" ? "blue" : "grey"}>
                        {(o?.status && t("status" + o.status.charAt(0).toUpperCase() + o.status.slice(1))) || o?.status}
                      </Badge>
                    </td>
                    <td>
                      <button onClick={(e) => { e.stopPropagation(); o && restoreOrder(o); }} className="erp-btn-warning text-xs px-2 py-1">
                        🔄 {t("restoreAndEdit")}
                      </button>
                    </td>
                    <td>
                      <button onClick={(e) => { e.stopPropagation(); o?.id && deleteOrder(o.id); }} disabled={deletingId === o?.id} className="erp-btn-danger text-xs px-2 py-1">
                        {deletingId === o?.id ? "…" : "🗑️"} {t("deleteSelectedOrder")}
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Restore & Correction Modal */}
      <Modal isOpen={showRestore} onClose={() => setShowRestore(false)} title={t("restoreOrder") + ": " + (selectedOrder?.orderNumber || "")} size="xl">
        <div className="space-y-4">
          {restoreMsg && <div className="p-3 bg-emerald-50 border border-emerald-300 text-emerald-800 rounded-lg text-sm">{restoreMsg}</div>}

          <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg">
            <span className="text-sm font-semibold text-blue-700">{t("enterInvoiceNumber")}:</span>
            <input type="text" value={restoreInvoiceNum} onChange={e => setRestoreInvoiceNum(e.target.value)} className="erp-input max-w-xs border-blue-300" placeholder="Τ12345" />
          </div>

          <div>
            <h4 className="font-semibold text-slate-700 mb-2">🔧 {t("correctQtyPrice")}</h4>
            <div className="overflow-x-auto">
              <table className="erp-table">
                <thead>
                  <tr>
                    <th>{t("fieldProduct")}</th>
                    <th>{t("fieldOrderedQty")}</th>
                    <th>{t("fieldDeliveredQty")}</th>
                    <th>{t("fieldUnit")}</th>
                    <th>{t("fieldBasePrice")}</th>
                    <th>{t("fieldNetAmount")}</th>
                    <th>{t("fieldGrossAmount")}</th>
                    <th>{locale === "gr" ? "Διαφορά" : "Diff"}</th>
                  </tr>
                </thead>
                <tbody>
                  {restoreItems.map((item, i) => (
                    <tr key={i}>
                      <td className="font-medium">{item.productName}</td>
                      <td>{item.orderedQuantity}</td>
                      <td>
                        <input type="number" value={item.deliveredQuantity || ""} onChange={e => updateRestoreItem(i, "deliveredQuantity", Number(e.target.value))}
                          className="erp-input w-24 text-sm py-1" step="0.01" />
                      </td>
                      <td>{item.unit}</td>
                      <td>
                        <input type="number" value={item.basePrice} onChange={e => updateRestoreItem(i, "basePrice", Number(e.target.value))}
                          className="erp-input w-20 text-sm py-1" step="0.01" />
                      </td>
                      <td className="font-medium">{fmt(item.netAmount)}</td>
                      <td className="font-semibold text-emerald-700">{fmt(item.grossAmount)}</td>
                      <td className={(item.deliveredQuantity < item.orderedQuantity) ? "text-red-600 font-semibold" : "text-emerald-600"}>
                        {((item.deliveredQuantity || 0) - item.orderedQuantity).toFixed(2)} {item.unit}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex gap-2 pt-2 border-t">
            <button onClick={handleSaveRestore} disabled={saving} className="erp-btn-primary">{saving ? "…" : "💾"} {t("btnSaveOrder")}</button>
            <button onClick={() => setShowRestore(false)} disabled={saving} className="erp-btn-ghost">{t("btnCancel")}</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
