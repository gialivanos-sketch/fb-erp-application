"use client";
// ----------------------------------------------------------------
// /import-orders — Εισαγωγή ιστορικού παραγγελιών από Excel (.xlsm/.xlsx)
//
//  1. Ο χρήστης επιλέγει το αρχείο → διαβάζεται τοπικά στον browser.
//  2. Προεπισκόπηση: συγκρίνεται με ό,τι υπάρχει ήδη στη βάση.
//     Τίποτα δεν γράφεται ακόμα.
//  3. «Εισαγωγή» → δημιουργούνται ΜΟΝΟ όσα λείπουν:
//       • προμηθευτές που δεν υπάρχουν (+ email όπου λείπει)
//       • παραγγελίες (κατάσταση «Παραδόθηκε») + είδη
//       • μία χρέωση ανά παραγγελία στην καρτέλα του προμηθευτή (με ΦΠΑ)
//
// Διπλοεγγραφές αποφεύγονται με:
//   • αριθμό παραγγελίας «XL-<ID Excel>» (ξανατρέχει με ασφάλεια)
//   • ίδιο προμηθευτή + ημερομηνία + σύνολο, ή ίδιο αρ. τιμολογίου,
//     για παραγγελίες που περάστηκαν ήδη από την εφαρμογή.
// ----------------------------------------------------------------
import { useState, useRef, useMemo } from "react";
import * as XLSX from "xlsx";
import { useLanguage } from "@/lib/context";
import { PageHeader, KpiCard, Badge } from "@/components/shared";
import * as db from "@/lib/supabaseData";
import { normKey } from "@/lib/itemAnalysis";
import {
  parseOrdersWorkbook, parseSkuGroups, supplierKey, buildImportPlan, buildReconciliation, type ReconRow, debitReference, debitNotes, type ImportPlan,
} from "@/lib/excelOrderImport";

const CHUNK = 50;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Λάθος δικτύου («Failed to fetch», 429/5xx χωρίς CORS) — αξίζει επανάληψη.
function isNetworkError(err: unknown): boolean {
  const m = errorText(err).toLowerCase();
  return m.includes("failed to fetch") || m.includes("networkerror") || m.includes("load failed")
    || m.includes("timeout") || m.includes("too many") || m.includes("rate limit") || m.includes("503") || m.includes("502");
}

// Επανάληψη με αυξανόμενη αναμονή (1, 2, 4, 8, 15 δευτ.) για λάθη δικτύου.
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  const waits = [1000, 2000, 4000, 8000, 15000];
  for (let attempt = 0; ; attempt++) {
    try { return await fn(); }
    catch (err) {
      if (!isNetworkError(err) || attempt >= waits.length) throw err;
      await sleep(waits[attempt]);
    }
  }
}

