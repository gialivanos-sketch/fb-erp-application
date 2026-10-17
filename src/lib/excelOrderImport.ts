// ----------------------------------------------------------------
// Ανάγνωση ιστορικού παραγγελιών από το Excel «ΠΑΡΑΓΓΕΛΙΕΣ 2026.xlsm».
//
// Φύλλα που διαβάζονται:
//   • «Ιστορικό Παραγγελιών»           → κεφαλίδες παραγγελιών
//   • «Ιστορικό Στοιχείων Παραγγελίας» → γραμμές (είδη) παραγγελιών
//   • «Προμηθευτές»                    → email προμηθευτών
//
// Οι τιμές/σύνολα του Excel είναι ΧΩΡΙΣ ΦΠΑ. Ο ΦΠΑ υπολογίζεται εδώ
// ανά γραμμή (13% τρόφιμα, 24% αναλώσιμα/καθαριστικά) και κρατιέται
// σε ξεχωριστές στήλες: καθαρή αξία / ΦΠΑ / σύνολο με ΦΠΑ.
//
// Καθαρή συνάρτηση χωρίς πρόσβαση σε βάση — παίρνει το workbook που
// έχει ήδη διαβαστεί με SheetJS και επιστρέφει δομημένα δεδομένα.
// ----------------------------------------------------------------
import type { WorkBook, WorkSheet } from "xlsx";
import { utils } from "xlsx";
import type { Supplier, Order, SupplierPayment } from "./types";

export const SHEET_ORDERS = "Ιστορικό Παραγγελιών";
export const SHEET_ITEMS = "Ιστορικό Στοιχείων Παραγγελίας";
export const SHEET_SUPPLIERS = "Προμηθευτές";

export interface ParsedItem {
  excelOrderId: number;
  productName: string;
  quantity: number;
  unit: string;
  priceNet: number;     // τιμή μονάδας χωρίς ΦΠΑ
  priceGross: number;   // τιμή μονάδας με ΦΠΑ
  vatPercent: number;
  net: number;
  vat: number;
  gross: number;
}

export interface ParsedOrder {
  excelOrderId: number;
  orderNumber: string;  // "XL-<id>"
  orderDate: string;    // YYYY-MM-DD
  supplierName: string;
  invoiceNumber: string | null;
  notes: string | null;
  totalNet: number;
  totalVat: number;
  totalGross: number;
  items: ParsedItem[];
}

export interface ParsedSupplier {
  name: string;
  email: string | null;
}

export interface ParsedWorkbook {
  orders: ParsedOrder[];
  suppliers: ParsedSupplier[];
  warnings: string[];
}

// Προμηθευτές που πουλάνε μόνο αναλώσιμα/καθαριστικά → 24% σε όλα.
const SUPPLIERS_24 = ["ΠΑΤΡΙΝΟΥ", "ΚΛΑΥΔΙΑΝΟΣ"];
// Μη-τρόφιμα από άλλους προμηθευτές → 24%.
const KEYWORDS_24 = [
  "KITCHEN PAPER", "CONTAINER", "ΤΣΑΝΤΑ", "ΓΑΝΤΙ", "ΣΑΚΟΥΛ", "ΣΚΟΥΠΙΔΟΣΑΚ",
  "ΑΛΟΥΜΙΝΟΧΑΡΤ", "ΜΕΜΒΡΑΝ", "ΛΑΔΟΧΑΡΤ", "ΥΓΡΟ ΠΙΑΤ", "ΧΛΩΡΙΝ", "ΑΠΟΛΥΜΑΝΤ",
  "ΧΑΡΤΙ ΥΓΕΙ", "ΧΑΡΤΙ ΚΟΥΖ", "ΧΑΡΤΟΠΕΤΣ", "ΚΑΘΑΡΙΣΤ", "ΑΠΟΡΡΥΠ",
];

export const VAT_FOOD = 13;
export const VAT_OTHER = 24;

