"use client";
import { useState, useMemo, useRef, useEffect } from "react";
import { useApp } from "@/lib/context";
import { PageHeader, Badge, KpiCard } from "@/components/shared";
import * as db from "@/lib/supabaseData";
import type { SupplierProduct, BusinessProfile } from "@/lib/types";

// Business (buyer) letterhead info shown on the printed order form and
// in the "Αποστολή Email" body. Filled in from the "Προφίλ → Καρτέλα
// Επιχείρησης" settings page (src/app/profile/page.tsx) — this is just
// the empty fallback shown before that page's data has loaded (or if
// the business profile hasn't been filled in yet).
const EMPTY_BUSINESS_INFO: BusinessProfile = {
  name: "",
  address: "",
  phone: "",
  email: "",
  taxId: "",
  logoDataUrl: null,
};

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

// One real order per supplier, created automatically when items from more
// than one supplier are on the sheet at once (e.g. two greengrocers) — a
// single Order in the database always belongs to exactly one supplier, so
// "Δημιουργία Παραγγελιών" splits the mixed shopping list into one of
// these per supplier, each with its own order number, ready to print or
// email separately.
interface SavedOrderGroup {
  orderNumber: string;
  supplierId: number;
  supplierName: string;
  supplierEmail: string | null;
  supplierPhone: string | null;
  supplierAddress: string | null;
  orderDate: string;
  invoiceNumber: string;
  deliveryNote: string;
  notes: string;
  items: OrderItemDraft[];
  totalNet: number;
  totalVat: number;
  totalGross: number;
}