// Τα λάθη του Supabase είναι απλά objects ({ message, details, hint, code }),
// όχι Error — χωρίς αυτό εμφανίζονται ως «[object Object]».
function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object") {
    const e = err as { message?: string; details?: string; hint?: string; code?: string };
    const parts = [e.message, e.details, e.hint, e.code && `κωδ. ${e.code}`].filter(Boolean);
    if (parts.length) return parts.join(" — ");
    try { return JSON.stringify(err); } catch { /* ignore */ }
  }
  return String(err);
}
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export default function ImportOrdersPage() {
  const { locale, refreshAll } = useLanguage();
  const fileRef = useRef<HTMLInputElement>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [recon, setRecon] = useState<ReconRow[]>([]);
  // ομαδοποιήσεις SKU του Excel που λείπουν από την εφαρμογή
  const [skuMissing, setSkuMissing] = useState<{ productName: string; sku: string; finalGroup: string }[]>([]);
  const [fixDebits, setFixDebits] = useState(true);
  const [fixResult, setFixResult] = useState<{ fixed: number; debits: number; failed: string[] } | null>(null);
  const [result, setResult] = useState<{ orders: number; items: number; debits: number; suppliers: number; sku: number; failed: string[] } | null>(null);

  const fmt = (n: number) => "€" + n.toLocaleString("el-GR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const gr = locale === "gr";

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null); setPlan(null); setResult(null); setFixResult(null); setRecon([]); setSkuMissing([]); setLoading(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const parsed = parseOrdersWorkbook(wb);
      const [suppliers, orders, payments, itemStats, skuMap] = await Promise.all([db.fetchSuppliers(), db.fetchOrders(), db.fetchPayments(), db.fetchOrderItemStats(), db.fetchProductSkuMap()]);
      const haveSku = new Set(skuMap.map(e => normKey(e.productName)));
      const seen = new Set<string>();
      setSkuMissing(parseSkuGroups(wb).filter(g => {
        const k = normKey(g.productName);
        if (haveSku.has(k) || seen.has(k)) return false;
        seen.add(k); return true;
      }));
      const itemCounts = new Map([...itemStats].map(([k, v]) => [k, v.count]));
      const pl = buildImportPlan(file.name, parsed, suppliers, orders, payments, itemCounts);
      setPlan(pl);
      setRecon(buildReconciliation(pl, itemStats, payments));
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setLoading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const summary = useMemo(() => {
    if (!plan) return null;
    const net = r2(plan.newOrders.reduce((s, o) => s + o.totalNet, 0));
    const vat = r2(plan.newOrders.reduce((s, o) => s + o.totalVat, 0));
    const gross = r2(plan.newOrders.reduce((s, o) => s + o.totalGross, 0));
    const items = plan.newOrders.reduce((s, o) => s + o.items.length, 0);
    const bySupplier = new Map<string, { orders: number; net: number; vat: number; gross: number }>();
    for (const o of plan.newOrders) {
      const e = bySupplier.get(o.supplierName) ?? { orders: 0, net: 0, vat: 0, gross: 0 };
      e.orders++; e.net += o.totalNet; e.vat += o.totalVat; e.gross += o.totalGross;
      bySupplier.set(o.supplierName, e);
    }
    const rows = [...bySupplier.entries()].sort((a, b) => b[1].net - a[1].net);
    const imported = plan.skipped.filter(s => s.reason === "imported").length;
    const exists = plan.skipped.filter(s => s.reason === "exists");
    return { net, vat, gross, items, rows, imported, exists };
  }, [plan]);

  const reconSum = useMemo(() => {
    if (!plan) return null;
    const xlNet = r2(plan.newOrders.reduce((s, o) => s + o.totalNet, 0) + plan.skipped.reduce((s, x) => s + x.order.totalNet, 0));
    const appNet = r2(recon.reduce((s, r) => s + Number(r.app.totalNet || 0), 0));
    const xlMatchedNet = r2(recon.reduce((s, r) => s + r.order.totalNet, 0));
    const toFix = recon.filter(r => r.needsFix);
    const noDebit = recon.filter(r => !r.hasDebit);
    const appOnlyNet = r2(plan.appOnly.reduce((s, o) => s + Number(o.totalNet || 0), 0));
    return { xlNet, appNet, xlMatchedNet, diff: r2(appNet - xlMatchedNet), toFix, noDebit, appOnlyNet };
  }, [plan, recon]);

  async function runFix() {
    if (!plan || !reconSum || running) return;
    const nFix = reconSum.toFix.length, nDeb = fixDebits ? reconSum.noDebit.length : 0;
    if (!confirm(gr ? `Διόρθωση ${nFix} παραγγελιών ώστε να ταυτίζονται με το Excel${nDeb ? ` και προσθήκη ${nDeb} χρεώσεων` : ""};` : `Fix ${nFix} orders${nDeb ? ` and add ${nDeb} debits` : ""}?`)) return;
    setRunning(true); setProgress(0); setFixResult(null);
    const failed: string[] = [];
    let fixed = 0, debits = 0, consecutiveNet = 0;
    const total = nFix + nDeb;
    let done = 0;
    try {
      for (const r of reconSum.toFix) {
        const o = r.order;
        setStatus(gr ? `Διόρθωση ${r.app.orderNumber}…` : `Fixing ${r.app.orderNumber}…`);
        try {
          await withRetry(() => db.replaceOrderItemsDelete(r.app.id, r.appItemCount));
          await withRetry(() => db.bulkInsertOrderItems(o.items.map(it => ({
            orderId: r.app.id, productName: it.productName, quantity: it.quantity, unit: it.unit,
            basePrice: it.priceNet, vatPercent: it.vatPercent, netAmount: it.net, vatAmount: it.vat, grossAmount: it.gross,
          }))));
          await withRetry(() => db.updateOrderStatus(r.app.id, {
            ...(r.app.invoiceNumber ? {} : o.invoiceNumber ? { invoiceNumber: o.invoiceNumber } : {}),
            status: "delivered", totalNet: o.totalNet.toFixed(2), totalVat: o.totalVat.toFixed(2), totalGross: o.totalGross.toFixed(2),
          }));
          fixed++;
          consecutiveNet = 0;
        } catch (err) {
          failed.push(`${r.app.orderNumber} / ${o.orderNumber} (${o.orderDate}, ${o.supplierName}): ${errorText(err)}`);
          if (isNetworkError(err) && ++consecutiveNet >= 3) {
            failed.push(gr ? "⛔ Η σύνδεση με τη βάση χάθηκε — η διαδικασία σταμάτησε. Ξαναφόρτωσε το αρχείο και πάτα ξανά Διόρθωση· συνεχίζει από εκεί που έμεινε."
                           : "⛔ Connection to the database lost — stopped. Reload the file and run again; it resumes where it left off.");
            break;
          }
        }
        await sleep(120);
        setProgress(Math.round((++done / total) * 100));
      }
      if (fixDebits) {
        for (const r of reconSum.noDebit) {
          const o = r.order;
          try {
            await withRetry(() => db.bulkInsertDebits([{ supplierId: r.app.supplierId, transactionDate: o.orderDate, amount: o.totalGross, reference: debitReference(o), notes: debitNotes(o) }]));
            debits++;
          } catch (err) {
            failed.push(`${o.orderNumber} — χρέωση: ${errorText(err)}`);
          }
          setProgress(Math.round((++done / total) * 100));
        }
      }
      setStatus(gr ? "Ανανέωση δεδομένων…" : "Refreshing…");
      await refreshAll();
    } finally {
      setFixResult({ fixed, debits, failed });
      setStatus(""); setRunning(false); setPlan(null); setRecon([]);
    }
  }

  async function runImport() {
    if (!plan || running) return;
    if (!confirm(gr ? `Εισαγωγή ${plan.newOrders.length} παραγγελιών; ` : `Import ${plan.newOrders.length} orders?`)) return;
    setRunning(true); setProgress(0); setResult(null);
    const failed: string[] = [];
    let ordersDone = 0, itemsDone = 0, debitsDone = 0, suppliersDone = 0, skuDone = 0;
    try {
      const ids = new Map(plan.supplierIdByName);

      // 0. Ομαδοποιήσεις SKU που λείπουν (μόνο νέα προϊόντα — οι υπάρχουσες δεν αλλάζουν)
      if (skuMissing.length) {
        setStatus(gr ? "Ομαδοποίηση ειδών…" : "SKU groups…");
        try { await withRetry(() => db.bulkCreateProductSkuMapEntries(skuMissing)); skuDone = skuMissing.length; }
        catch (err) { failed.push((gr ? "Ομαδοποίηση SKU: " : "SKU groups: ") + errorText(err)); }
      }

      // 1. Προμηθευτές
      setStatus(gr ? "Προμηθευτές…" : "Suppliers…");
      for (const s of plan.newSuppliers) {
        const created = await db.createSupplier({ name: s.name, nameEn: null, contactEmail: s.email, contactPhone: null, address: null, category: null });
        ids.set(supplierKey(s.name), created.id);
        suppliersDone++;
      }
      for (const u of plan.emailUpdates) {
        await db.setSupplierEmail(u.supplier.id, u.email);
      }

      // 2. Χρεώσεις που έλειπαν από προηγούμενη εισαγωγή
      // 2α. Είδη που λείπουν από παραγγελίες προηγούμενης εισαγωγής
      for (const { order: o, orderId } of plan.missingItems) {
        try {
          await db.bulkInsertOrderItems(o.items.map(it => ({
            orderId, productName: it.productName, quantity: it.quantity, unit: it.unit,
            basePrice: it.priceNet, vatPercent: it.vatPercent, netAmount: it.net, vatAmount: it.vat, grossAmount: it.gross,
          })));
          itemsDone += o.items.length;
        } catch (err) {
          failed.push(`${o.orderNumber} (${o.orderDate}, ${o.supplierName}) — είδη: ${errorText(err)}`);
        }
      }

      for (const o of plan.missingDebits) {
        try {
          await db.bulkInsertDebits([{
            supplierId: ids.get(supplierKey(o.supplierName))!, transactionDate: o.orderDate,
            amount: o.totalGross, reference: debitReference(o), notes: debitNotes(o),
          }]);
          debitsDone++;
        } catch (err) {
          failed.push(`${o.orderNumber} (${o.orderDate}, ${o.supplierName}) — χρέωση: ${errorText(err)}`);
        }
      }

      // 3. Παραγγελίες ανά πακέτα — κάθε πακέτο: παραγγελίες → είδη → χρεώσεις.
      //    Αν αποτύχει κάτι, σβήνονται οι παραγγελίες του πακέτου (τα είδη
      //    φεύγουν μαζί), ώστε να μη μείνουν μισές εγγραφές.
      const total = plan.newOrders.length;
      // Εισάγει ένα σύνολο παραγγελιών (παραγγελίες → είδη → χρεώσεις).
      // Αν αποτύχει, σβήνει ό,τι πρόλαβε να γράψει και πετάει το λάθος.
      const importBatch = async (batch: typeof plan.newOrders) => {
        for (const o of batch) {
          if (ids.get(supplierKey(o.supplierName)) == null) throw new Error(`Δεν βρέθηκε προμηθευτής «${o.supplierName}»`);
        }
        let created = new Map<string, number>();
        try {
          created = await withRetry(() => db.bulkInsertOrders(batch.map(o => ({
            orderNumber: o.orderNumber, supplierId: ids.get(supplierKey(o.supplierName))!, orderDate: o.orderDate,
            invoiceNumber: o.invoiceNumber, notes: o.notes, totalNet: o.totalNet, totalVat: o.totalVat, totalGross: o.totalGross,
          }))));
          const items = batch.flatMap(o => o.items.map(it => ({
            orderId: created.get(o.orderNumber)!, productName: it.productName, quantity: it.quantity, unit: it.unit,
            basePrice: it.priceNet, vatPercent: it.vatPercent, netAmount: it.net, vatAmount: it.vat, grossAmount: it.gross,
          })));
          await withRetry(() => db.bulkInsertOrderItems(items));
          await withRetry(() => db.bulkInsertDebits(batch.map(o => ({
            supplierId: ids.get(supplierKey(o.supplierName))!, transactionDate: o.orderDate,
            amount: o.totalGross, reference: debitReference(o), notes: debitNotes(o),
          }))));
          ordersDone += batch.length; itemsDone += items.length; debitsDone += batch.length;
        } catch (err) {
          for (const id of created.values()) { try { await db.deleteOrder(id); } catch { /* ignore */ } }
          throw err;
        }
      };

      for (let i = 0; i < total; i += CHUNK) {
        const chunk = plan.newOrders.slice(i, i + CHUNK);
        setStatus(gr ? `Παραγγελίες ${i + 1}–${i + chunk.length} από ${total}…` : `Orders ${i + 1}–${i + chunk.length} of ${total}…`);
        try {
          await importBatch(chunk);
        } catch {
          // Το πακέτο απέτυχε → μία-μία, ώστε να περάσουν οι σωστές και
          // να φανεί ακριβώς ποια παραγγελία χαλάει και γιατί.
          for (const o of chunk) {
            try { await importBatch([o]); }
            catch (err) { failed.push(`${o.orderNumber} (${o.orderDate}, ${o.supplierName}, τιμ. ${o.invoiceNumber ?? "—"}): ${errorText(err)}`); }
          }
        }
        setProgress(Math.round(((i + chunk.length) / total) * 100));
      }
      if (total === 0) setProgress(100);
      setStatus(gr ? "Ανανέωση δεδομένων…" : "Refreshing…");
      await refreshAll();
    } catch (err) {
      failed.push(errorText(err));
    } finally {
      setResult({ orders: ordersDone, items: itemsDone, debits: debitsDone, suppliers: suppliersDone, sku: skuDone, failed });
      setSkuMissing([]);
      setStatus("");
      setRunning(false);
      setPlan(null);
    }
  }

  return (
    <div>
      <PageHeader title={gr ? "Εισαγωγή Παραγγελιών από Excel" : "Import Orders from Excel"} subtitle={gr ? "Ιστορικό παραγγελιών, είδη και χρεώσεις προμηθευτών" : "Order history, line items and supplier debits"} />

      <div className="erp-card mb-6">
        <div className="p-6 space-y-3">
          <p className="text-sm text-slate-600">
            {gr
              ? "Επίλεξε το αρχείο Excel (π.χ. ΠΑΡΑΓΓΕΛΙΕΣ 2026.xlsm). Διαβάζονται τα φύλλα «Ιστορικό Παραγγελιών», «Ιστορικό Στοιχείων Παραγγελίας» και «Προμηθευτές». Οι τιμές θεωρούνται χωρίς ΦΠΑ· ο ΦΠΑ (13% τρόφιμα, 24% αναλώσιμα) υπολογίζεται σε ξεχωριστή στήλη. Ό,τι υπάρχει ήδη αγνοείται."
              : "Choose the Excel file. Prices are treated as net; VAT (13% food, 24% consumables) is computed separately. Anything already in the app is skipped."}
          </p>
          <input ref={fileRef} type="file" accept=".xlsm,.xlsx" onChange={handleFile} disabled={loading || running} className="block text-sm" />
          {loading && <div className="text-sm text-slate-500">{gr ? "Ανάγνωση αρχείου και σύγκριση με τη βάση…" : "Reading file…"}</div>}
          {error && <div className="p-3 bg-red-50 border border-red-300 text-red-800 rounded-lg text-sm">⚠️ {error}</div>}
        </div>
      </div>

      {result && (
        <div className={`erp-card mb-6 p-6 ${result.failed.length ? "border-amber-300" : "border-emerald-300"}`}>
          <h3 className="font-semibold mb-2">{result.failed.length ? "⚠️" : "✅"} {gr ? "Η εισαγωγή ολοκληρώθηκε" : "Import finished"}</h3>
          <ul className="text-sm space-y-1">
            <li>{gr ? "Παραγγελίες" : "Orders"}: <b>{result.orders}</b></li>
            <li>{gr ? "Είδη" : "Line items"}: <b>{result.items}</b></li>
            <li>{gr ? "Χρεώσεις προμηθευτών" : "Supplier debits"}: <b>{result.debits}</b></li>
            <li>{gr ? "Νέοι προμηθευτές" : "New suppliers"}: <b>{result.suppliers}</b></li>
            {result.sku > 0 && <li>{gr ? "Ομαδοποιήσεις SKU" : "SKU groupings"}: <b>{result.sku}</b></li>}
          </ul>
          {result.failed.length > 0 && (
            <div className="mt-3 text-sm text-amber-800">
              {gr ? "Δεν πέρασαν (για αυτές δεν γράφτηκε τίποτα):" : "Failed (nothing written for these — run again):"}
              <ul className="list-disc ml-5">{result.failed.map((f, i) => <li key={i}>{f}</li>)}</ul>
            </div>
          )}
        </div>
      )}

      {fixResult && (
        <div className={`erp-card mb-6 p-6 ${fixResult.failed.length ? "border-amber-300" : "border-emerald-300"}`}>
          <h3 className="font-semibold mb-2">{fixResult.failed.length ? "⚠️" : "✅"} {gr ? "Η συμφωνία με το Excel ολοκληρώθηκε" : "Reconciliation finished"}</h3>
          <ul className="text-sm space-y-1">
            <li>{gr ? "Παραγγελίες που διορθώθηκαν" : "Orders fixed"}: <b>{fixResult.fixed}</b></li>
            <li>{gr ? "Χρεώσεις που προστέθηκαν" : "Debits added"}: <b>{fixResult.debits}</b></li>
          </ul>
          {fixResult.failed.length > 0 && (
            <div className="mt-3 text-sm text-amber-800">{gr ? "Δεν πέρασαν:" : "Failed:"}
              <ul className="list-disc ml-5">{fixResult.failed.map((f, i) => <li key={i}>{f}</li>)}</ul>
            </div>
          )}
        </div>
      )}

      {running && (
        <div className="erp-card mb-6 p-6">
          <div className="text-sm mb-2">{status}</div>
          <div className="w-full h-3 bg-slate-100 rounded"><div className="h-3 bg-blue-500 rounded transition-all" style={{ width: `${progress}%` }} /></div>
          <div className="text-xs text-slate-400 mt-1">{progress}%</div>
        </div>
      )}

      {plan && summary && !running && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <KpiCard label={gr ? "Νέες παραγγελίες" : "New orders"} value={plan.newOrders.length} color="blue" icon="📦" subtitle={`${summary.items} ${gr ? "είδη" : "items"}`} />
            <KpiCard label={gr ? "Σύνολο χωρίς ΦΠΑ" : "Net total"} value={fmt(summary.net)} color="green" icon="💶" />
            <KpiCard label={gr ? "ΦΠΑ" : "VAT"} value={fmt(summary.vat)} color="amber" icon="🧾" />
            <KpiCard label={gr ? "Σύνολο με ΦΠΑ" : "Gross total"} value={fmt(summary.gross)} color="purple" icon="💰" />
          </div>

          <div className="erp-card mb-6 p-6 space-y-2 text-sm">
            <div>📄 {plan.fileName}</div>
            <div>⏭️ {gr ? "Ήδη εισηγμένες από Excel (παραλείπονται)" : "Already imported (skipped)"}: <b>{summary.imported}</b></div>
            <div>⏭️ {gr ? "Υπάρχουν ήδη στην εφαρμογή (ίδιος προμηθευτής/ημερομηνία/σύνολο ή τιμολόγιο)" : "Already in app"}: <b>{summary.exists.length}</b>
              {summary.exists.length > 0 && (
                <details className="mt-1 ml-5 text-xs text-slate-500"><summary className="cursor-pointer">{gr ? "Προβολή" : "Show"}</summary>
                  {summary.exists.map(s => <div key={s.order.orderNumber}>{s.order.orderNumber} ({s.order.orderDate}, {s.order.supplierName}, {fmt(s.order.totalNet)}) → {s.match}</div>)}
                </details>
              )}
            </div>
            {plan.missingItems.length > 0 && <div>🧩 {gr ? "Παραγγελίες προηγούμενης εισαγωγής χωρίς είδη (θα συμπληρωθούν)" : "Imported orders missing items"}: <b>{plan.missingItems.length}</b></div>}
            {plan.missingDebits.length > 0 && <div>➕ {gr ? "Χρεώσεις που λείπουν από προηγούμενη εισαγωγή" : "Missing debits"}: <b>{plan.missingDebits.length}</b></div>}
            <div>🏢 {gr ? "Νέοι προμηθευτές" : "New suppliers"}: <b>{plan.newSuppliers.length}</b>
              {plan.newSuppliers.length > 0 && <span className="text-slate-500"> — {plan.newSuppliers.map(s => s.name).join(", ")}</span>}
            </div>
            {skuMissing.length > 0 && <div>🏷️ {gr ? "Ομαδοποιήσεις ειδών (SKU) από το Excel που λείπουν" : "Missing SKU groupings"}: <b>{skuMissing.length}</b> <span className="text-slate-500">({gr ? "οι υπάρχουσες δεν αλλάζουν" : "existing ones untouched"})</span></div>}
            {plan.nameMatches.length > 0 && (
              <div>🔗 {gr ? "Αντιστοίχιση με υπάρχοντες προμηθευτές (διαφορετική γραφή)" : "Matched to existing suppliers"}:
                <ul className="ml-5 text-slate-600">{plan.nameMatches.map(m => <li key={m.excelName}>{m.excelName} → <b>{m.appName}</b></li>)}</ul>
              </div>
            )}
            {plan.emailUpdates.length > 0 && <div>✉️ {gr ? "Συμπλήρωση email" : "Email updates"}: <b>{plan.emailUpdates.length}</b> <span className="text-slate-500">— {plan.emailUpdates.map(u => u.supplier.name).join(", ")}</span></div>}
            {plan.warnings.length > 0 && (
              <details className="text-amber-700"><summary className="cursor-pointer">⚠️ {plan.warnings.length} {gr ? "προειδοποιήσεις" : "warnings"}</summary>
                <ul className="list-disc ml-5 text-xs">{plan.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
              </details>
            )}
          </div>

          {summary.rows.length > 0 && (
            <div className="erp-card mb-6">
              <div className="erp-card-header"><h3 className="font-semibold">🏢 {gr ? "Ανά προμηθευτή (νέες παραγγελίες)" : "By supplier (new orders)"}</h3></div>
              <div className="overflow-x-auto">
                <table className="erp-table">
                  <thead><tr>
                    <th>{gr ? "Προμηθευτής" : "Supplier"}</th><th>{gr ? "Παραγγελίες" : "Orders"}</th>
                    <th className="text-right">{gr ? "Σύνολο χωρίς ΦΠΑ" : "Net"}</th><th className="text-right">{gr ? "ΦΠΑ" : "VAT"}</th><th className="text-right">{gr ? "Σύνολο με ΦΠΑ" : "Gross"}</th>
                  </tr></thead>
                  <tbody>
                    {summary.rows.map(([name, r]) => (
                      <tr key={name}>
                        <td className="font-medium">{name} {plan.newSuppliers.some(s => s.name === name) && <Badge color="blue">{gr ? "νέος" : "new"}</Badge>}</td>
                        <td>{r.orders}</td>
                        <td className="text-right">{fmt(r.net)}</td><td className="text-right">{fmt(r.vat)}</td><td className="text-right font-semibold">{fmt(r.gross)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr className="bg-slate-50 font-bold">
                    <td>{gr ? "Σύνολο" : "Total"}</td><td>{plan.newOrders.length}</td>
                    <td className="text-right">{fmt(summary.net)}</td><td className="text-right">{fmt(summary.vat)}</td><td className="text-right">{fmt(summary.gross)}</td>
                  </tr></tfoot>
                </table>
              </div>
            </div>
          )}

          {reconSum && recon.length > 0 && (
            <div className="erp-card mb-6">
              <div className="erp-card-header"><h3 className="font-semibold">⚖️ {gr ? "Συμφωνία με Excel (παραγγελίες που υπάρχουν ήδη)" : "Reconciliation with Excel"}</h3></div>
              <div className="p-6 space-y-2 text-sm">
                <div>{gr ? "Σύνολο χωρίς ΦΠΑ στο Excel (όλες οι παραγγελίες)" : "Excel net total"}: <b>{fmt(reconSum.xlNet)}</b></div>
                <div>{gr ? `Για τις ${recon.length} παραγγελίες που υπάρχουν ήδη — Excel` : "Existing orders — Excel"}: <b>{fmt(reconSum.xlMatchedNet)}</b> · {gr ? "Εφαρμογή" : "App"}: <b>{fmt(reconSum.appNet)}</b> · {gr ? "Διαφορά" : "Diff"}: <b className={Math.abs(reconSum.diff) > 0.05 ? "text-red-600" : "text-emerald-600"}>{fmt(reconSum.diff)}</b></div>
                <div>🔧 {gr ? "Παραγγελίες με διαφορετικά ποσά ή είδη από το Excel" : "Orders differing from Excel"}: <b>{reconSum.toFix.length}</b></div>
                <div>💳 {gr ? "Παραγγελίες χωρίς χρέωση στην καρτέλα προμηθευτή" : "Orders without supplier debit"}: <b>{reconSum.noDebit.length}</b></div>
                {plan.appOnly.length > 0 && (
                  <div>ℹ️ {gr ? "Παραγγελίες της εφαρμογής στην ίδια περίοδο που ΔΕΝ υπάρχουν στο Excel" : "App-only orders in period"}: <b>{plan.appOnly.length}</b> ({fmt(reconSum.appOnlyNet)} {gr ? "χωρίς ΦΠΑ" : "net"}) — {gr ? "δεν αγγίζονται" : "untouched"}
                    <details className="ml-5 text-xs text-slate-500"><summary className="cursor-pointer">{gr ? "Προβολή" : "Show"}</summary>
                      {plan.appOnly.map(o => <div key={o.id}>{o.orderNumber} · {o.orderDate} · {o.supplierName} · {fmt(Number(o.totalNet || 0))} · {o.status}</div>)}
                    </details>
                  </div>
                )}
                {reconSum.toFix.length > 0 && (
                  <details><summary className="cursor-pointer text-slate-600">{gr ? "Λίστα διαφορών" : "Differences"}</summary>
                    <div className="overflow-x-auto mt-2">
                      <table className="erp-table text-xs">
                        <thead><tr>
                          <th>Excel</th><th>{gr ? "Εφαρμογή" : "App"}</th><th>{gr ? "Ημ/νία" : "Date"}</th><th>{gr ? "Προμηθευτής" : "Supplier"}</th>
                          <th className="text-right">{gr ? "Καθαρή Excel" : "Excel net"}</th><th className="text-right">{gr ? "Καθαρή εφαρμ." : "App net"}</th>
                          <th className="text-right">{gr ? "Με ΦΠΑ εφαρμ." : "App gross"}</th><th className="text-right">{gr ? "Είδη Excel/εφαρμ." : "Items"}</th>
                        </tr></thead>
                        <tbody>{reconSum.toFix.map(r => (
                          <tr key={r.order.orderNumber}>
                            <td>{r.order.orderNumber}</td><td>{r.app.orderNumber}</td><td>{r.order.orderDate}</td><td>{r.order.supplierName}</td>
                            <td className="text-right">{fmt(r.order.totalNet)}</td><td className="text-right">{fmt(Number(r.app.totalNet || 0))}</td>
                            <td className="text-right">{fmt(Number(r.app.totalGross || 0))}</td><td className="text-right">{r.order.items.length}/{r.appItemCount}</td>
                          </tr>))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                )}
                {(reconSum.toFix.length > 0 || reconSum.noDebit.length > 0) && (
                  <div className="pt-3 border-t space-y-2">
                    {reconSum.noDebit.length > 0 && (
                      <label className="flex items-center gap-2"><input type="checkbox" checked={fixDebits} onChange={e => setFixDebits(e.target.checked)} />
                        {gr ? `Πρόσθεσε και χρέωση (με ΦΠΑ) στις ${reconSum.noDebit.length} παραγγελίες χωρίς χρέωση` : "Also add missing debits"}</label>
                    )}
                    <button onClick={runFix} className="erp-btn-warning">🔧 {gr ? "Διόρθωση ώστε να ταυτίζεται με το Excel" : "Fix to match Excel"}</button>
                    <p className="text-xs text-slate-500">{gr ? "Στις παραγγελίες με διαφορές αντικαθίστανται τα είδη και τα σύνολα με αυτά του Excel (χωρίς ΦΠΑ + ΦΠΑ). Ο αριθμός παραγγελίας της εφαρμογής κρατιέται." : "Items and totals are replaced with Excel values."}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <button onClick={runImport} disabled={plan.newOrders.length === 0 && plan.newSuppliers.length === 0 && plan.emailUpdates.length === 0 && plan.missingDebits.length === 0 && plan.missingItems.length === 0 && skuMissing.length === 0} className="erp-btn-primary">
              📥 {gr ? "Εισαγωγή" : "Import"}
            </button>
            <button onClick={() => setPlan(null)} className="erp-btn-ghost">{gr ? "Ακύρωση" : "Cancel"}</button>
          </div>
        </>
      )}
    </div>
  );
}