export function normalizeName(s: string): string {
  return String(s ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toUpperCase().replace(/\s+/g, " ").trim();
}

export function vatRateFor(supplierName: string, productName: string): number {
  const sup = normalizeName(supplierName);
  if (SUPPLIERS_24.includes(sup)) return VAT_OTHER;
  const p = normalizeName(productName);
  return KEYWORDS_24.some(k => p.includes(normalizeName(k))) ? VAT_OTHER : VAT_FOOD;
}

// Ενοποίηση των ~36 παραλλαγών μονάδας του Excel.
export function normalizeUnit(raw: unknown): string {
  const u = normalizeName(String(raw ?? "")).replace(/\./g, "").replace(/K/g, "Κ").replace(/I/g, "Ι");
  if (!u || /^\d+$/.test(u)) return "ΤΕΜ";
  if (/^(ΚΙΛ|ΚG|KG|ΚΙΛΟ|ΚΙΛΑ|ΚΙΛΟΥ)/.test(u) || u === "ΚG") return "ΚΙΛΟ";
  if (/^(ΤΕΜ|TEM|ΤΜΧ|TMX)/.test(u)) return "ΤΕΜ";
  if (/^ΚΙΒ/.test(u)) return "ΚΙΒ";
  if (/^ΚΑΡΤ/.test(u)) return "ΚΑΡΤΕΛΑ";
  if (/^ΚΟΥΤ/.test(u)) return "ΚΟΥΤΙ";
  if (/^ΠΑΚ/.test(u)) return "ΠΑΚ";
  if (/^ΜΑΤΣ/.test(u)) return "ΜΑΤΣΟ";
  return u;
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const r4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;

function toNumber(v: unknown): number | null {
  if (typeof v === "number" && isFinite(v)) return v;
  if (v == null) return null;
  const s = String(v).replace(/€/g, "").replace(/\s/g, "").replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return isFinite(n) ? n : null;
}

// Excel serial ή Date → YYYY-MM-DD (UTC, χωρίς μετατόπιση ζώνης ώρας).
function toIsoDate(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") {
    const d = new Date(Math.round((v - 25569) * 86400000));
    return d.toISOString().slice(0, 10);
  }
  if (v instanceof Date) {
    return new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate())).toISOString().slice(0, 10);
  }
  const m = String(v).match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const iso = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? iso[0] : null;
}

function cleanText(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

// Διαβάζει πίνακα που ξεκινά από τη γραμμή κεφαλίδων που περιέχει το `marker`.
function readTable(ws: WorkSheet, marker: string): Record<string, unknown>[] {
  const rows = utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null, blankrows: false });
  const headerIdx = rows.findIndex(r => Array.isArray(r) && r.some(c => String(c ?? "").trim() === marker));
  if (headerIdx < 0) throw new Error(`Δεν βρέθηκε η στήλη «${marker}»`);
  const header = (rows[headerIdx] as unknown[]).map(c => String(c ?? "").trim());
  const out: Record<string, unknown>[] = [];
  for (const r of rows.slice(headerIdx + 1)) {
    if (!Array.isArray(r)) continue;
    const obj: Record<string, unknown> = {};
    header.forEach((h, i) => { if (h) obj[h] = r[i]; });
    out.push(obj);
  }
  return out;
}

