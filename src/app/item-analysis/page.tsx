"use client";
// ----------------------------------------------------------------
// /item-analysis — Ανάλυση Είδους από το ιστορικό παραγγελιών
// (αντίστοιχο του φύλλου «Ανάλυση Είδους» του Excel).
//
//  • Χωρίς επιλογή: λίστα όλων των ομάδων/ειδών με αξία, τιμές,
//    τελευταία αγορά, φθηνότερο προμηθευτή — κλικ για ανάλυση.
//  • Με επιλογή: σύνοψη, τελευταία παραγγελία, ανάλυση ανά
//    προμηθευτή, είδη της ομάδας και όλες οι κινήσεις.
//  • Τρόπος: Ομάδα (ενοποιημένα είδη μέσω SKU) ή μεμονωμένο Είδος.
//  • Φίλτρο ημερομηνιών Από/Έως.
// Τιμές χωρίς ΦΠΑ, με ξεχωριστές στήλες «με ΦΠΑ» όπου χρειάζεται.
// ----------------------------------------------------------------
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useApp } from "@/lib/context";
import { PageHeader, KpiCard, Badge } from "@/components/shared";
import * as db from "@/lib/supabaseData";
import {
  buildSkuLookup, groupLines, computeStats, normKey,
  type PurchaseLine, type SkuInfo, type ItemStats,
} from "@/lib/itemAnalysis";

type Mode = "group" | "product";
type SortKey = "label" | "lines" | "qty" | "net" | "avgWeighted" | "lastPrice" | "lastDate";

const eur = (n: number, max = 2) => "€" + n.toLocaleString("el-GR", { minimumFractionDigits: 2, maximumFractionDigits: max });
const num = (n: number) => n.toLocaleString("el-GR", { maximumFractionDigits: 3 });
const dmy = (d: string) => d ? d.split("-").reverse().join("/") : "—";

