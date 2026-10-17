// ----------------------------------------------------------------
// Ανάλυση Είδους από το ιστορικό παραγγελιών (όπως το φύλλο
// «Ανάλυση Είδους» του Excel).
//
// Κάθε γραμμή παραγγελίας αντιστοιχίζεται σε ΟΜΑΔΑ μέσω της
// Ομαδοποίησης Ειδών (SKU). Προϊόντα χωρίς ομάδα μετρούν ως δική
// τους ομάδα. Όλες οι τιμές είναι χωρίς ΦΠΑ, εκτός όπου λέει «με ΦΠΑ».
// ----------------------------------------------------------------

export interface PurchaseLine {
  id: number;
  date: string;            // YYYY-MM-DD
  orderNumber: string;
  supplier: string;
  product: string;
  qty: number;
  unit: string;
  price: number;           // τιμή μονάδας χωρίς ΦΠΑ
  vatPercent: number;
  net: number;
  gross: number;
}

export interface SkuInfo { sku: string; group: string }

export interface SupplierStats {
  supplier: string; lines: number; qty: number; net: number; gross: number;
  avg: number; low: number; high: number; lastDate: string; lastPrice: number;
}

export interface ItemStats {
  key: string;             // κλειδί ομάδας ή προϊόντος
  label: string;           // όνομα ομάδας / προϊόντος
  sku: string | null;
  unit: string;            // συχνότερη μονάδα
  lines: number;
  qty: number;
  net: number;
  gross: number;
  avgWeighted: number;     // αξία / ποσότητα
  avgSimple: number;       // μέσος όρος τιμών γραμμών
  low: number; lowSupplier: string;
  high: number;
  lastDate: string; lastPrice: number; lastSupplier: string; lastQty: number;
  avgQtyPerOrder: number;
  products: string[];
  suppliers: SupplierStats[];
  rows: PurchaseLine[];    // νεότερες πρώτα
}

export function normKey(s: string): string {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toUpperCase().replace(/\s+/g, " ").trim();
}

const r4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;

export function buildSkuLookup(entries: { productName: string; sku: string; finalGroup: string }[]): Map<string, SkuInfo> {
  const m = new Map<string, SkuInfo>();
  for (const e of entries) {
    const k = normKey(e.productName);
    if (k && !m.has(k)) m.set(k, { sku: e.sku, group: e.finalGroup || e.productName });
  }
  return m;
}

/** Κλειδί/ετικέτα ομάδας για ένα προϊόν. */
export function groupOf(product: string, lookup: Map<string, SkuInfo>): { key: string; label: string; sku: string | null } {
  const info = lookup.get(normKey(product));
  if (info) return { key: "G:" + normKey(info.group), label: info.group.trim(), sku: info.sku };
  return { key: "P:" + normKey(product), label: product.trim(), sku: null };
}

export function computeStats(key: string, label: string, sku: string | null, lines: PurchaseLine[]): ItemStats {
  const rows = [...lines].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  const qty = lines.reduce((s, l) => s + l.qty, 0);
  const net = lines.reduce((s, l) => s + l.net, 0);
  const gross = lines.reduce((s, l) => s + l.gross, 0);
  const units = new Map<string, number>();
  for (const l of lines) units.set(l.unit, (units.get(l.unit) ?? 0) + 1);
  const unit = [...units.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  let lowLine = lines[0], high = lines[0]?.price ?? 0;
  for (const l of lines) {
    if (l.price < lowLine.price) lowLine = l;
    if (l.price > high) high = l.price;
  }
  const last = rows[0];
  const orders = new Set(lines.map(l => l.orderNumber)).size;

  const bySup = new Map<string, PurchaseLine[]>();
  for (const l of lines) bySup.set(l.supplier, [...(bySup.get(l.supplier) ?? []), l]);
  const suppliers: SupplierStats[] = [...bySup.entries()].map(([supplier, ls]) => {
    const q = ls.reduce((s, l) => s + l.qty, 0);
    const n = ls.reduce((s, l) => s + l.net, 0);
    const g = ls.reduce((s, l) => s + l.gross, 0);
    const lastL = [...ls].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)[0];
    return {
      supplier, lines: ls.length, qty: q, net: n, gross: g,
      avg: q ? r4(n / q) : 0,
      low: Math.min(...ls.map(l => l.price)), high: Math.max(...ls.map(l => l.price)),
      lastDate: lastL.date, lastPrice: lastL.price,
    };
  }).sort((a, b) => b.net - a.net);

  return {
    key, label, sku, unit,
    lines: lines.length, qty, net, gross,
    avgWeighted: qty ? r4(net / qty) : 0,
    avgSimple: lines.length ? r4(lines.reduce((s, l) => s + l.price, 0) / lines.length) : 0,
    low: lowLine?.price ?? 0, lowSupplier: lowLine?.supplier ?? "",
    high,
    lastDate: last?.date ?? "", lastPrice: last?.price ?? 0, lastSupplier: last?.supplier ?? "", lastQty: last?.qty ?? 0,
    avgQtyPerOrder: orders ? qty / orders : 0,
    products: [...new Set(lines.map(l => l.product.trim()))].sort((a, b) => a.localeCompare(b, "el")),
    suppliers, rows,
  };
}

/** Ομαδοποιεί όλες τις γραμμές ανά ομάδα (ή ανά προϊόν). */
export function groupLines(lines: PurchaseLine[], lookup: Map<string, SkuInfo>, mode: "group" | "product"): Map<string, { label: string; sku: string | null; lines: PurchaseLine[] }> {
  const out = new Map<string, { label: string; sku: string | null; lines: PurchaseLine[] }>();
  for (const l of lines) {
    let key: string, label: string, sku: string | null;
    if (mode === "group") ({ key, label, sku } = groupOf(l.product, lookup));
    else { key = "P:" + normKey(l.product); label = l.product.trim(); sku = lookup.get(normKey(l.product))?.sku ?? null; }
    const e = out.get(key) ?? { label, sku, lines: [] };
    e.lines.push(l);
    out.set(key, e);
  }
  return out;
}