export function parseOrdersWorkbook(wb: WorkBook): ParsedWorkbook {
  const warnings: string[] = [];
  const wsOrders = wb.Sheets[SHEET_ORDERS];
  const wsItems = wb.Sheets[SHEET_ITEMS];
  if (!wsOrders) throw new Error(`Λείπει το φύλλο «${SHEET_ORDERS}»`);
  if (!wsItems) throw new Error(`Λείπει το φύλλο «${SHEET_ITEMS}»`);

  // ── Γραμμές ──
  const itemsByOrder = new Map<number, ParsedItem[]>();
  let lineNo = 0;
  for (const row of readTable(wsItems, "ID Παραγγελίας")) {
    lineNo++;
    const id = toNumber(row["ID Παραγγελίας"]);
    const product = cleanText(row["Προϊόν"]);
    if (id == null || !product) continue;
    const qty = toNumber(row["Ποσότητα"]) ?? 0;
    let net = toNumber(row["Σύνολο"]);
    let price = toNumber(row["Τιμή"]);
    if (net == null && price != null) net = price * qty;
    if (net == null) { warnings.push(`Γραμμή ${lineNo} (${product}): χωρίς σύνολο — παραλείφθηκε`); continue; }
    if (price == null) price = qty ? net / qty : 0;
    const supplier = cleanText(row["Προμηθευτής"]) ?? "";
    const vatPercent = vatRateFor(supplier, product);
    const netR = r2(net);
    const vat = r2(netR * vatPercent / 100);
    const item: ParsedItem = {
      excelOrderId: id,
      productName: product,
      quantity: qty,
      unit: normalizeUnit(row["Μονάδα"]),
      priceNet: r4(price),
      priceGross: r4(price * (1 + vatPercent / 100)),
      vatPercent,
      net: netR,
      vat,
      gross: r2(netR + vat),
    };
    const list = itemsByOrder.get(id) ?? [];
    list.push(item);
    itemsByOrder.set(id, list);
  }

  // ── Παραγγελίες ──
  const orders: ParsedOrder[] = [];
  for (const row of readTable(wsOrders, "ID Παραγγελίας")) {
    const id = toNumber(row["ID Παραγγελίας"]);
    if (id == null) continue;
    const supplierName = cleanText(row["Προμηθευτής"]);
    const orderDate = toIsoDate(row["Ημερομηνία"]);
    if (!supplierName || !orderDate) { warnings.push(`Παραγγελία ${id}: χωρίς προμηθευτή ή ημερομηνία — παραλείφθηκε`); continue; }
    const items = itemsByOrder.get(id) ?? [];
    const headerNet = toNumber(row["Σύνολο"]);
    const itemsNet = r2(items.reduce((s, i) => s + i.net, 0));
    if (items.length === 0) warnings.push(`Παραγγελία ${id}: χωρίς είδη`);
    else if (headerNet != null && Math.abs(headerNet - itemsNet) > 0.05) {
      warnings.push(`Παραγγελία ${id}: σύνολο κεφαλίδας ${headerNet.toFixed(2)} ≠ άθροισμα ειδών ${itemsNet.toFixed(2)}`);
    }
    // Το σύνολο της κεφαλίδας είναι αυτό του τιμολογίου — το κρατάμε
    // ακριβώς, ώστε τα σύνολα προμηθευτών να ταυτίζονται με το Excel.
    const totalNet = headerNet != null ? r2(headerNet) : itemsNet;
    const totalVat = r2(items.reduce((s, i) => s + i.vat, 0));
    const inv = row["Αριθμός Τιμολογίου"];
    orders.push({
      excelOrderId: id,
      orderNumber: `XL-${id}`,
      orderDate,
      supplierName,
      invoiceNumber: inv == null || String(inv).trim() === "" ? null : String(inv).trim(),
      notes: cleanText(row["Σημειώσεις"]),
      totalNet,
      totalVat,
      totalGross: r2(totalNet + totalVat),
      items,
    });
    itemsByOrder.delete(id);
  }
  for (const [id, list] of itemsByOrder) {
    warnings.push(`${list.length} γραμμές με ID ${id} χωρίς αντίστοιχη παραγγελία — παραλείφθηκαν`);
  }

  // ── Προμηθευτές (email) ──
  const suppliers: ParsedSupplier[] = [];
  const wsSup = wb.Sheets[SHEET_SUPPLIERS];
  if (wsSup) {
    try {
      for (const row of readTable(wsSup, "Προμηθευτής")) {
        const name = cleanText(row["Προμηθευτής"]);
        if (!name) continue;
        suppliers.push({ name, email: cleanText(row["Στοιχεία Επικοινωνίας"]) });
      }
    } catch { /* φύλλο σε άλλη μορφή — αγνοείται */ }
  }
  // Προμηθευτές που εμφανίζονται μόνο στις παραγγελίες
  const known = new Set(suppliers.map(s => normalizeName(s.name)));
  for (const o of orders) {
    const k = normalizeName(o.supplierName);
    if (!known.has(k)) { known.add(k); suppliers.push({ name: o.supplierName, email: null }); }
  }

  orders.sort((a, b) => a.orderDate.localeCompare(b.orderDate) || a.excelOrderId - b.excelOrderId);
  return { orders, suppliers, warnings };
}