export default function DraftOrderPage() {
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
  const orderNum = "ORD-" + String(orders.length + 1).padStart(5, "0");
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

  // Orders just created by "Δημιουργία Παραγγελιών" — one per supplier
  // on the sheet, each with its own Print/Email action below.
  const [savedGroups, setSavedGroups] = useState<SavedOrderGroup[]>([]);
  // Which saved group's printable form is currently populated — set
  // right before window.print() so the hidden #printable-order-area
  // shows that ONE supplier's order, not the whole mixed shopping list.
  const [printingGroup, setPrintingGroup] = useState<SavedOrderGroup | null>(null);
  useEffect(() => {
    if (printingGroup) window.print();
  }, [printingGroup]);

  // Business (buyer) letterhead info — loaded once from the
  // business_profile settings row (filled in via Profile → Business
  // Card). Falls back to blank until it loads, same as before.
  const [businessProfile, setBusinessProfile] = useState<BusinessProfile>(EMPTY_BUSINESS_INFO);
  useEffect(() => {
    let cancelled = false;
    db.fetchBusinessProfile()
      .then((profile) => {
        if (!cancelled && profile) setBusinessProfile(profile);
      })
      .catch(() => {
        // No business profile saved yet, or Supabase not configured —
        // keep showing the blank fallback rather than blocking the page.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ---- "Μηχανή Αναζήτησης SKU": live cross-supplier lookup dropdown ----
  // Now a real Postgres full-text query (see searchSupplierProducts in
  // supabaseData.ts) instead of an in-memory filter, so it's debounced
  // (300ms after the person stops typing) rather than firing on every
  // keystroke — a network round trip per character would feel laggy and
  // needlessly load the database.
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

  // Splits the current sheet into one real order PER SUPPLIER (a single
  // order in the database always belongs to exactly one supplier — see
  // SavedOrderGroup above) and saves each one. This is what fixes mixed
  // shopping lists: 100 tomatoes from Πετρούτσα + 1 blueberry pack from
  // Εγγλέζος on the same sheet now become two separate orders, each
  // showing only that supplier's own items on its printout/email.
  async function saveOrder() {
    if (items.length === 0) return;
    const missingSupplier = groupedBySupplier.some((g) => !g.supplierId);
    if (missingSupplier) {
      setSavedMsg(
        locale === "gr"
          ? "⚠️ Κάποια είδη δεν έχουν προμηθευτή — επιλέξτε το προϊόν από τη λίστα αναζήτησης (δείχνει τον προμηθευτή) ή διαλέξτε προμηθευτή στο πεδίο πάνω πριν το προσθέσετε χειροκίνητα."
          : "⚠️ Some items have no supplier — pick the product from the search results (it shows the supplier), or set the supplier field above before adding it manually."
      );
      return;
    }
    setSaving(true);
    try {
      const baseNum = orders.length + 1;
      const results: SavedOrderGroup[] = [];
      for (let i = 0; i < groupedBySupplier.length; i++) {
        const group = groupedBySupplier[i];
        const groupOrderNumber = "ORD-" + String(baseNum + i).padStart(5, "0");
        const groupNet = group.items.reduce((s, it) => s + it.netAmount, 0);
        const groupVat = group.items.reduce((s, it) => s + it.vatAmount, 0);
        const groupGross = group.items.reduce((s, it) => s + it.grossAmount, 0);
        await db.createOrderWithItems(
          {
            orderNumber: groupOrderNumber, supplierId: group.supplierId, orderDate,
            invoiceNumber: invoiceNumber || null, deliveryNoteNumber: deliveryNote || null, notes: notes || null,
            totalNet: groupNet.toFixed(2), totalVat: groupVat.toFixed(2), totalGross: groupGross.toFixed(2),
          },
          group.items.map((it) => ({
            productName: it.productName, orderedQuantity: it.orderedQuantity, unit: it.unit, basePrice: it.basePrice,
            vatPercent: it.vatPercent, discountPercent: it.discountPercent, netAmount: it.netAmount,
            vatAmount: it.vatAmount, grossAmount: it.grossAmount, supplierProductId: it.supplierProductId ?? null,
          }))
        );
        const s = suppliers.find((x) => x.id === group.supplierId);
        results.push({
          orderNumber: groupOrderNumber, supplierId: group.supplierId, supplierName: group.supplierName,
          supplierEmail: s?.contactEmail ?? null, supplierPhone: s?.contactPhone ?? null, supplierAddress: s?.address ?? null,
          orderDate, invoiceNumber, deliveryNote, notes,
          items: group.items, totalNet: groupNet, totalVat: groupVat, totalGross: groupGross,
        });
      }
      await refreshAll();
      setSavedGroups(results);
      setItems([]);
      setInvoiceNumber(""); setDeliveryNote(""); setNotes("");
      setSavedMsg(
        results.length === 1
          ? (locale === "gr" ? "✅ Παραγγελία αποθηκεύτηκε!" : "✅ Order saved!")
          : (locale === "gr" ? `✅ Δημιουργήθηκαν ${results.length} παραγγελίες, μία ανά προμηθευτή:` : `✅ Created ${results.length} orders, one per supplier:`) +
            " " + results.map((r) => `${r.supplierName} (${r.orderNumber})`).join(" · ")
      );
      setTimeout(() => setSavedMsg(""), 6000);
    } catch (err) {
      setSavedMsg(locale === "gr" ? "⚠️ Αποτυχία αποθήκευσης: " + String(err) : "⚠️ Failed to save: " + String(err));
    } finally {
      setSaving(false);
    }
  }

  // Email for ONE saved supplier order (called from its card below) — the
  // per-supplier equivalent of the old single "Αποστολή Email" button.
  function sendGroupEmail(g: SavedOrderGroup) {
    if (!g.supplierEmail) {
      alert(locale === "gr" ? "⚠️ Δεν βρέθηκε email προμηθευτή" : "⚠️ No supplier email found");
      return;
    }
    const dateStr = new Date(g.orderDate).toLocaleDateString("el-GR");
    const subject = (locale === "gr" ? "Παραγγελία" : "Order") + ` — ${g.supplierName} — ${dateStr}`;
    const RULE = "────────────────────────────";
    const bodyLines: string[] = [];

    bodyLines.push(locale === "gr" ? "ΔΕΛΤΙΟ ΠΑΡΑΓΓΕΛΙΑΣ" : "PURCHASE ORDER");
    bodyLines.push(RULE);
    bodyLines.push("");
    if (businessProfile.name) bodyLines.push(businessProfile.name);
    if (businessProfile.address) bodyLines.push(businessProfile.address);
    const businessContactLine = [businessProfile.phone, businessProfile.email, businessProfile.taxId ? `ΑΦΜ: ${businessProfile.taxId}` : ""].filter(Boolean).join("  •  ");
    if (businessContactLine) bodyLines.push(businessContactLine);
    bodyLines.push("");
    bodyLines.push((locale === "gr" ? "Αρ. Παραγγελίας" : "Order No.") + `: ${g.orderNumber}`);
    bodyLines.push((locale === "gr" ? "Ημερομηνία" : "Date") + `: ${dateStr}`);
    if (g.invoiceNumber) bodyLines.push((locale === "gr" ? "Αρ. Τιμολογίου" : "Invoice No.") + `: ${g.invoiceNumber}`);
    if (g.deliveryNote) bodyLines.push((locale === "gr" ? "Δελτίο Αποστολής" : "Delivery Note") + `: ${g.deliveryNote}`);
    bodyLines.push("");
    bodyLines.push(RULE);
    bodyLines.push(locale === "gr" ? "ΠΡΟΣ ΠΡΟΜΗΘΕΥΤΗ" : "SUPPLIER");
    bodyLines.push(RULE);
    bodyLines.push(g.supplierName);
    const supplierContactLine = [g.supplierEmail, g.supplierPhone, g.supplierAddress].filter(Boolean).join("  •  ");
    if (supplierContactLine) bodyLines.push(supplierContactLine);
    bodyLines.push("");
    bodyLines.push(RULE);
    bodyLines.push(locale === "gr" ? "ΕΙΔΗ ΠΑΡΑΓΓΕΛΙΑΣ" : "ORDER ITEMS");
    bodyLines.push(RULE);
    g.items.forEach((i, idx) => {
      bodyLines.push(`${idx + 1}. ${i.productName}`);
      bodyLines.push(`   ${i.orderedQuantity} ${i.unit} × €${i.basePrice.toFixed(2)}  =  €${i.grossAmount.toFixed(2)}`);
    });
    bodyLines.push("");
    bodyLines.push(RULE);
    bodyLines.push((locale === "gr" ? "Καθαρή Αξία" : "Net Amount") + `: €${g.totalNet.toFixed(2)}`);
    bodyLines.push((locale === "gr" ? "ΦΠΑ" : "VAT") + `: €${g.totalVat.toFixed(2)}`);
    bodyLines.push((locale === "gr" ? "ΓΕΝΙΚΟ ΣΥΝΟΛΟ" : "GRAND TOTAL") + `: €${g.totalGross.toFixed(2)}`);
    bodyLines.push(RULE);
    if (g.notes) {
      bodyLines.push("");
      bodyLines.push((locale === "gr" ? "Σημειώσεις" : "Notes") + `: ${g.notes}`);
    }

    const body = bodyLines.join("\n");
    window.location.href = `mailto:${g.supplierEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  function handleExportPDF() {
    window.print();
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
              <label className="erp-label">
                {locale === "gr" ? "Προμηθευτής (προεπιλογή)" : "Supplier (default)"}
              </label>
              <select value={selectedSupplier} onChange={(e) => setSelectedSupplier(Number(e.target.value))} className="erp-select">
                <option value={0}>—</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{locale === "gr" ? s.name : (s.nameEn || s.name)}</option>)}
              </select>
              <div className="text-xs text-slate-400 mt-1">
                {locale === "gr"
                  ? "Χρησιμοποιείται μόνο για είδη που προσθέτεις χειροκίνητα, χωρίς να τα διαλέξεις από την αναζήτηση. Κάθε προμηθευτής θα γίνει ξεχωριστή παραγγελία."
                  : "Only used for items you add manually without picking them from search. Each supplier becomes its own separate order."}
              </div>
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
                  <div className="absolute z-30 mt-1 w-[min(95vw,760px)] max-h-[28rem] overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-2xl">
                    <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 text-sm font-semibold text-slate-500 uppercase tracking-wide">
                      {lookupLoading
                        ? (locale === "gr" ? "Αναζήτηση…" : "Searching…")
                        : locale === "gr"
                          ? `${effectiveResults.length} προσφορές — ταξινομημένες από χαμηλότερη τιμή`
                          : `${effectiveResults.length} matching offers — sorted by lowest price`}
                    </div>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-slate-400 text-left border-b border-slate-100 text-xs uppercase tracking-wide">
                          <th className="px-4 py-2 font-semibold">{t("fieldProduct")}</th>
                          <th className="px-4 py-2 font-semibold">{t("fieldSupplier")}</th>
                          <th className="px-4 py-2 font-semibold">{locale === "gr" ? "Τιμή" : "Price"}</th>
                          <th className="px-4 py-2 font-semibold">{t("fieldQualityGrade")}</th>
                          <th className="px-4 py-2 font-semibold">{t("fieldRegion")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {effectiveResults.map((p, idx) => (
                          <tr
                            key={p.id}
                            onClick={() => selectLookupProduct(p)}
                            className={`cursor-pointer hover:bg-blue-50 border-b border-slate-100 ${idx === 0 ? "bg-emerald-50/60" : ""}`}
                          >
                            <td className="px-4 py-3">
                              <div className="font-semibold text-slate-800 text-base leading-snug">{locale === "gr" ? p.productName : (p.productNameEn || p.productName)}</div>
                            </td>
                            <td className="px-4 py-3">
                              <div className="text-slate-600">{locale === "gr" ? p.supplierName : (p.supplierNameEn || p.supplierName)}</div>
                            </td>
                            <td className="px-4 py-3">
                              <span className={`font-bold text-base ${idx === 0 ? "text-emerald-700" : "text-slate-700"}`}>
                                {fmt(Number(p.basePrice))}/{p.unit}
                              </span>
                              {idx === 0 && <div className="mt-1"><Badge color="green">{t("lowestPrice")}</Badge></div>}
                            </td>
                            <td className="px-4 py-3">
                              <Badge color={p.qualityGrade === "Grade A" ? "green" : "amber"}>{p.qualityGrade || "—"}</Badge>
                            </td>
                            <td className="px-4 py-3 text-slate-500">{p.regionOfOrigin || "—"}</td>
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
                        {group.items.map((item, idx) => (
                          <tr key={idx}>
                            <td className="text-xs text-slate-400">{idx + 1}</td>
                            <td><input type="text" value={item.productName} onChange={(e) => updateItemField(idx, "productName", e.target.value)} className="erp-input text-xs py-1" /></td>
                            <td><input type="number" value={item.orderedQuantity} onChange={(e) => updateItemField(idx, "orderedQuantity", Number(e.target.value))} className="erp-input text-xs py-1 w-20" step="0.01" /></td>
                            <td className="text-sm">{item.unit}</td>
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
                      <td><input type="text" value={item.productName} onChange={(e) => updateItemField(i, "productName", e.target.value)} className="erp-input text-xs py-1" /></td>
                      <td><input type="number" value={item.orderedQuantity} onChange={(e) => updateItemField(i, "orderedQuantity", Number(e.target.value))} className="erp-input text-xs py-1 w-20" step="0.01" /></td>
                      <td className="text-sm">{item.unit}</td>
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

          {/* Action Buttons — Save always splits the sheet into one order
              PER SUPPLIER (see saveOrder above); Print/Email happen per
              supplier from the results panel below, never for the whole
              mixed list at once. */}
          <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t">
            <button onClick={saveOrder} className="erp-btn-primary" disabled={items.length === 0 || saving}>
              {saving ? "…" : "💾"} {locale === "gr" ? "Δημιουργία Παραγγελιών" : "Create Orders"}
            </button>
          </div>
        </div>
      </div>

      {/* Results: one card per supplier order just created — print or
          email each one separately (e.g. Εγγλέζος first, then Πετρούτσα,
          or the other way round). */}
      {savedGroups.length > 0 && (
        <div className="erp-card mb-6">
          <div className="erp-card-header">
            📬 {locale === "gr" ? "Αποστολή ανά Προμηθευτή" : "Send per Supplier"}
          </div>
          <div className="p-4 space-y-3">
            <div className="text-sm text-slate-500 mb-1">
              {locale === "gr"
                ? "Οι παραγγελίες δημιουργήθηκαν, μία για κάθε προμηθευτή. Τύπωσε ή στείλε email σε καθεμία ξεχωριστά:"
                : "Orders were created, one per supplier. Print or email each one separately:"}
            </div>
            {savedGroups.map((g) => (
              <div key={g.orderNumber} className="border border-slate-200 rounded-lg p-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-semibold text-slate-800">🏢 {g.supplierName}</div>
                  <div className="text-xs text-slate-500">
                    {g.orderNumber} · {g.items.length} {locale === "gr" ? "είδη" : "items"} · {fmt(g.totalGross)}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setPrintingGroup(g)} className="erp-btn-secondary text-sm">🖨️ {t("btnPrint")}</button>
                  <button onClick={() => sendGroupEmail(g)} className="erp-btn-secondary text-sm">📧 {t("btnSendEmail")}</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Printable Order Form — a dedicated, professional-looking purchase
          order document for ONE supplier's order (whichever card's
          "Εκτύπωση" button was clicked, held in printingGroup). Hidden on
          screen; shown only when printing (window.print(), triggered by
          the effect above right after setPrintingGroup), using the same
          visibility trick as #printable-recipe-area on the Recipe page. */}
      <div id="printable-order-area" className="hidden">
        <style>{`
          @media print {
            body:has(#printable-order-area) * { visibility: hidden; }
            body:has(#printable-order-area) #printable-order-area,
            body:has(#printable-order-area) #printable-order-area * { visibility: visible; }
            #printable-order-area {
              display: block !important;
              position: absolute; left: 0; top: 0; width: 100%;
            }
            @page { size: A4; margin: 12mm; }
          }
        `}</style>
        {printingGroup && (
          <div style={{ fontFamily: "Arial, sans-serif", color: "#1e293b", padding: "8px" }}>
            {/* Letterhead: buyer info (left) + document title & order meta (right) */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "3px solid #1e293b", paddingBottom: "12px", marginBottom: "16px" }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
                {businessProfile.logoDataUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={businessProfile.logoDataUrl}
                    alt=""
                    style={{ maxHeight: "56px", maxWidth: "110px", objectFit: "contain" }}
                  />
                )}
                <div>
                  <div style={{ fontSize: "20px", fontWeight: 700 }}>
                    {businessProfile.name || (locale === "gr" ? "[Επωνυμία Επιχείρησης]" : "[Business Name]")}
                  </div>
                  {businessProfile.address && <div style={{ fontSize: "11px", color: "#64748b" }}>{businessProfile.address}</div>}
                  {(businessProfile.phone || businessProfile.email || businessProfile.taxId) && (
                    <div style={{ fontSize: "11px", color: "#64748b" }}>
                      {[businessProfile.phone, businessProfile.email, businessProfile.taxId ? `ΑΦΜ: ${businessProfile.taxId}` : ""].filter(Boolean).join("  •  ")}
                    </div>
                  )}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: "18px", fontWeight: 700 }}>
                  {locale === "gr" ? "ΔΕΛΤΙΟ ΠΑΡΑΓΓΕΛΙΑΣ" : "PURCHASE ORDER"}
                </div>
                <div style={{ fontSize: "12px", color: "#64748b", marginTop: "4px" }}>
                  {locale === "gr" ? "Αρ. Παραγγελίας" : "Order No."}: <strong>{printingGroup.orderNumber}</strong>
                </div>
                <div style={{ fontSize: "12px", color: "#64748b" }}>
                  {locale === "gr" ? "Ημερομηνία" : "Date"}: <strong>{new Date(printingGroup.orderDate).toLocaleDateString("el-GR")}</strong>
                </div>
                {printingGroup.invoiceNumber && (
                  <div style={{ fontSize: "12px", color: "#64748b" }}>
                    {locale === "gr" ? "Αρ. Τιμολογίου" : "Invoice No."}: <strong>{printingGroup.invoiceNumber}</strong>
                  </div>
                )}
                {printingGroup.deliveryNote && (
                  <div style={{ fontSize: "12px", color: "#64748b" }}>
                    {locale === "gr" ? "Δελτίο Αποστολής" : "Delivery Note"}: <strong>{printingGroup.deliveryNote}</strong>
                  </div>
                )}
              </div>
            </div>

            {/* Supplier (recipient) block */}
            <div style={{ marginBottom: "16px" }}>
              <div style={{ fontSize: "10px", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "4px" }}>
                {locale === "gr" ? "Προς Προμηθευτή" : "Supplier"}
              </div>
              <div style={{ border: "1px solid #e2e8f0", borderRadius: "6px", padding: "10px 14px" }}>
                <div style={{ fontSize: "14px", fontWeight: 700 }}>{printingGroup.supplierName}</div>
                <div style={{ fontSize: "11px", color: "#64748b" }}>
                  {[printingGroup.supplierEmail, printingGroup.supplierPhone, printingGroup.supplierAddress].filter(Boolean).join("  •  ")}
                </div>
              </div>
            </div>

            {/* Items table */}
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
              <thead>
                <tr style={{ background: "#1e293b", color: "#fff" }}>
                  <th style={{ padding: "6px 8px", textAlign: "left" }}>#</th>
                  <th style={{ padding: "6px 8px", textAlign: "left" }}>{locale === "gr" ? "Προϊόν" : "Product"}</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>{locale === "gr" ? "Ποσότητα" : "Qty"}</th>
                  <th style={{ padding: "6px 8px", textAlign: "left" }}>{locale === "gr" ? "Μονάδα" : "Unit"}</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>{locale === "gr" ? "Τιμή Μον." : "Unit Price"}</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>{locale === "gr" ? "Έκπτ. %" : "Disc. %"}</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>{locale === "gr" ? "Καθαρό" : "Net"}</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>{locale === "gr" ? "ΦΠΑ" : "VAT"}</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>{locale === "gr" ? "Σύνολο" : "Total"}</th>
                </tr>
              </thead>
              <tbody>
                {printingGroup.items.map((item, idx) => (
                  <tr key={idx} style={{ background: idx % 2 === 0 ? "#fff" : "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                    <td style={{ padding: "5px 8px", color: "#94a3b8" }}>{idx + 1}</td>
                    <td style={{ padding: "5px 8px", fontWeight: 500 }}>{item.productName}</td>
                    <td style={{ padding: "5px 8px", textAlign: "right" }}>{item.orderedQuantity}</td>
                    <td style={{ padding: "5px 8px" }}>{item.unit}</td>
                    <td style={{ padding: "5px 8px", textAlign: "right" }}>{fmt(item.basePrice)}</td>
                    <td style={{ padding: "5px 8px", textAlign: "right" }}>{item.discountPercent}%</td>
                    <td style={{ padding: "5px 8px", textAlign: "right" }}>{fmt(item.netAmount)}</td>
                    <td style={{ padding: "5px 8px", textAlign: "right" }}>{fmt(item.vatAmount)}</td>
                    <td style={{ padding: "5px 8px", textAlign: "right", fontWeight: 700 }}>{fmt(item.grossAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Totals */}
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "12px" }}>
              <table style={{ fontSize: "12px", minWidth: "220px" }}>
                <tbody>
                  <tr>
                    <td style={{ padding: "3px 12px 3px 0", color: "#64748b" }}>{locale === "gr" ? "Καθαρή Αξία" : "Net Amount"}</td>
                    <td style={{ padding: "3px 0", textAlign: "right", fontWeight: 600 }}>{fmt(printingGroup.totalNet)}</td>
                  </tr>
                  <tr>
                    <td style={{ padding: "3px 12px 3px 0", color: "#64748b" }}>{locale === "gr" ? "ΦΠΑ" : "VAT"}</td>
                    <td style={{ padding: "3px 0", textAlign: "right", fontWeight: 600 }}>{fmt(printingGroup.totalVat)}</td>
                  </tr>
                  <tr style={{ borderTop: "2px solid #1e293b" }}>
                    <td style={{ padding: "6px 12px 3px 0", fontWeight: 700 }}>{locale === "gr" ? "Γενικό Σύνολο" : "Grand Total"}</td>
                    <td style={{ padding: "6px 0 3px", textAlign: "right", fontWeight: 700, fontSize: "15px" }}>{fmt(printingGroup.totalGross)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Notes */}
            {printingGroup.notes && (
              <div style={{ marginTop: "16px", fontSize: "11px" }}>
                <div style={{ fontWeight: 700, color: "#64748b", marginBottom: "2px" }}>{locale === "gr" ? "Σημειώσεις" : "Notes"}</div>
                <div>{printingGroup.notes}</div>
              </div>
            )}

            {/* Signature area */}
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: "48px" }}>
              <div style={{ width: "45%" }}>
                <div style={{ borderTop: "1px solid #1e293b", paddingTop: "4px", fontSize: "10px", color: "#64748b" }}>
                  {locale === "gr" ? "Υπογραφή Παραδίδοντος" : "Delivered By"}
                </div>
              </div>
              <div style={{ width: "45%" }}>
                <div style={{ borderTop: "1px solid #1e293b", paddingTop: "4px", fontSize: "10px", color: "#64748b" }}>
                  {locale === "gr" ? "Υπογραφή Παραλαβόντος" : "Received By"}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