export default function ItemAnalysisPage() {
  const { locale, data } = useApp();
  const gr = locale === "gr";

  const [lookup, setLookup] = useState<Map<string, SkuInfo>>(new Map());
  const [skuLoaded, setSkuLoaded] = useState(false);
  const [mode, setMode] = useState<Mode>("group");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("net");
  const [sortAsc, setSortAsc] = useState(false);
  const [shown, setShown] = useState(200);

  useEffect(() => {
    let cancelled = false;
    db.fetchProductSkuMap()
      .then(entries => { if (!cancelled) setLookup(buildSkuLookup(entries)); })
      .catch(() => { /* χωρίς ομαδοποίηση: κάθε προϊόν είναι δική του ομάδα */ })
      .finally(() => { if (!cancelled) setSkuLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  // Όλες οι γραμμές αγορών (μόνο όσες έχουν ημερομηνία και ποσότητα)
  const allLines = useMemo<PurchaseLine[]>(() => data.orderItems
    .filter(i => i && i.orderDate && i.productName)
    .map(i => {
      const qty = Number(i.deliveredQuantity ?? i.orderedQuantity ?? 0) || Number(i.orderedQuantity ?? 0);
      const net = Number(i.netAmount ?? 0);
      const price = Number(i.basePrice ?? 0) || (qty ? net / qty : 0);
      return {
        id: i.id, date: i.orderDate!, orderNumber: i.orderNumber ?? String(i.orderId),
        supplier: i.supplierName ?? "—", product: i.productName, qty, unit: i.unit ?? "",
        price, vatPercent: Number(i.vatPercent ?? 0), net, gross: Number(i.grossAmount ?? 0),
      };
    }), [data.orderItems]);

  const dateBounds = useMemo(() => {
    const ds = allLines.map(l => l.date).sort();
    return { min: ds[0] ?? "", max: ds[ds.length - 1] ?? "" };
  }, [allLines]);

  const lines = useMemo(() => allLines.filter(l =>
    (!dateFrom || l.date >= dateFrom) && (!dateTo || l.date <= dateTo)), [allLines, dateFrom, dateTo]);

  const groups = useMemo(() => groupLines(lines, lookup, mode), [lines, lookup, mode]);

  const overview = useMemo(() => {
    const q = normKey(search);
    const list = [...groups.entries()].map(([key, g]) => computeStats(key, g.label, g.sku, g.lines))
      .filter(s => !q || normKey(s.label).includes(q) || (s.sku ?? "").toUpperCase().includes(q)
        || s.products.some(p => normKey(p).includes(q)));
    const dir = sortAsc ? 1 : -1;
    list.sort((a, b) => {
      const va = a[sortKey], vb = b[sortKey];
      if (typeof va === "string" || typeof vb === "string") return String(va).localeCompare(String(vb), "el") * dir;
      return ((va as number) - (vb as number)) * dir;
    });
    return list;
  }, [groups, search, sortKey, sortAsc]);

  const stats: ItemStats | null = useMemo(() => {
    if (!selected) return null;
    const g = groups.get(selected);
    return g ? computeStats(selected, g.label, g.sku, g.lines) : null;
  }, [selected, groups]);

  const totals = useMemo(() => ({
    net: lines.reduce((s, l) => s + l.net, 0),
    gross: lines.reduce((s, l) => s + l.gross, 0),
  }), [lines]);

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortAsc(!sortAsc);
    else { setSortKey(k); setSortAsc(k === "label"); }
  }
  const sortMark = (k: SortKey) => sortKey === k ? (sortAsc ? " ▲" : " ▼") : "";

  function switchMode(m: Mode) {
    setMode(m);
    // κράτα την επιλογή αν υπάρχει αντίστοιχη στη νέα λειτουργία
    if (selected && stats) {
      if (m === "product" && stats.products.length === 1) setSelected("P:" + normKey(stats.products[0]));
      else setSelected(null);
    }
  }

  const loading = !skuLoaded;
  const noSkuCount = useMemo(() => new Set(lines.filter(l => !lookup.has(normKey(l.product))).map(l => normKey(l.product))).size, [lines, lookup]);

  return (
    <div>
      <PageHeader
        title={gr ? "Ανάλυση Είδους" : "Item Analysis"}
        subtitle={gr ? "Ανάλυση είδους από το ιστορικό παραγγελιών — τιμές χωρίς ΦΠΑ" : "Purchase history analysis — net prices"}
      >
        {stats && <button onClick={() => window.print()} className="erp-btn-secondary">🖨️ {gr ? "Εκτύπωση" : "Print"}</button>}
      </PageHeader>

      {/* Φίλτρα */}
      <div className="erp-card mb-6 print:hidden">
        <div className="p-5 grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
          <div className="md:col-span-2">
            <label className="erp-label">{gr ? "Είδος / Ομάδα / SKU" : "Item / Group / SKU"}</label>
            <input
              type="text" value={search} onChange={e => { setSearch(e.target.value); setSelected(null); setShown(200); }}
              placeholder={gr ? "π.χ. ελαιόλαδο, ντομάτα, SKU-0223" : "e.g. olive oil, SKU-0223"}
              className="erp-input"
            />
          </div>
          <div>
            <label className="erp-label">{gr ? "Από ημερομηνία" : "From"}</label>
            <input type="date" value={dateFrom} min={dateBounds.min} max={dateBounds.max} onChange={e => setDateFrom(e.target.value)} className="erp-input" />
          </div>
          <div>
            <label className="erp-label">{gr ? "Έως ημερομηνία" : "To"}</label>
            <input type="date" value={dateTo} min={dateBounds.min} max={dateBounds.max} onChange={e => setDateTo(e.target.value)} className="erp-input" />
          </div>
          <div className="md:col-span-4 flex flex-wrap items-center gap-3 text-sm">
            <span className="text-slate-500">{gr ? "Τρόπος αναζήτησης:" : "Search by:"}</span>
            <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden">
              <button onClick={() => switchMode("group")} className={`px-3 py-1.5 ${mode === "group" ? "bg-blue-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>
                {gr ? "Ομάδα (ενοποιημένα είδη)" : "Group (merged items)"}
              </button>
              <button onClick={() => switchMode("product")} className={`px-3 py-1.5 border-l border-slate-200 ${mode === "product" ? "bg-blue-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>
                {gr ? "Μεμονωμένο είδος" : "Single item"}
              </button>
            </div>
            {(dateFrom || dateTo || search) && (
              <button onClick={() => { setDateFrom(""); setDateTo(""); setSearch(""); setSelected(null); }} className="erp-btn-ghost text-xs">
                ✕ {gr ? "Καθαρισμός" : "Clear"}
              </button>
            )}
            <span className="ml-auto text-xs text-slate-400">
              {gr ? "Δεδομένα" : "Data"}: {dmy(dateBounds.min)} – {dmy(dateBounds.max)} · {lines.length.toLocaleString("el-GR")} {gr ? "γραμμές" : "lines"}
              {noSkuCount > 0 && <> · <Link href="/sku-mapping" className="text-amber-600 hover:underline">{noSkuCount} {gr ? "είδη χωρίς ομάδα SKU" : "items without SKU group"}</Link></>}
            </span>
          </div>
        </div>
      </div>

      {loading && <div className="erp-card p-8 text-center text-slate-400">{gr ? "Φόρτωση…" : "Loading…"}</div>}

      {/* ── Λεπτομερής ανάλυση ── */}
      {!loading && stats && (
        <div id="printable-recipe-area">
          <div className="flex items-center gap-3 mb-4 print:hidden">
            <button onClick={() => setSelected(null)} className="erp-btn-ghost text-sm">← {gr ? "Όλα τα είδη" : "All items"}</button>
          </div>

          <div className="erp-card mb-6">
            <div className="p-5 flex flex-wrap items-baseline gap-3 border-b border-slate-100">
              <h2 className="text-xl font-bold text-slate-800">{stats.label}</h2>
              {stats.sku && <Badge color="blue">{stats.sku}</Badge>}
              <span className="text-sm text-slate-500">
                {mode === "group" ? (gr ? "Ομάδα" : "Group") : (gr ? "Είδος" : "Item")}
                {" · "}{dmy(dateFrom || dateBounds.min)} – {dmy(dateTo || dateBounds.max)}
              </span>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 p-5">
              <KpiCard label={gr ? "Συνολική αξία χωρίς ΦΠΑ" : "Total net"} value={eur(stats.net)} color="blue" icon="💶" subtitle={`${gr ? "με ΦΠΑ" : "gross"} ${eur(stats.gross)}`} />
              <KpiCard label={gr ? "Συνολική ποσότητα" : "Total quantity"} value={`${num(stats.qty)} ${stats.unit}`} color="green" icon="📦" subtitle={`${stats.lines} ${gr ? "αγορές" : "purchases"}`} />
              <KpiCard label={gr ? "Μέση τιμή (σταθμισμένη)" : "Weighted avg price"} value={eur(stats.avgWeighted, 4)} color="purple" icon="⚖️" subtitle={`${gr ? "απλή" : "simple"} ${eur(stats.avgSimple, 4)}`} />
              <KpiCard label={gr ? "Τελευταία τιμή" : "Last price"} value={eur(stats.lastPrice, 4)} color="amber" icon="🕒" subtitle={`${dmy(stats.lastDate)} · ${stats.lastSupplier}`} />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            <div className="erp-card">
              <div className="erp-card-header"><h3 className="font-semibold">📊 {gr ? "Σύνοψη" : "Summary"}</h3></div>
              <table className="erp-table text-sm">
                <tbody>
                  <tr><td className="text-slate-500">{gr ? "Μονάδα" : "Unit"}</td><td className="font-medium">{stats.unit}</td></tr>
                  <tr><td className="text-slate-500">{gr ? "Πλήθος αγορών (γραμμές)" : "Purchases (lines)"}</td><td className="font-medium">{stats.lines}</td></tr>
                  <tr><td className="text-slate-500">{gr ? "Συνολική ποσότητα" : "Total quantity"}</td><td className="font-medium">{num(stats.qty)} {stats.unit}</td></tr>
                  <tr><td className="text-slate-500">{gr ? "Συνολική αξία χωρίς ΦΠΑ / με ΦΠΑ" : "Total net / gross"}</td><td className="font-medium">{eur(stats.net)} / {eur(stats.gross)}</td></tr>
                  <tr><td className="text-slate-500">{gr ? "Μέση τιμή (σταθμισμένη)" : "Weighted average"}</td><td className="font-medium">{eur(stats.avgWeighted, 4)}</td></tr>
                  <tr><td className="text-slate-500">{gr ? "Μέση τιμή (απλή)" : "Simple average"}</td><td className="font-medium">{eur(stats.avgSimple, 4)}</td></tr>
                  <tr><td className="text-slate-500">{gr ? "Χαμηλότερη τιμή" : "Lowest price"}</td><td className="font-medium text-emerald-700">{eur(stats.low, 4)}</td></tr>
                  <tr><td className="text-slate-500">{gr ? "Υψηλότερη τιμή" : "Highest price"}</td><td className="font-medium text-red-600">{eur(stats.high, 4)}</td></tr>
                  <tr><td className="text-slate-500">{gr ? "Προμηθευτής χαμηλότερης τιμής" : "Cheapest supplier"}</td><td className="font-medium">{stats.lowSupplier}</td></tr>
                  <tr><td className="text-slate-500">{gr ? "Είδη στην ομάδα" : "Items in group"}</td><td className="font-medium">{stats.products.length}</td></tr>
                </tbody>
              </table>
            </div>
            <div className="erp-card">
              <div className="erp-card-header"><h3 className="font-semibold">🕒 {gr ? "Τελευταία παραγγελία" : "Last order"}</h3></div>
              <table className="erp-table text-sm">
                <tbody>
                  <tr><td className="text-slate-500">{gr ? "Ημερομηνία" : "Date"}</td><td className="font-medium">{dmy(stats.lastDate)}</td></tr>
                  <tr><td className="text-slate-500">{gr ? "Προμηθευτής" : "Supplier"}</td><td className="font-medium">{stats.lastSupplier}</td></tr>
                  <tr><td className="text-slate-500">{gr ? "Ποσότητα" : "Quantity"}</td><td className="font-medium">{num(stats.lastQty)} {stats.unit}</td></tr>
                  <tr><td className="text-slate-500">{gr ? "Τιμή μονάδας χωρίς ΦΠΑ" : "Unit price (net)"}</td><td className="font-medium">{eur(stats.lastPrice, 4)}</td></tr>
                  <tr><td className="text-slate-500">{gr ? "Τιμή μονάδας με ΦΠΑ" : "Unit price (gross)"}</td><td className="font-medium">{eur(stats.lastPrice * (1 + (stats.rows[0]?.vatPercent ?? 0) / 100), 4)}</td></tr>
                  <tr><td className="text-slate-500">{gr ? "Μέση ποσότητα / παραγγελία" : "Avg qty / order"}</td><td className="font-medium">{num(stats.avgQtyPerOrder)} {stats.unit}</td></tr>
                </tbody>
              </table>
              <div className="erp-card-header border-t"><h3 className="font-semibold text-sm">🧾 {gr ? "Είδη που περιλαμβάνονται" : "Items included"}</h3></div>
              <ul className="px-5 py-3 text-sm space-y-1 max-h-48 overflow-y-auto">
                {stats.products.map(p => <li key={p} className="text-slate-700">• {p}</li>)}
              </ul>
            </div>
          </div>

          <div className="erp-card mb-6">
            <div className="erp-card-header"><h3 className="font-semibold">🏢 {gr ? "Ανάλυση ανά προμηθευτή" : "By supplier"}</h3></div>
            <div className="overflow-x-auto">
              <table className="erp-table text-sm">
                <thead><tr>
                  <th>{gr ? "Προμηθευτής" : "Supplier"}</th>
                  <th className="text-right">{gr ? "Αγορές" : "Purchases"}</th>
                  <th className="text-right">{gr ? "Ποσότητα" : "Qty"}</th>
                  <th className="text-right">{gr ? "Αξία χωρίς ΦΠΑ" : "Net"}</th>
                  <th className="text-right">{gr ? "Αξία με ΦΠΑ" : "Gross"}</th>
                  <th className="text-right">{gr ? "Μέση τιμή" : "Avg"}</th>
                  <th className="text-right">{gr ? "Χαμηλή" : "Low"}</th>
                  <th className="text-right">{gr ? "Υψηλή" : "High"}</th>
                  <th className="text-right">{gr ? "Τελ. τιμή" : "Last price"}</th>
                  <th>{gr ? "Τελ. αγορά" : "Last purchase"}</th>
                </tr></thead>
                <tbody>
                  {stats.suppliers.map(s => (
                    <tr key={s.supplier}>
                      <td className="font-medium">{s.supplier} {s.supplier === stats.lowSupplier && <Badge color="green">{gr ? "φθηνότερος" : "cheapest"}</Badge>}</td>
                      <td className="text-right">{s.lines}</td>
                      <td className="text-right">{num(s.qty)}</td>
                      <td className="text-right">{eur(s.net)}</td>
                      <td className="text-right">{eur(s.gross)}</td>
                      <td className="text-right font-semibold">{eur(s.avg, 4)}</td>
                      <td className="text-right text-emerald-700">{eur(s.low, 4)}</td>
                      <td className="text-right text-red-600">{eur(s.high, 4)}</td>
                      <td className="text-right">{eur(s.lastPrice, 4)}</td>
                      <td>{dmy(s.lastDate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="erp-card mb-6">
            <div className="erp-card-header"><h3 className="font-semibold">📋 {gr ? "Κινήσεις" : "Purchases"} ({stats.rows.length})</h3></div>
            <div className="overflow-x-auto">
              <table className="erp-table text-sm">
                <thead><tr>
                  <th>{gr ? "Ημ/νία" : "Date"}</th>
                  <th>{gr ? "Παραγγελία" : "Order"}</th>
                  <th>{gr ? "Προμηθευτής" : "Supplier"}</th>
                  <th>{gr ? "Προϊόν" : "Product"}</th>
                  <th className="text-right">{gr ? "Ποσότητα" : "Qty"}</th>
                  <th>{gr ? "Μ.Μ." : "Unit"}</th>
                  <th className="text-right">{gr ? "Τιμή χωρίς ΦΠΑ" : "Net price"}</th>
                  <th className="text-right">{gr ? "Τιμή με ΦΠΑ" : "Gross price"}</th>
                  <th className="text-right">{gr ? "Σύνολο χωρίς ΦΠΑ" : "Net total"}</th>
                  <th className="text-right">{gr ? "Σύνολο με ΦΠΑ" : "Gross total"}</th>
                </tr></thead>
                <tbody>
                  {stats.rows.map(r => (
                    <tr key={r.id}>
                      <td className="whitespace-nowrap">{dmy(r.date)}</td>
                      <td className="font-mono text-xs text-slate-500">{r.orderNumber}</td>
                      <td>{r.supplier}</td>
                      <td>{r.product}</td>
                      <td className="text-right">{num(r.qty)}</td>
                      <td><span className="px-2 py-0.5 bg-slate-100 rounded text-xs">{r.unit}</span></td>
                      <td className="text-right">{eur(r.price, 4)}</td>
                      <td className="text-right">{eur(r.price * (1 + r.vatPercent / 100), 4)}</td>
                      <td className="text-right">{eur(r.net)}</td>
                      <td className="text-right font-medium">{eur(r.gross)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── Λίστα όλων ── */}
      {!loading && !stats && (
        <div className="erp-card">
          <div className="erp-card-header flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">
              🔎 {mode === "group" ? (gr ? "Ομάδες ειδών" : "Item groups") : (gr ? "Είδη" : "Items")} ({overview.length.toLocaleString("el-GR")})
            </h3>
            <span className="text-xs text-slate-500">
              {gr ? "Σύνολο περιόδου" : "Period total"}: <b>{eur(totals.net)}</b> {gr ? "χωρίς ΦΠΑ" : "net"} · <b>{eur(totals.gross)}</b> {gr ? "με ΦΠΑ" : "gross"} — {gr ? "κλικ σε γραμμή για ανάλυση" : "click a row for details"}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="erp-table text-sm">
              <thead><tr className="cursor-pointer select-none">
                <th onClick={() => toggleSort("label")}>{mode === "group" ? (gr ? "Ομάδα" : "Group") : (gr ? "Είδος" : "Item")}{sortMark("label")}</th>
                <th>SKU</th>
                <th className="text-right" onClick={() => toggleSort("lines")}>{gr ? "Αγορές" : "Purchases"}{sortMark("lines")}</th>
                <th className="text-right" onClick={() => toggleSort("qty")}>{gr ? "Ποσότητα" : "Qty"}{sortMark("qty")}</th>
                <th className="text-right" onClick={() => toggleSort("net")}>{gr ? "Αξία χωρίς ΦΠΑ" : "Net"}{sortMark("net")}</th>
                <th className="text-right" onClick={() => toggleSort("avgWeighted")}>{gr ? "Μέση τιμή" : "Avg price"}{sortMark("avgWeighted")}</th>
                <th className="text-right" onClick={() => toggleSort("lastPrice")}>{gr ? "Τελ. τιμή" : "Last price"}{sortMark("lastPrice")}</th>
                <th onClick={() => toggleSort("lastDate")}>{gr ? "Τελ. αγορά" : "Last purchase"}{sortMark("lastDate")}</th>
                <th>{gr ? "Φθηνότερος" : "Cheapest"}</th>
              </tr></thead>
              <tbody>
                {overview.length === 0 && <tr><td colSpan={9} className="text-center py-8 text-slate-400">{gr ? "Δεν βρέθηκαν είδη" : "No items found"}</td></tr>}
                {overview.slice(0, shown).map(s => (
                  <tr key={s.key} className="cursor-pointer hover:bg-blue-50/50" onClick={() => setSelected(s.key)}>
                    <td className="font-medium">
                      {s.label}
                      {mode === "group" && s.products.length > 1 && <span className="ml-2 text-xs text-slate-400">({s.products.length} {gr ? "είδη" : "items"})</span>}
                    </td>
                    <td className="font-mono text-xs text-slate-500">{s.sku ?? "—"}</td>
                    <td className="text-right">{s.lines}</td>
                    <td className="text-right">{num(s.qty)} <span className="text-xs text-slate-400">{s.unit}</span></td>
                    <td className="text-right font-semibold">{eur(s.net)}</td>
                    <td className="text-right">{eur(s.avgWeighted, 4)}</td>
                    <td className="text-right">{eur(s.lastPrice, 4)}</td>
                    <td className="whitespace-nowrap">{dmy(s.lastDate)}</td>
                    <td className="text-xs">{s.lowSupplier}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {overview.length > shown && (
            <div className="p-4 text-center">
              <button onClick={() => setShown(n => n + 300)} className="erp-btn-secondary text-sm">
                {gr ? `Εμφάνιση περισσότερων (${shown} από ${overview.length})` : `Show more (${shown} of ${overview.length})`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
