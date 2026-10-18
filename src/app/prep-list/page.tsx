"use client";
import { useState, useMemo } from "react";
import { useApp } from "@/lib/context";
import { createInternalTransfer, deleteInternalTransfer } from "@/lib/supabaseData";
import type { InternalTransfer, InternalTransferItem } from "@/lib/types";

const today = () => new Date().toISOString().split("T")[0];

function nextTransferNumber(existing: { transferNumber: string }[]): string {
  const nums = existing
    .map((t) => {
      const m = t.transferNumber.match(/ΔΕΔ-(\d+)/);
      return m ? parseInt(m[1], 10) : 0;
    })
    .filter(Boolean);
  const next = nums.length > 0 ? Math.max(...nums) + 1 : 1;
  return `ΔΕΔ-${String(next).padStart(3, "0")}`;
}

type DraftItem = { ingredientId: number | null; ingredientName: string; quantity: string; unit: string };

export default function InternalTransfersPage() {
  const { data, refreshAll } = useApp();
  const transfers = data.internalTransfers ?? [];
  const supplierProducts = data.supplierProducts ?? [];
  const departments = data.departments ?? [];

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [transferDate, setTransferDate] = useState(today());
  const [toDepartment, setToDepartment] = useState("");
  const [deliveredBy, setDeliveredBy] = useState("");
  const [receivedBy, setReceivedBy] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<DraftItem[]>([
    { ingredientId: null, ingredientName: "", quantity: "", unit: "" },
  ]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filter state
  const [filterDept, setFilterDept] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");

  // Delete confirm
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const filteredTransfers = useMemo((): InternalTransfer[] => {
    return transfers.filter((t: InternalTransfer) => {
      if (filterDept && t.toDepartment !== filterDept) return false;
      if (filterDateFrom && t.transferDate < filterDateFrom) return false;
      if (filterDateTo && t.transferDate > filterDateTo) return false;
      return true;
    });
  }, [transfers, filterDept, filterDateFrom, filterDateTo]);

  function addItem() {
    setItems((prev) => [...prev, { ingredientId: null, ingredientName: "", quantity: "", unit: "" }]);
  }

  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateItem(idx: number, field: keyof DraftItem, value: string | number | null) {
    setItems((prev) =>
      prev.map((item: DraftItem, i: number) => {
        if (i !== idx) return item;
        if (field === "ingredientId") {
          const sp = supplierProducts.find((g: { id: number; productName: string; unit: string }) => g.id === value);
          return {
            ...item,
            ingredientId: value as number | null,
            ingredientName: sp?.productName ?? "",
            unit: sp?.unit ?? item.unit,
          };
        }
        return { ...item, [field]: value };
      })
    );
  }

  async function handleSave() {
    if (!toDepartment) { setError("Επιλέξτε τμήμα προορισμού"); return; }
    const validItems = items.filter((i) => i.ingredientName && parseFloat(i.quantity) > 0);
    if (validItems.length === 0) { setError("Προσθέστε τουλάχιστον ένα υλικό"); return; }

    setSaving(true);
    setError(null);
    try {
      const transferItems: Omit<InternalTransferItem, "id" | "transferId">[] = validItems.map((i) => ({
        ingredientId: i.ingredientId,
        ingredientName: i.ingredientName,
        quantity: parseFloat(i.quantity),
        unit: i.unit,
      }));
      await createInternalTransfer({
        transferNumber: nextTransferNumber(transfers),
        transferDate,
        fromDepartment: "ΑΠΟΘΗΚΗ",
        toDepartment,
        deliveredBy: deliveredBy || null,
        receivedBy: receivedBy || null,
        notes: notes || null,
        items: transferItems,
      });
      await refreshAll();
      resetForm();
      setShowForm(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Σφάλμα αποθήκευσης");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    try {
      await deleteInternalTransfer(id);
      await refreshAll();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Σφάλμα διαγραφής");
    } finally {
      setDeleteId(null);
    }
  }

  function resetForm() {
    setTransferDate(today());
    setToDepartment("");
    setDeliveredBy("");
    setReceivedBy("");
    setNotes("");
    setItems([{ ingredientId: null, ingredientName: "", quantity: "", unit: "" }]);
    setError(null);
  }

  return (
    <div className="p-4 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Εσωτερική Διακίνηση</h1>
          <p className="text-sm text-gray-500 mt-1">Δελτία μεταφοράς υλικών από Αποθήκη → Τμήμα</p>
        </div>
        <button
          onClick={() => { resetForm(); setShowForm(true); }}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition-colors"
        >
          <span className="text-lg">+</span> Νέο Δελτίο
        </button>
      </div>

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                  Νέο Δελτίο Εσωτερικής Διακίνησης
                </h2>
                <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
              </div>

              {/* Meta fields */}
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">ΗΜΕΡΟΜΗΝΙΑ</label>
                  <input
                    type="date"
                    value={transferDate}
                    onChange={(e) => setTransferDate(e.target.value)}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">ΤΜΗΜΑ ΠΡΟΟΡΙΣΜΟΥ *</label>
                  <select
                    value={toDepartment}
                    onChange={(e) => setToDepartment(e.target.value)}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-white"
                  >
                    <option value="">— Επιλογή —</option>
                    {departments.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">ΠΑΡΕΔΩΣΕ (Αποθηκάριος)</label>
                  <input
                    type="text"
                    value={deliveredBy}
                    onChange={(e) => setDeliveredBy(e.target.value)}
                    placeholder="Όνομα αποθηκάριου"
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">ΠΑΡΕΛΑΒΕ (Τμηματάρχης)</label>
                  <input
                    type="text"
                    value={receivedBy}
                    onChange={(e) => setReceivedBy(e.target.value)}
                    placeholder="Όνομα τμηματάρχη"
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-white"
                  />
                </div>
              </div>

              {/* Items */}
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">ΥΛΙΚΑ</label>
                  <button onClick={addItem} className="text-blue-600 hover:text-blue-800 text-sm font-medium">+ Προσθήκη υλικού</button>
                </div>
                <div className="space-y-2">
                  {items.map((item, idx) => (
                    <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                      <div className="col-span-5">
                        <select
                          value={item.ingredientId ?? ""}
                          onChange={(e) => updateItem(idx, "ingredientId", e.target.value ? parseInt(e.target.value) : null)}
                          className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-2 text-sm bg-white dark:bg-gray-700 dark:text-white"
                        >
                          <option value="">— Υλικό —</option>
                          {supplierProducts.filter(g => g.isActive !== false).map((g) => (
                            <option key={g.id} value={g.id}>{g.productName}</option>
                          ))}
                        </select>
                      </div>
                      <div className="col-span-3">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="Ποσότητα"
                          value={item.quantity}
                          onChange={(e) => updateItem(idx, "quantity", e.target.value)}
                          className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-2 text-sm bg-white dark:bg-gray-700 dark:text-white"
                        />
                      </div>
                      <div className="col-span-3">
                        <input
                          type="text"
                          placeholder="Μονάδα"
                          value={item.unit}
                          onChange={(e) => updateItem(idx, "unit", e.target.value)}
                          className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-2 text-sm bg-white dark:bg-gray-700 dark:text-white"
                        />
                      </div>
                      <div className="col-span-1 flex justify-center">
                        {items.length > 1 && (
                          <button onClick={() => removeItem(idx)} className="text-red-400 hover:text-red-600 text-xl leading-none">&times;</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Notes */}
              <div className="mb-4">
                <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">ΣΗΜΕΙΩΣΕΙΣ</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-white"
                />
              </div>

              {error && <p className="text-red-500 text-sm mb-3">{error}</p>}

              <div className="flex gap-3 justify-end">
                <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 border border-gray-300 rounded-lg">
                  Ακύρωση
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg"
                >
                  {saving ? "Αποθήκευση..." : "Αποθήκευση Δελτίου"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm modal */}
      {deleteId !== null && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl p-6 max-w-sm w-full">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-3">Διαγραφή Δελτίου</h3>
            <p className="text-gray-600 dark:text-gray-400 text-sm mb-5">Είστε σίγουροι; Η ενέργεια δεν αναιρείται.</p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setDeleteId(null)} className="px-4 py-2 text-sm border border-gray-300 rounded-lg">Ακύρωση</button>
              <button onClick={() => handleDelete(deleteId)} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm rounded-lg">Διαγραφή</button>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-4">
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">ΤΜΗΜΑ</label>
            <select
              value={filterDept}
              onChange={(e) => setFilterDept(e.target.value)}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-white"
            >
              <option value="">Όλα τα τμήματα</option>
              {departments.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">ΑΠΟ ΗΜΕΡΟΜΗΝΙΑ</label>
            <input type="date" value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-white" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">ΕΩΣ ΗΜΕΡΟΜΗΝΙΑ</label>
            <input type="date" value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-white" />
          </div>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-4 border border-blue-100 dark:border-blue-800">
          <p className="text-xs font-semibold text-blue-600 dark:text-blue-400 mb-1">ΣΥΝΟΛΟ ΔΕΛΤΙΩΝ</p>
          <p className="text-2xl font-bold text-blue-800 dark:text-blue-200">{filteredTransfers.length}</p>
        </div>
        <div className="bg-green-50 dark:bg-green-900/20 rounded-xl p-4 border border-green-100 dark:border-green-800">
          <p className="text-xs font-semibold text-green-600 dark:text-green-400 mb-1">ΣΥΝΟΛΟ ΓΡΑΜΜΩΝ</p>
          <p className="text-2xl font-bold text-green-800 dark:text-green-200">
            {filteredTransfers.reduce((s, t) => s + t.items.length, 0)}
          </p>
        </div>
        <div className="bg-purple-50 dark:bg-purple-900/20 rounded-xl p-4 border border-purple-100 dark:border-purple-800">
          <p className="text-xs font-semibold text-purple-600 dark:text-purple-400 mb-1">ΤΜΗΜΑΤΑ</p>
          <p className="text-2xl font-bold text-purple-800 dark:text-purple-200">
            {new Set(filteredTransfers.map((t) => t.toDepartment)).size}
          </p>
        </div>
      </div>

      {/* Transfers list */}
      {filteredTransfers.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <div className="text-5xl mb-3">📋</div>
          <p className="font-medium">Δεν υπάρχουν δελτία</p>
          <p className="text-sm mt-1">Δημιουργήστε το πρώτο δελτίο εσωτερικής διακίνησης</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredTransfers.map((t) => (
            <div key={t.id} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
              {/* Transfer header */}
              <div className="flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-700/50">
                <div className="flex items-center gap-3">
                  <span className="font-bold text-blue-600 dark:text-blue-400 text-sm">{t.transferNumber}</span>
                  <span className="text-gray-400">|</span>
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    {new Date(t.transferDate).toLocaleDateString("el-GR")}
                  </span>
                  <span className="text-gray-400">|</span>
                  <span className="bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-xs font-semibold px-2 py-0.5 rounded-full">
                    ΑΠΟΘΗΚΗ → {t.toDepartment}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  {t.deliveredBy && (
                    <span className="text-xs text-gray-500">Παρέδωσε: <strong>{t.deliveredBy}</strong></span>
                  )}
                  {t.receivedBy && (
                    <span className="text-xs text-gray-500">Παρέλαβε: <strong>{t.receivedBy}</strong></span>
                  )}
                  <button
                    onClick={() => setDeleteId(t.id)}
                    className="text-red-400 hover:text-red-600 text-xs px-2 py-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20"
                  >
                    ✕
                  </button>
                </div>
              </div>

              {/* Items table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-700">
                      <th className="text-left px-4 py-2 font-semibold">ΥΛΙΚΟ</th>
                      <th className="text-right px-4 py-2 font-semibold">ΠΟΣΟΤΗΤΑ</th>
                      <th className="text-left px-4 py-2 font-semibold">ΜΟΝΑΔΑ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {t.items.map((item, idx) => (
                      <tr key={idx} className="border-b border-gray-50 dark:border-gray-700/50 last:border-0">
                        <td className="px-4 py-2 text-gray-800 dark:text-gray-200">{item.ingredientName}</td>
                        <td className="px-4 py-2 text-right font-medium text-gray-900 dark:text-white">{item.quantity}</td>
                        <td className="px-4 py-2 text-gray-500">{item.unit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {t.notes && (
                <div className="px-4 py-2 text-xs text-gray-500 italic border-t border-gray-100 dark:border-gray-700">
                  {t.notes}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