// ─── Σχέδιο εισαγωγής: τι είναι νέο και τι υπάρχει ήδη ─────────────────────

export type SkipReason = "imported" | "exists";

export interface ImportPlan {
  fileName: string;
  newOrders: ParsedOrder[];
  skipped: { order: ParsedOrder; reason: SkipReason; match?: string }[];
  newSuppliers: ParsedSupplier[];
  emailUpdates: { supplier: Supplier; email: string }[];
  // χρεώσεις που λείπουν για παραγγελίες XL- που υπάρχουν ήδη (π.χ. μισή προηγούμενη εισαγωγή)
  missingDebits: ParsedOrder[];
  supplierIdByName: Map<string, number>;
  warnings: string[];
}

const xlRef = (ref: string | null | undefined) => ref?.match(/^XL-(\d+)\b/)?.[1] ?? null;

export function debitReference(o: ParsedOrder) {
  return o.invoiceNumber ? `${o.orderNumber} · ΤΙΜ ${o.invoiceNumber}` : o.orderNumber;
}
export function debitNotes(o: ParsedOrder) {
  return `Παραγγελία ${o.orderNumber} — Καθαρή ${o.totalNet.toFixed(2)} € + ΦΠΑ ${o.totalVat.toFixed(2)} €`;
}

export function buildImportPlan(
  fileName: string,
  parsed: ParsedWorkbook,
  suppliers: Supplier[],
  orders: Order[],
  payments: SupplierPayment[],
): ImportPlan {
  const supByName = new Map<string, Supplier>();
  for (const s of suppliers) supByName.set(normalizeName(s.name), s);

  const newSuppliers: ParsedSupplier[] = [];
  const emailUpdates: { supplier: Supplier; email: string }[] = [];
  for (const ps of parsed.suppliers) {
    const ex = supByName.get(normalizeName(ps.name));
    if (!ex) newSuppliers.push(ps);
    else if (ps.email && !ex.contactEmail) emailUpdates.push({ supplier: ex, email: ps.email });
  }

  const byNumber = new Set(orders.map(o => o.orderNumber));
  const debitRefs = new Set(payments.filter(p => p.type === "debit").map(p => xlRef(p.reference)).filter(Boolean) as string[]);

  const newOrders: ParsedOrder[] = [];
  const skipped: ImportPlan["skipped"] = [];
  const missingDebits: ParsedOrder[] = [];

  for (const o of parsed.orders) {
    if (byNumber.has(o.orderNumber)) {
      skipped.push({ order: o, reason: "imported" });
      if (!debitRefs.has(String(o.excelOrderId))) missingDebits.push(o);
      continue;
    }
    const sup = supByName.get(normalizeName(o.supplierName));
    if (sup) {
      const match = orders.find(x => {
        if (x.supplierId !== sup.id) return false;
        if (o.invoiceNumber && x.invoiceNumber && x.invoiceNumber.trim() === o.invoiceNumber) return true;
        if (x.orderDate !== o.orderDate) return false;
        const net = Number(x.totalNet), gross = Number(x.totalGross);
        return Math.abs(net - o.totalNet) < 0.02 || Math.abs(gross - o.totalNet) < 0.02 || Math.abs(gross - o.totalGross) < 0.02;
      });
      if (match) { skipped.push({ order: o, reason: "exists", match: match.orderNumber }); continue; }
    }
    newOrders.push(o);
  }

  const supplierIdByName = new Map<string, number>();
  for (const [k, s] of supByName) supplierIdByName.set(k, s.id);

  return { fileName, newOrders, skipped, newSuppliers, emailUpdates, missingDebits, supplierIdByName, warnings: parsed.warnings };
}

