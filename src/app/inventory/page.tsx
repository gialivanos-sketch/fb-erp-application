"use client";
import { useState, useMemo } from "react";
import { useLanguage } from "@/lib/context";
import { PageHeader, FilterBar, KpiCard } from "@/components/shared";
import type { StockTakingItem } from "@/lib/types";
import * as db from "@/lib/supabaseData";

export default function InventoryPage() {
  const { t, locale, data, refreshAll } = useLanguage();
  const [filterProduct, setFilterProduct] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [takingDate, setTakingDate] = useState(new Date().toISOString().split("T")[0]);
  const [savedMessage, setSavedMessage] = useState("");
  const [saving, setSaving] = useState(false);
  // Manual counts the user types in are the only genuinely "owned" client
  // state on this page; the base rows themselves are derived below from
  // whatever's in Supabase, so they can't drift out of sync with it.
  const [manualCounts, setManualCounts] = useState<Record<number, string>>({});

  // Base counting sheet: derived from the most recent stock-taking if one
  // exists, otherwise from the supplier product catalog. This recomputes
  // automatically whenever the underlying data changes (e.g. after a bulk
  // CSV import or a realtime update from another device).
  const baseItems: StockTakingItem[] = useMemo(() => {
    const sorted = [...data.stockTakings].sort((a, b) => b.id - a.id);
    if (sorted.length > 0 && sorted[0].items && sorted[0].items.length > 0) {
      return sorted[0].items.map((i, idx) => ({
        id: i.id ?? idx + 1,
        productName: i.productName || "",
        initialStock: i.initialStock || "0",
        supplier: i.supplier || "",
        lastPurchaseDate: i.lastPurchaseDate || "",
        price: i.price || "0",
        unit: i.unit || "kg",
        manualCount: i.manualCount || "",
        inventoryValue: i.inventoryValue || "0",
        variance: i.variance || "0",
      }));
    }
    if (data.supplierProducts.length > 0) {
      const bySupplier = new Map(data.suppliers.map((s) => [s.id, s]));
      return data.supplierProducts.slice(0, 30).map((p, idx) => ({
        id: idx + 1,
        productName: p.productName,
        initialStock: "0.00",
        supplier: bySupplier.get(p.supplierId)?.name ?? "",
        lastPurchaseDate: takingDate,
        price: p.basePrice,
        unit: p.unit,
        manualCount: "",
        inventoryValue: "0",
        variance: "0",
      }));
    }
    return [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.stockTakings, data.supplierProducts, data.suppliers]);

  // Merge the derived base rows with whatever the user has typed into
  // "manual count" for each, recomputing inventory value / variance live.
  const items: StockTakingItem[] = useMemo(() => baseItems.map((item) => {
    const override = item.id != null ? manualCounts[item.id] : undefined;
    const manualCount = override ?? item.manualCount ?? "";
    const count = Number(manualCount) || 0;
    const init = Number(item.initialStock) || 0;
    const price = Number(item.price) || 0;
    return {
      ...item,
      manualCount,
      inventoryValue: (count * price).toFixed(2),
      variance: (count - init).toFixed(2),
    };
  }), [baseItems, manualCounts]);

  function updateItem(item: StockTakingItem, value: string) {
    if (item.id == null) return;
    setManualCounts(prev => ({ ...prev, [item.id as number]: value }));
  }

  const filtered = useMemo(() => items.filter(i => {
    if (filterProduct && !i?.productName?.toLowerCase().includes(filterProduct.toLowerCase())) return false;
    return true;
  }), [items, filterProduct]);

  const totalRecordedValue = filtered.reduce((s, i) => s + Number(i.inventoryValue || 0), 0);
  const totalPurchaseValue = filtered.reduce((s, i) => s + (Number(i.initialStock) * Number(i.price)), 0);
  const totalQtyBought = filtered.reduce((s, i) => s + Number(i.manualCount || i.initialStock), 0);
  const distinctSku = filtered.length;
  const fmt = (n: number) => `€${n.toLocaleString("el-GR", { minimumFractionDigits: 2 })}`;

  async function saveInventory() {
    setSaving(true);
    try {
      await db.createStockTaking(
        {
          takingDate,
          notes: "Απογραφή " + takingDate,
          totalRecordedValue: totalRecordedValue.toFixed(2),
          totalPurchaseValue: totalPurchaseValue.toFixed(2),
          totalQuantityBought: String(totalQtyBought),
          distinctSkuCount: distinctSku,
        },
        filtered.map(i => ({
          productName: i.productName,
          initialStock: i.initialStock,
          supplier: i.supplier,
          lastPurchaseDate: i.lastPurchaseDate || takingDate,
          price: i.price,
          unit: i.unit,
          manualCount: i.manualCount || "0",
          inventoryValue: i.inventoryValue,
          variance: i.variance,
        }))
      );
      await refreshAll();
      setSavedMessage(locale === "gr" ? "✅ Η απογραφή αποθηκεύτηκε επιτυχώς!" : "✅ Inventory saved successfully!");
      setTimeout(() => setSavedMessage(""), 3000);
    } catch (err) {
      setSavedMessage(locale === "gr" ? "⚠️ Αποτυχία αποθήκευσης: " + String(err) : "⚠️ Failed to save: " + String(err));
    } finally {
      setSaving(false);
    }
  }

  function clearSheet() {
    setManualCounts({});
  }

  function handlePrintStocklistByPurchased() {
    const win = window.open("", "_blank");
    if (!win) return;
    const rows = filtered
      .filter(item => Number(item.initialStock) > 0)
      .map(item => "<tr><td>" + item.productName + "</td><td>" + Number(item.initialStock).toFixed(2) + " " + item.unit + "</td><td>" + item.supplier + "</td><td>" + item.lastPurchaseDate + "</td><td>€" + Number(item.price).toFixed(2) + "</td></tr>")
      .join("");
    win.document.write(
      "<html><head><title>" + (locale === "gr" ? "Λίστα Απογραφής - Αγορασμένα Είδη" : "Inventory Stocklist - Purchased Items") + "</title>" +
      "<style>body{font-family:Arial,sans-serif;padding:20px}table{width:100%;border-collapse:collapse;margin-top:10px}th,td{border:1px solid #ddd;padding:8px;text-align:left;font-size:12px}th{background:#f3f4f6;font-weight:bold}h2{color:#1e40af}</style></head>" +
      "<body><h2>📊 " + (locale === "gr" ? "Λίστα Απογραφής βάσει Αγορασμένων Ειδών" : "Inventory Stocklist Based on Purchased Items") + "</h2>" +
      "<p>" + (locale === "gr" ? "Ημερομηνία" : "Date") + ": " + takingDate + " | " + (locale === "gr" ? "Είδη" : "Items") + ": " + filtered.filter(i => Number(i.initialStock) > 0).length + "</p>" +
      "<table><thead><tr><th>" + t("fieldProduct") + "</th><th>" + t("fieldInitialStock") + "</th><th>" + t("fieldSupplier") + "</th><th>" + t("fieldLastPurchaseDate") + "</th><th>" + t("fieldPrice") + "</th></tr></thead><tbody>" + rows + "</tbody></table></body></html>"
    );
    win.document.close();
    win.print();
  }

  return (
    <div>
      <PageHeader title={t("headerInventory")} subtitle={locale === "gr" ? "Απογραφή Αποθέματος" : "Inventory Stock Taking"}>
        <button onClick={handlePrintStocklistByPurchased} className="erp-btn-warning">
          🖨️ {t("printInventoryByPurchased")}
        </button>
      </PageHeader>

      {savedMessage && (
        <div className="mb-4 p-3 bg-emerald-50 border border-emerald-300 text-emerald-800 rounded-lg text-sm font-medium">{savedMessage}</div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard label={t("kpiRecordedStockValue")} value={fmt(totalRecordedValue)} color="blue" icon="📦" />
        <KpiCard label={t("kpiCumulativePurchases")} value={fmt(totalPurchaseValue)} color="green" icon="🛒" />
        <KpiCard label={t("kpiTotalQuantityBought")} value={totalQtyBought.toFixed(1)} color="amber" icon="📐" />
        <KpiCard label={t("kpiDistinctSku")} value={distinctSku} color="purple" icon="📋" />
      </div>

      <FilterBar onClear={() => { setFilterProduct(""); setFilterDateFrom(""); setFilterDateTo(""); }} clearLabel={t("btnClearFilters")}>
        <div>
          <label className="erp-label font-semibold text-blue-700">{t("inventoryInputDate")}</label>
          <input type="date" value={takingDate} onChange={e => setTakingDate(e.target.value)} className="erp-input max-w-xs border-blue-300" />
        </div>
        <div>
          <label className="erp-label">{t("filterSearch")}</label>
          <input type="text" value={filterProduct} onChange={e => setFilterProduct(e.target.value)} placeholder={t("filterSearch")} className="filter-input" />
        </div>
        <div>
          <label className="erp-label">{t("fieldDateFrom")}</label>
          <input type="date" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)} className="erp-input max-w-xs" />
        </div>
        <div>
          <label className="erp-label">{t("fieldDateTo")}</label>
          <input type="date" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)} className="erp-input max-w-xs" />
        </div>
      </FilterBar>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <button onClick={saveInventory} disabled={saving} className="erp-btn-primary">{saving ? "…" : "💾"} {t("insertSave")}</button>
        <button onClick={clearSheet} className="erp-btn-danger">🧹 {t("btnClearSheet")}</button>
        <button onClick={() => window.print()} className="erp-btn-secondary">🖨️ {t("btnPrint")}</button>
      </div>

      <div className="erp-card">
        <div className="erp-card-header">
          <h3 className="font-semibold">📐 {locale === "gr" ? "Φύλλο Απογραφής" : "Stock Counting Sheet"}</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="erp-table">
            <thead>
              <tr>
                <th>#</th>
                <th>{t("fieldProduct")}</th>
                <th>{t("fieldInitialStock")}</th>
                <th>{t("fieldSupplier")}</th>
                <th>{t("fieldLastPurchaseDate")}</th>
                <th>{t("fieldPrice")}</th>
                <th>{t("fieldUnit")}</th>
                <th>{t("fieldManualCount")}</th>
                <th>{t("fieldInventoryValue")}</th>
                <th>{t("fieldVariance")}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={10} className="text-center py-8 text-slate-400">{t("noData")}</td></tr>
              ) : filtered.map((item, i) => (
                <tr key={item.id ?? `inv-${i}`} className={Number(item.variance) < 0 ? "bg-red-50/30" : Number(item.variance) > 0 ? "bg-emerald-50/30" : ""}>
                  <td className="text-xs text-slate-400">{i + 1}</td>
                  <td className="font-medium">{item?.productName ?? "—"}</td>
                  <td className="text-sm">{Number(item?.initialStock ?? 0).toFixed(2)} {item?.unit}</td>
                  <td className="text-sm text-slate-500">{item?.supplier ?? "—"}</td>
                  <td className="text-sm">{item?.lastPurchaseDate ?? "—"}</td>
                  <td>€{Number(item?.price ?? 0).toFixed(2)}</td>
                  <td className="text-sm">{item?.unit ?? "—"}</td>
                  <td>
                    <input type="number" value={item.manualCount} onChange={e => updateItem(item, e.target.value)} className="erp-input w-24 text-sm py-1 border-blue-200 focus:border-blue-500" step="0.01" placeholder="0" />
                  </td>
                  <td className="font-semibold">{fmt(Number(item.inventoryValue))}</td>
                  <td className={Number(item.variance) < 0 ? "text-red-600 font-semibold" : Number(item.variance) > 0 ? "text-emerald-600 font-semibold" : "text-slate-400"}>
                    {Number(item.variance) > 0 ? "+" : ""}{Number(item.variance).toFixed(2)} {item?.unit}
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
