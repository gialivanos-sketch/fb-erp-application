"use client";
import { useState, useMemo, useRef, useEffect } from "react";
import { useApp } from "@/lib/context";
import { PageHeader, Badge, KpiCard } from "@/components/shared";
import * as db from "@/lib/supabaseData";
import type { SupplierProduct } from "@/lib/types";
import * as XLSX from "xlsx";
import { useBusinessName } from "@/lib/useBusinessName";

interface OrderItemDraft {
  id?: number;
  supplierId?: number;
  supplierProductId?: number;
  productName: string;
  orderedQuantity: number;
  deliveredQuantity?: number;
  unit: string;
  basePrice: number;
  vatPercent: number;
  discountPercent: number;
  netAmount: number;
  vatAmount: number;
  grossAmount: number;
  qualityGrade?: string | null;
  regionOfOrigin?: string | null;
}

export default function DraftOrderPage() {
  const bizName = useBusinessName();
  const { t, locale, data, refreshAll } = useApp();
  const suppliers = data.suppliers;
  const orders = data.orders;

  const [selectedSupplier, setSelectedSupplier] = useState<number>(0);
  const [orderDate, setOrderDate] = useState(new Date().toISOString().split("T")[0]);
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [deliveryNote, setDeliveryNote] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<OrderItemDraft[]>([]);
  const [saving, setSaving] = useState(false);
  // Επόμενος αριθμός = μέγιστος υπάρχων ORD-xxxxx + 1 (όχι πλήθος παραγγελιών,
  // γιατί οι εισηγμένες από Excel «XL-…» θα πήδαγαν/συγκρούονταν νούμερα).
  const orderNum = "ORD-" + String(
    orders.reduce((m, o) => {
      const n = /^ORD-(\d+)$/.exec(o?.orderNumber ?? "")?.[1];
      return n ? Math.max(m, Number(n)) : m;
    }, 0) + 1
  ).padStart(5, "0");
  // New item form
  const [newProductName, setNewProductName] = useState("");
  const [newQty, setNewQty] = useState(1);
  const [newUnit, setNewUnit] = useState("kg");
  const [newPrice, setNewPrice] = useState(0);
  const [newVat, setNewVat] = useState(24);
  const [newDiscount, setNewDiscount] = useState(0);
  const [newSupplierId, setNewSupplierId] = useState(0);
  const [newSupplierProductId, setNewSupplierProductId] = useState<number | undefined>(undefined);
  const [newQualityGrade, setNewQualityGrade] = useState<string | null>(null);
  const [newRegion, setNewRegion] = useState<string | null>(null);
  // View by supplier
  const [viewBySupplier, setViewBySupplier] = useState(false);
  // Saved message
  const [savedMsg, setSavedMsg] = useState("");

  // ---- "Μηχανή Αναζήτησης SKU": live cross-supplier lookup dropdown ----
  // Now a real Postgres full-text query (see searchSupplierProducts in
  // supabaseData.ts) instead of an in-memory filter, so it's debounced
  // (300ms after the person stops typing) rather than firing on every
  // keystroke — a network round trip per character would feel laggy and
  // needlessly load the database.
  // On first mount: check if supplier-quotes page handed us a cart via localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem("draftOrderCart");
      if (!raw) return;
      localStorage.removeItem("draftOrderCart");
      const cartItems: Array<{ id: number; supplierId: number; productName: string; quantity: number; unit: string; basePrice: number | string; vatPercent?: number; qualityGrade?: string | null; regionOfOrigin?: string | null }> = JSON.parse(raw);
      if (!Array.isArray(cartItems) || cartItems.length === 0) return;
      const loaded: OrderItemDraft[] = cartItems.map((c) => {
        const price = Number(c.basePrice) || 0;
        const qty = Number(c.quantity) || 1;
        const vat = Number(c.vatPercent) || 24;
        const { net, vatAmt, gross } = { net: price * qty, vatAmt: price * qty * (vat / 100), gross: price * qty * (1 + vat / 100) };
        return {
          supplierId: c.supplierId,
          supplierProductId: c.id,
          productName: c.productName,
          orderedQuantity: qty,
          unit: c.unit || "kg",
          basePrice: price,
          vatPercent: vat,
          discountPercent: 0,
          netAmount: net,
          vatAmount: vatAmt,
          grossAmount: gross,
          qualityGrade: c.qualityGrade ?? null,
          regionOfOrigin: c.regionOfOrigin ?? null,
        };
      });
      setItems(loaded);
      // Auto-select supplier if all items share the same one
      const supplierIds = [...new Set(loaded.map((i) => i.supplierId).filter(Boolean))];
      if (supplierIds.length === 1 && supplierIds[0]) setSelectedSupplier(supplierIds[0]!);
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [lookupDismissed, setLookupDismissed] = useState(false);
  const [lookupResults, setLookupResults] = useState<SupplierProduct[]>([]);
  const [lookupLoading, setLookupLoading] = useState(false);
  const searchBoxRef = useRef<HTMLDivElement>(null);
  const trimmedQuery = newProductName.trim();

  useEffect(() => {
    if (!trimmedQuery) {
      // No network sync needed for an empty query — nothing to debounce
      // or fetch. Loading/dismissed state resets on the next render via
      // the derived `showLookup` below; nothing to set here.
      return;
    }
    // Must run synchronously here (not inside the debounced callback below)
    // so the "searching…" indicator appears immediately on each keystroke,
    // before the 300ms debounce even starts — standard debounced-search
    // UX, not state that could instead be derived at render time.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLookupLoading(true);
    const timeoutId = setTimeout(async () => {
      try {
        const results = await db.searchSupplierProducts(trimmedQuery);
        setLookupResults(results);
      } catch {
        setLookupResults([]);
      } finally {
        setLookupLoading(false);
      }
    }, 300);
    return () => clearTimeout(timeoutId);
  }, [trimmedQuery]);

  // Derived, not stored: when there's no query, there's nothing to show,
  // regardless of what the last real search happened to return.
  const effectiveResults = trimmedQuery ? lookupResults : [];

  const showLookup = trimmedQuery.length > 0 && (effectiveResults.length > 0 || lookupLoading) && !lookupDismissed;

  // Close the lookup dropdown when clicking outside it.
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) {
        setLookupDismissed(true);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function selectLookupProduct(p: SupplierProduct) {
    setNewProductName(locale === "gr" ? p.productName : (p.productNameEn || p.productName));
    setNewUnit(p.unit);
    setNewPrice(Number(p.basePrice));
    setNewSupplierId(p.supplierId);
    setNewSupplierProductId(p.id);
    setNewQualityGrade(p.qualityGrade ?? null);
    setNewRegion(p.regionOfOrigin ?? null);
    setLookupDismissed(true);
  }

  function calcItem(p: number, q: number, vat: number, disc: number): { net: number; vatAmt: number; gross: number } {
    const net = p * q * (1 - disc / 100);
    const vatAmt = net * (vat / 100);
    return { net, vatAmt, gross: net + vatAmt };
  }

  function addItem() {
    if (!newProductName || newQty <= 0) return;
    const { net, vatAmt, gross } = calcItem(newPrice, newQty, newVat, newDiscount);
    setItems((prev) => [...prev, {
      supplierId: newSupplierId || selectedSupplier,
      supplierProductId: newSupplierProductId,
      productName: newProductName,
      orderedQuantity: newQty,
      unit: newUnit,
      basePrice: newPrice,
      vatPercent: newVat,
      discountPercent: newDiscount,
      netAmount: net,
      vatAmount: vatAmt,
      grossAmount: gross,
      qualityGrade: newQualityGrade,
      regionOfOrigin: newRegion,
    }]);
    setNewProductName(""); setNewQty(1); setNewPrice(0); setNewDiscount(0);
    setNewQualityGrade(null); setNewRegion(null); setNewSupplierId(0); setNewSupplierProductId(undefined);
  }

  function removeItem(i: number) { setItems((prev) => prev.filter((_, idx) => idx !== i)); }

  function updateItemField(i: number, field: string, value: number | string) {
    setItems((prev) => prev.map((item, idx) => {
      if (idx !== i) return item;
      const updated = { ...item, [field]: value };
      const { net, vatAmt, gross } = calcItem(Number(updated.basePrice), Number(updated.orderedQuantity), Number(updated.vatPercent), Number(updated.discountPercent));
      return { ...updated, netAmount: net, vatAmount: vatAmt, grossAmount: gross };
    }));
  }

  const totalNet = items.reduce((s, i) => s + i.netAmount, 0);
  const totalVat = items.reduce((s, i) => s + i.vatAmount, 0);
  const totalGross = items.reduce((s, i) => s + i.grossAmount, 0);
  const fmt = (n: number) => "€" + n.toFixed(2);

  // Group items by supplier for "View by Supplier"
  const groupedBySupplier = useMemo(() => {
    const map = new Map<number, { supplierName: string; items: OrderItemDraft[]; subtotal: number }>();
    for (const item of items) {
      const sid = item.supplierId || selectedSupplier || 0;
      if (!map.has(sid)) {
        const s = suppliers.find((x) => x.id === sid);
        map.set(sid, { supplierName: s ? (locale === "gr" ? s.name : (s.nameEn || s.name)) : "—", items: [], subtotal: 0 });
      }
      const entry = map.get(sid)!;
      entry.items.push(item);
      entry.subtotal += item.grossAmount;
    }
    return Array.from(map.entries()).map(([sid, group]) => ({ supplierId: sid, ...group }));
  }, [items, suppliers, selectedSupplier, locale]);

  async function saveOrder() {
    if (!selectedSupplier || items.length === 0) return;
    setSaving(true);
    try {
      await db.createOrderWithItems(
        {
          orderNumber: orderNum, supplierId: selectedSupplier, orderDate,
          invoiceNumber: invoiceNumber || null, deliveryNoteNumber: deliveryNote || null, notes: notes || null,
          totalNet: totalNet.toFixed(2), totalVat: totalVat.toFixed(2), totalGross: totalGross.toFixed(2),
        },
        items.map((i) => ({
          productName: i.productName, orderedQuantity: i.orderedQuantity, unit: i.unit, basePrice: i.basePrice,
          vatPercent: i.vatPercent, discountPercent: i.discountPercent, netAmount: i.netAmount,
          vatAmount: i.vatAmount, grossAmount: i.grossAmount, supplierProductId: i.supplierProductId ?? null,
        }))
      );
      await refreshAll();
      setItems([]);
      setInvoiceNumber(""); setDeliveryNote(""); setNotes("");
      setSavedMsg(locale === "gr" ? "✅ Παραγγελία αποθηκεύτηκε!" : "✅ Order saved!");
      setTimeout(() => setSavedMsg(""), 2500);
    } catch (err) {
      setSavedMsg(locale === "gr" ? "⚠️ Αποτυχία αποθήκευσης: " + String(err) : "⚠️ Failed to save: " + String(err));
    } finally {
      setSaving(false);
    }
  }

  function handleExportPDF() {
    const today = new Date(orderDate).toLocaleDateString("el-GR", { day: "2-digit", month: "2-digit", year: "numeric" });

    // Group items by supplier
    const groups = new Map<number, { sup: typeof suppliers[0] | undefined; items: typeof items }>();
    for (const item of items) {
      const sid = item.supplierId || selectedSupplier || 0;
      if (!groups.has(sid)) groups.set(sid, { sup: suppliers.find(x => x.id === sid), items: [] });
      groups.get(sid)!.items.push(item);
    }

    let pagesHtml = "";
    let first = true;
    for (const [sid, g] of groups.entries()) {
      const sup = g.sup ?? suppliers.find(x => x.id === sid);
      const supName = sup ? (locale === "gr" ? sup.name : (sup.nameEn || sup.name)) : "—";
      const supEmail = sup?.contactEmail ?? "—";
      const groupNet = g.items.reduce((s, i) => s + i.netAmount, 0);
      const groupVat = g.items.reduce((s, i) => s + i.vatAmount, 0);
      const groupGross = g.items.reduce((s, i) => s + i.grossAmount, 0);

      const rows = g.items.map((item, idx) => {
        const qty = item.orderedQuantity % 1 === 0 ? item.orderedQuantity.toFixed(0) : item.orderedQuantity.toFixed(3);
        const bg = idx % 2 === 0 ? "#f8fafc" : "#ffffff";
        return `<tr style="background:${bg}">
          <td style="padding:5px 6px;border-bottom:1px solid #e5e7eb">${item.productName}</td>
          <td style="padding:5px 6px;border-bottom:1px solid #e5e7eb;text-align:center">${qty}</td>
          <td style="padding:5px 6px;border-bottom:1px solid #e5e7eb;text-align:right">${item.basePrice.toFixed(2)} €</td>
          <td style="padding:5px 6px;border-bottom:1px solid #e5e7eb;text-align:center">${item.unit}</td>
          <td style="padding:5px 6px;border-bottom:1px solid #e5e7eb;text-align:right">${item.grossAmount.toFixed(2)} €</td>
        </tr>`;
      }).join("");

      if (!first) pagesHtml += `<div style="page-break-before:always"></div>`;
      first = false;

      pagesHtml += `
      <div style="margin-bottom:40px">
        <div style="background:#1e40af;color:#fff;padding:10px 14px;font-size:15px;font-weight:700;letter-spacing:0.5px;margin-bottom:0">
          ${bizName} &nbsp;–&nbsp; ORDER FORM
        </div>
        <table style="width:100%;border-collapse:collapse;margin-bottom:14px">
          <tr>
            <td style="width:22%;background:#1e40af;color:#fff;font-weight:700;font-size:10px;padding:5px 8px">Προμηθευτής</td>
            <td style="width:28%;background:#f8fafc;border:1px solid #e2e8f0;font-size:10px;padding:5px 8px">${supName}</td>
            <td style="width:22%;background:#1e40af;color:#fff;font-weight:700;font-size:10px;padding:5px 8px">Ημερομηνία</td>
            <td style="width:28%;background:#f8fafc;border:1px solid #e2e8f0;font-size:10px;padding:5px 8px">${today}</td>
          </tr>
          <tr>
            <td style="background:#1e40af;color:#fff;font-weight:700;font-size:10px;padding:5px 8px">Email Επικοινωνίας</td>
            <td style="background:#f8fafc;border:1px solid #e2e8f0;font-size:10px;padding:5px 8px">${supEmail}</td>
            <td style="background:#1e40af;color:#fff;font-weight:700;font-size:10px;padding:5px 8px">Αριθμός Παραγγελίας</td>
            <td style="background:#f8fafc;border:1px solid #e2e8f0;font-size:10px;padding:5px 8px">${orderNum}</td>
          </tr>
          <tr>
            <td style="background:#1e40af;color:#fff;font-weight:700;font-size:10px;padding:5px 8px">Αριθμός Τιμολογίου</td>
            <td style="background:#f8fafc;border:1px solid #e2e8f0;font-size:10px;padding:5px 8px">${invoiceNumber || ""}</td>
            <td style="background:#1e40af;color:#fff;font-weight:700;font-size:10px;padding:5px 8px">Συνολική Αξία</td>
            <td style="background:#f8fafc;border:1px solid #e2e8f0;font-size:10px;padding:5px 8px;font-weight:700">${groupGross.toFixed(2)} EUR</td>
          </tr>
          <tr>
            <td style="background:#1e40af;color:#fff;font-weight:700;font-size:10px;padding:5px 8px">Σημειώσεις</td>
            <td colspan="3" style="background:#f8fafc;border:1px solid #e2e8f0;font-size:10px;padding:5px 8px">${notes || ""}</td>
          </tr>
        </table>
        <table style="width:100%;border-collapse:collapse">
          <thead>
            <tr style="background:#1e40af;color:#fff">
              <th style="padding:6px 8px;text-align:left;font-size:10px;font-weight:700">Προϊόν</th>
              <th style="padding:6px 8px;text-align:center;font-size:10px;font-weight:700">Ποσότητα</th>
              <th style="padding:6px 8px;text-align:right;font-size:10px;font-weight:700">Τιμή Μονάδας</th>
              <th style="padding:6px 8px;text-align:center;font-size:10px;font-weight:700">Μονάδα</th>
              <th style="padding:6px 8px;text-align:right;font-size:10px;font-weight:700">Σύνολο</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <table style="width:100%;border-collapse:collapse;margin-top:2px">
          <tr>
            <td colspan="3"></td>
            <td style="background:#f8fafc;border-bottom:1px solid #cbd5e1;padding:5px 8px;text-align:right;font-size:10px;color:#666">Καθαρή Αξία:</td>
            <td style="background:#f8fafc;border-bottom:1px solid #cbd5e1;padding:5px 8px;text-align:right;font-size:10px;color:#666;width:100px">${groupNet.toFixed(2)} EUR</td>
          </tr>
          <tr>
            <td colspan="3"></td>
            <td style="background:#f8fafc;border-bottom:1px solid #cbd5e1;padding:5px 8px;text-align:right;font-size:10px;color:#666">ΦΠΑ:</td>
            <td style="background:#f8fafc;border-bottom:1px solid #cbd5e1;padding:5px 8px;text-align:right;font-size:10px;color:#666">${groupVat.toFixed(2)} EUR</td>
          </tr>
          <tr>
            <td colspan="3"></td>
            <td style="background:#1e3a8a;color:#fff;padding:6px 8px;text-align:right;font-size:11px;font-weight:700">ΣΥΝΟΛΟ:</td>
            <td style="background:#1e3a8a;color:#fff;padding:6px 8px;text-align:right;font-size:11px;font-weight:700">${groupGross.toFixed(2)} EUR</td>
          </tr>
        </table>
        <div style="text-align:center;margin-top:30px;font-size:9px;color:#94a3b8">
          ${bizName} &nbsp;|&nbsp; Παραγγελία ${orderNum} &nbsp;|&nbsp; ${today}
        </div>
      </div>`;
    }

    const html = `<!DOCTYPE html><html lang="el"><head><meta charset="UTF-8">
      <title>Παραγγελία ${orderNum}</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 20px; color: #1e293b; }
        @media print {
          body { margin: 10mm; }
          @page { size: A4; margin: 10mm; }
        }
      </style>
    </head><body>${pagesHtml}</body></html>`;

    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, "_blank");
    if (win) {
      win.onload = () => URL.revokeObjectURL(url);
    }
  }

  function handleExportExcel() {
    const today = new Date(orderDate).toLocaleDateString("el-GR", { day: "2-digit", month: "2-digit", year: "numeric" });

    // Group items by supplier
    const groups = new Map<number, { sup: typeof suppliers[0] | undefined; items: typeof items }>();
    for (const item of items) {
      const sid = item.supplierId || selectedSupplier || 0;
      if (!groups.has(sid)) groups.set(sid, { sup: suppliers.find(x => x.id === sid), items: [] });
      groups.get(sid)!.items.push(item);
    }

    const wb = XLSX.utils.book_new();

    for (const [sid, g] of groups.entries()) {
      const sup = g.sup ?? suppliers.find(x => x.id === sid);
      const supName = sup ? (locale === "gr" ? sup.name : (sup.nameEn || sup.name)) : `SUP-${sid}`;
      const supEmail = sup?.contactEmail ?? "";
      const groupNet = g.items.reduce((s, i) => s + i.netAmount, 0);
      const groupVat = g.items.reduce((s, i) => s + i.vatAmount, 0);
      const groupGross = g.items.reduce((s, i) => s + i.grossAmount, 0);

      const rows: (string | number)[][] = [
        // Header block
        ["Προμηθευτής", supName, "", "Ημερομηνία", today],
        ["Στοιχεία Επικοινωνίας", supEmail, "", "ID Παραγγελίας", orderNum],
        ["Σημειώσεις", notes || "", "", "Αριθμός Τιμολογίου", invoiceNumber || ""],
        ["", "", "", "Συνολική Αξία", groupGross],
        [],
        // Column headers
        ["Προϊόν", "Ποσότητα", "Τιμή Μονάδας", "ΦΠΑ %", "Μονάδα", "Σύνολο"],
        // Items
        ...g.items.map(item => [
          item.productName,
          item.orderedQuantity,
          item.basePrice,
          `${item.vatPercent}%`,
          item.unit,
          item.grossAmount,
        ]),
        [],
        // Totals
        ["", "", "", "", "Καθαρή Αξία:", groupNet],
        ["", "", "", "", "ΦΠΑ:", groupVat],
        ["", "", "", "", "ΣΥΝΟΛΟ:", groupGross],
        [],
        [bizName, "", "", "", "", ""],
      ];

      const ws = XLSX.utils.aoa_to_sheet(rows);

      // Column widths
      ws["!cols"] = [
        { wch: 45 }, { wch: 12 }, { wch: 14 }, { wch: 10 }, { wch: 12 }, { wch: 14 },
      ];

      // Safe sheet name (max 31 chars, no special chars)
      const sheetName = supName.replace(/[\\/*?[\]:]/g, "").substring(0, 31);
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    }

    const filename = `Παραγγελία_${orderNum}_${new Date(orderDate).toISOString().split("T")[0]}.xlsx`;
    XLSX.writeFile(wb, filename);
  }

  return (
    <div>
      <PageHeader title={t("headerDraftOrder")} subtitle="Φύλλο Παραγγελίας | Invoice-Grade Draft Order Form" />

      {savedMsg && (
        <div className="mb-4 p-3 bg-emerald-50 border border-emerald-300 text-emerald-800 rounded-lg text-sm font-medium">{savedMsg}</div>
      )}

      {/* KPI Row */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
        <KpiCard label={locale === "gr" ? "Σύνολο Ειδών" : "Total Items"} value={items.length} color="blue" icon="📦" />
        <KpiCard label={t("fieldNetAmount")} value={fmt(totalNet)} color="green" icon="💰" />
        <KpiCard label={t("fieldVatAmount")} value={fmt(totalVat)} color="amber" icon="📊" />
        <KpiCard label={t("invoiceTotalValue")} value={fmt(totalGross)} color="purple" icon="🧾" />
      </div>

      {/* Order Form */}
      <div className="erp-card mb-6">
        <div className="erp-card-header">
          <h3 className="font-semibold">📝 {locale === "gr" ? "Νέα Παραγγελία" : "New Order"}</h3>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            <div>
              <label className="erp-label">{t("fieldOrderNumber")}</label>
              <input type="text" value={orderNum} readOnly className="erp-input bg-slate-50 font-mono" />
            </div>
            <div>
              <label className="erp-label">{t("fieldSupplier")}</label>
              <select value={selectedSupplier} onChange={(e) => setSelectedSupplier(Number(e.target.value))} className="erp-select">
                <option value={0}>—</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{locale === "gr" ? s.name : (s.nameEn || s.name)}</option>)}
              </select>
            </div>
            <div>
              <label className="erp-label">{t("fieldOrderDate")}</label>
              <input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} className="erp-input" />
            </div>
            <div>
              <label className="erp-label">{t("fieldInvoiceNumber")}</label>
              <input type="text" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} className="erp-input" placeholder="Τ12349" />
            </div>
            <div>
              <label className="erp-label">{t("fieldDeliveryNote")}</label>
              <input type="text" value={deliveryNote} onChange={(e) => setDeliveryNote(e.target.value)} className="erp-input" placeholder="ΠΑΡ-006" />
            </div>
            <div className="sm:col-span-3">
              <label className="erp-label">{t("fieldNotes")}</label>
              <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} className="erp-input" placeholder={locale === "gr" ? "Σημειώσεις..." : "Notes..."} />
            </div>
          </div>

          {/* Add Item Row — with live SKU Matching Search Matrix */}
          <div className="bg-slate-50 rounded-lg p-4 mb-4">
            <h4 className="text-sm font-semibold mb-3">
              {locale === "gr" ? "Προσθήκη Είδους" : "Add Line Item"}
              <span className="ml-2 text-xs font-normal text-slate-400">
                {locale === "gr" ? "— πληκτρολογήστε για σύγκριση τιμών προμηθευτών" : "— type to compare supplier prices"}
              </span>
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
              <div className="relative sm:col-span-2 lg:col-span-1" ref={searchBoxRef}>
                <input
                  type="text"
                  value={newProductName}
                  onChange={(e) => { setNewProductName(e.target.value); setLookupDismissed(false); }}
                  onFocus={() => setLookupDismissed(false)}
                  placeholder={locale === "gr" ? "π.χ. Ντομάτα" : "e.g. Tomato"}
                  className="erp-input"
                  autoComplete="off"
                />
                {showLookup && (
                  <div className="absolute z-30 mt-1 w-[min(90vw,640px)] max-h-96 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-2xl">
                    <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      {lookupLoading
                        ? (locale === "gr" ? "Αναζήτηση…" : "Searching…")
                        : locale === "gr"
                          ? `${effectiveResults.length} προσφορές — ταξινομημένες από χαμηλότερη τιμή`
                          : `${effectiveResults.length} matching offers — sorted by lowest price`}
                    </div>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-slate-400 text-left border-b border-slate-100">
                          <th className="px-3 py-1.5 font-medium">{t("fieldSupplier")}</th>
                          <th className="px-3 py-1.5 font-medium">{locale === "gr" ? "Τιμή" : "Price"}</th>
                          <th className="px-3 py-1.5 font-medium">{t("fieldQualityGrade")}</th>
                          <th className="px-3 py-1.5 font-medium">{t("fieldRegion")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {effectiveResults.map((p, idx) => (
                          <tr
                            key={p.id}
                            onClick={() => selectLookupProduct(p)}
                            className={`cursor-pointer hover:bg-blue-50 border-b border-slate-50 ${idx === 0 ? "bg-emerald-50/60" : ""}`}
                          >
                            <td className="px-3 py-2">
                              <div className="font-medium text-slate-700">{locale === "gr" ? p.supplierName : (p.supplierNameEn || p.supplierName)}</div>
                              <div className="text-slate-400">{locale === "gr" ? p.productName : (p.productNameEn || p.productName)}</div>
                            </td>
                            <td className="px-3 py-2">
                              <span className={`font-semibold ${idx === 0 ? "text-emerald-700" : "text-slate-700"}`}>
                                {fmt(Number(p.basePrice))}/{p.unit}
                              </span>
                              {idx === 0 && <div><Badge color="green">{t("lowestPrice")}</Badge></div>}
                            </td>
                            <td className="px-3 py-2">
                              <Badge color={p.qualityGrade === "Grade A" ? "green" : "amber"}>{p.qualityGrade || "—"}</Badge>
                            </td>
                            <td className="px-3 py-2 text-slate-500">{p.regionOfOrigin || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              <input type="number" value={newQty} onChange={(e) => setNewQty(Number(e.target.value))} placeholder="Qty" className="erp-input" min="0" step="0.01" />
              <select value={newUnit} onChange={(e) => setNewUnit(e.target.value)} className="erp-select">
                <option value="kg">kg</option><option value="g">g</option><option value="L">L</option><option value="ml">ml</option><option value="pcs">pcs</option>
              </select>
              <input type="number" value={newPrice || ""} onChange={(e) => setNewPrice(Number(e.target.value))} placeholder={t("fieldBasePrice")} className="erp-input" step="0.01" />
              <input type="number" value={newVat} onChange={(e) => setNewVat(Number(e.target.value))} placeholder="VAT %" className="erp-input" />
              <input type="number" value={newDiscount} onChange={(e) => setNewDiscount(Number(e.target.value))} placeholder="Disc %" className="erp-input" />
            </div>
            {(newQualityGrade || newRegion) && (
              <div className="flex gap-2 mt-2">
                {newQualityGrade && <Badge color={newQualityGrade === "Grade A" ? "green" : "amber"}>{newQualityGrade}</Badge>}
                {newRegion && <Badge color="grey">{newRegion}</Badge>}
              </div>
            )}
            <div className="flex gap-2 mt-3">
              <button onClick={addItem} className="erp-btn-success text-sm">+ {t("btnAdd")}</button>
              <button onClick={() => { setNewProductName(""); setNewQty(1); setNewPrice(0); setNewDiscount(0); setNewQualityGrade(null); setNewRegion(null); }} className="erp-btn-ghost text-sm">{t("btnClearSheet")}</button>
            </div>
          </div>

          {/* Toggle View by Supplier */}
          <div className="flex items-center gap-3 mb-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={viewBySupplier} onChange={(e) => setViewBySupplier(e.target.checked)} className="w-4 h-4 rounded border-slate-300 text-blue-600" />
              <span className="text-sm font-medium text-slate-700">{t("viewBySupplier")}</span>
            </label>
          </div>

          {/* Items Table or Grouped by Supplier */}
          {viewBySupplier ? (
            <div className="space-y-4">
              {groupedBySupplier.map((group) => (
                <div key={group.supplierId} className="border border-slate-200 rounded-lg overflow-hidden">
                  <div className="bg-slate-100 px-4 py-2 flex justify-between items-center">
                    <span className="font-semibold text-slate-700">🏢 {group.supplierName}</span>
                    <Badge color="blue">{group.items.length} {locale === "gr" ? "είδη" : "items"} | {fmt(group.subtotal)}</Badge>
                  </div>
                  <table className="erp-table">
                    <thead>
                      <tr>
                        <th>#</th><th>{t("fieldProduct")}</th><th>{t("fieldOrderedQty")}</th><th>{t("fieldUnit")}</th>
                        <th>{t("fieldBasePrice")}</th><th>{t("fieldVatPercent")}</th><th>{t("fieldDiscount")}</th>
                        <th>{t("fieldNetAmount")}</th><th>{t("fieldVatAmount")}</th><th>{t("fieldGrossAmount")}</th><th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.items.map((item, idx) => (
                        <tr key={idx}>
                          <td className="text-xs text-slate-400">{idx + 1}</td>
                          <td><input type="text" value={item.productName} onChange={(e) => updateItemField(idx, "productName", e.target.value)} className="erp-input text-xs py-1 min-w-[180px]" /></td>
                          <td><input type="number" value={item.orderedQuantity} onChange={(e) => updateItemField(idx, "orderedQuantity", Number(e.target.value))} className="erp-input text-xs py-1 w-20" step="0.01" /></td>
                          <td className="text-sm min-w-[70px]">{item.unit}</td>
                          <td><input type="number" value={item.basePrice} onChange={(e) => updateItemField(idx, "basePrice", Number(e.target.value))} className="erp-input text-xs py-1 w-20" step="0.01" /></td>
                          <td>{item.vatPercent}%</td>
                          <td>{item.discountPercent}%</td>
                          <td className="font-medium">{fmt(item.netAmount)}</td>
                          <td className="text-slate-500">{fmt(item.vatAmount)}</td>
                          <td className="font-semibold text-emerald-700">{fmt(item.grossAmount)}</td>
                          <td><button onClick={() => removeItem(idx)} className="text-red-400 hover:text-red-600 text-sm">✕</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="erp-table">
                <thead>
                  <tr>
                    <th>#</th><th>{t("fieldProduct")}</th><th>{t("fieldOrderedQty")}</th><th>{t("fieldUnit")}</th>
                    <th>{t("fieldBasePrice")}</th><th>{t("fieldVatPercent")}</th><th>{t("fieldDiscount")}</th>
                    <th>{t("fieldNetAmount")}</th><th>{t("fieldVatAmount")}</th><th>{t("fieldGrossAmount")}</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 ? (
                    <tr><td colSpan={11} className="text-center py-6 text-slate-400">{t("noData")}</td></tr>
                  ) : items.map((item, i) => (
                    <tr key={i}>
                      <td className="text-xs text-slate-400">{i + 1}</td>
                      <td><input type="text" value={item.productName} onChange={(e) => updateItemField(i, "productName", e.target.value)} className="erp-input text-xs py-1 min-w-[180px]" /></td>
                      <td><input type="number" value={item.orderedQuantity} onChange={(e) => updateItemField(i, "orderedQuantity", Number(e.target.value))} className="erp-input text-xs py-1 w-20" step="0.01" /></td>
                      <td className="text-sm min-w-[70px]">{item.unit}</td>
                      <td><input type="number" value={item.basePrice} onChange={(e) => updateItemField(i, "basePrice", Number(e.target.value))} className="erp-input text-xs py-1 w-20" step="0.01" /></td>
                      <td><input type="number" value={item.vatPercent} onChange={(e) => updateItemField(i, "vatPercent", Number(e.target.value))} className="erp-input text-xs py-1 w-16" /></td>
                      <td><input type="number" value={item.discountPercent} onChange={(e) => updateItemField(i, "discountPercent", Number(e.target.value))} className="erp-input text-xs py-1 w-16" /></td>
                      <td className="font-medium">{fmt(item.netAmount)}</td>
                      <td className="text-slate-500">{fmt(item.vatAmount)}</td>
                      <td className="font-semibold text-emerald-700">{fmt(item.grossAmount)}</td>
                      <td><button onClick={() => removeItem(i)} className="text-red-400 hover:text-red-600 text-sm">✕</button></td>
                    </tr>
                  ))}
                </tbody>
                {items.length > 0 && (
                  <tfoot>
                    <tr className="bg-slate-50 font-bold">
                      <td colSpan={7} className="text-right">{t("total")}:</td>
                      <td>{fmt(totalNet)}</td><td>{fmt(totalVat)}</td>
                      <td className="text-emerald-700 text-lg">{fmt(totalGross)}</td><td></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t">
            <button onClick={saveOrder} className="erp-btn-primary" disabled={items.length === 0 || !selectedSupplier || saving}>
              {saving ? "…" : "💾"} {t("btnSaveOrder")}
            </button>
            <button onClick={() => handleExportPDF()} className="erp-btn-secondary">🖨️ {t("btnPrint")}</button>
            <button onClick={handleExportPDF} disabled={items.length === 0} className="erp-btn-secondary">📄 PDF</button>
            <button onClick={handleExportExcel} disabled={items.length === 0} className="erp-btn-secondary">📊 Excel</button>
            {items.length > 0 && (() => {
              // Group items by supplierId to build per-supplier email buttons
              const supplierGroups = new Map<number, { sup: typeof suppliers[0] | undefined; items: typeof items; net: number; vat: number; gross: number }>();
              for (const item of items) {
                const sid = item.supplierId || selectedSupplier || 0;
                if (!supplierGroups.has(sid)) {
                  supplierGroups.set(sid, { sup: suppliers.find(x => x.id === sid), items: [], net: 0, vat: 0, gross: 0 });
                }
                const g = supplierGroups.get(sid)!;
                g.items.push(item);
                g.net += item.netAmount;
                g.vat += item.vatAmount;
                g.gross += item.grossAmount;
              }
              function sendEmail(sid: number) {
                const g = supplierGroups.get(sid)!;
                // Re-lookup supplier at call time in case async load finished after initial render
                const s = g.sup ?? suppliers.find(x => x.id === sid);
                if (!s?.contactEmail) {
                  window.alert(locale === "gr" ? "⚠️ Δεν βρέθηκε email προμηθευτή" : "⚠️ No supplier email found");
                  return;
                }
                const supplierName = locale === "gr" ? s.name : (s.nameEn || s.name);
                const today = new Date(orderDate).toLocaleDateString("el-GR", { day: "2-digit", month: "2-digit", year: "numeric" });
                const subject = `Παραγγελία ${orderNum} – ${bizName} – ${today}`;
                const SEP = "================================================";
                // Build pipe-separated rows — readable in any email font
                const tableRows = g.items.map((item, idx) => {
                  const qty = item.orderedQuantity % 1 === 0 ? item.orderedQuantity.toFixed(0) : item.orderedQuantity.toFixed(3);
                  const name = item.productName.length > 32 ? item.productName.substring(0, 31) + "…" : item.productName;
                  return `${String(idx + 1).padStart(2)}. ${name.padEnd(33)} | ${(qty + " " + item.unit).padEnd(9)} | ${(item.basePrice.toFixed(2) + " EUR").padStart(10)} | ${(item.grossAmount.toFixed(2) + " EUR").padStart(10)}`;
                }).join("\n");
                const body = [
                  `${bizName} — ΠΑΡΑΓΓΕΛΙΑ`,
                  SEP,
                  `Προμηθευτής   : ${supplierName}`,
                  `Email         : ${s.contactEmail}`,
                  `Ημερομηνία    : ${today}`,
                  `ID Παραγγελίας: ${orderNum}`,
                  invoiceNumber ? `Αρ. Τιμολογίου: ${invoiceNumber}` : "",
                  SEP,
                  ``,
                  `Αγαπητοί,`,
                  `Σας αποστέλλουμε την παραγγελία μας.`,
                  `Παρακαλούμε επιβεβαιώστε διαθεσιμότητα και ημερομηνία παράδοσης.`,
                  ``,
                  `  #  ${"ΠΡΟΪΟΝ".padEnd(33)} | ${"ΠΟΣΟΤΗΤΑ".padEnd(9)} |   ΤΙΜΗ/ΜΟΝ |     ΣΥΝΟΛΟ`,
                  `     ${"-".repeat(33)}-+-${"-".repeat(9)}-+${"-".repeat(11)}-+${"-".repeat(11)}`,
                  tableRows,
                  `     ${"-".repeat(33)}-+-${"-".repeat(9)}-+${"-".repeat(11)}-+${"-".repeat(11)}`,
                  `${"".padEnd(48)}  Καθαρή Αξία : ${g.net.toFixed(2)} EUR`,
                  `${"".padEnd(48)}  ΦΠΑ         : ${g.vat.toFixed(2)} EUR`,
                  `${"".padEnd(48)}  ΣΥΝΟΛΟ      : ${g.gross.toFixed(2)} EUR`,
                  SEP,
                  notes ? `Σημειώσεις: ${notes}` : "",
                  ``,
                  `Με εκτίμηση,`,
                  `${bizName}`,
                ].filter(l => l !== undefined).join("\n");
                const s_enc = encodeURIComponent(subject);
                const b_enc = encodeURIComponent(body);
                const fullUrl = `mailto:${s.contactEmail}?subject=${s_enc}&body=${b_enc}`;
                // Fallback: items only if full URL too long for mobile
                const shortBody = [
                  `Παραγγελία ${orderNum} – ${supplierName} – ${today}`,
                  tableRows,
                  `ΣΥΝΟΛΟ: ${g.gross.toFixed(2)} EUR`,
                ].join("\n");
                const shortUrl = `mailto:${s.contactEmail}?subject=${s_enc}&body=${encodeURIComponent(shortBody)}`;
                const url = fullUrl.length < 2000 ? fullUrl : shortUrl;
                const a = document.createElement("a");
                a.href = url; a.target = "_blank"; a.rel = "noopener";
                document.body.appendChild(a); a.click(); document.body.removeChild(a);
              }
              return Array.from(supplierGroups.entries()).map(([sid, g]) => {
                const sup = g.sup ?? suppliers.find(x => x.id === sid);
                const supLabel = sup ? (locale === "gr" ? sup.name : (sup.nameEn || sup.name)) : `#${sid}`;
                return (
                  <button key={sid} onClick={() => sendEmail(sid)} className="erp-btn-secondary">
                    📧 {supLabel} ({fmt(g.gross)})
                  </button>
                );
              });
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}
