"use client";
// ----------------------------------------------------------------
// «Τιμές από αγορές» — μπαίνει στη σελίδα Κοστολόγηση Συνταγής.
//
//  • Υπολογίζει την τιμή κάθε υλικού συνταγής από τις αγορές της ενεργής
//    επιχείρησης: μέση σταθμισμένη τιμή 90 ημερών, ΧΩΡΙΣ ΦΠΑ.
//  • Υλικά χωρίς ομάδα SKU → προτεινόμενη ομάδα, επιβεβαίωση/αλλαγή.
//  • Ομάδες που αγοράζονται σε ΤΕΜ/ΚΙΒ κ.λπ. → «1 ΤΕΜ = Χ γρ.» μία φορά.
//  • «Ενημέρωση τιμών» → γράφει τιμές υλικών + κόστος κάθε συνταγής.
// ----------------------------------------------------------------
import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/lib/context";
import * as db from "@/lib/supabaseData";
import { buildSkuLookup, groupLines, normKey, type PurchaseLine } from "@/lib/itemAnalysis";
import {
  buildGroupPrices, priceIngredient, suggestGroups, recipeTotals, PRICE_WINDOW_DAYS, suggestPackGrams, purchaseUnitKey, isPiecesKey,
  type GroupCandidate, type IngredientPrice, type ScoredCandidate,
} from "@/lib/recipePricing";

const eur = (n: number, d = 2) => "€" + n.toLocaleString("el-GR", { minimumFractionDigits: d, maximumFractionDigits: d });
const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const UNIT_HINT: Record<string, string> = {
  ΤΕΜ: "π.χ. τενεκές 5L = 5000, συσκευασία 2,5 κιλ. = 2500, 30άδα αυγά = 1800",
  ΚΙΒ: "π.χ. κιβώτιο 6 × 1L = 6000",
  ΚΟΥΤΙ: "βάρος/όγκος περιεχομένου σε γρ./ml",
  ΠΑΚ: "βάρος/όγκος περιεχομένου σε γρ./ml",
  ΚΑΡΤΕΛΑ: "βάρος/όγκος περιεχομένου σε γρ./ml",
  ΜΑΤΣΟ: "π.χ. 1 μάτσο μαϊντανός ≈ 50",
  ΤΕΜΑΧΙΟ: "βάρος ενός τεμαχίου στη συνταγή, π.χ. 1 αυγό = 60, 1 λεμόνι = 120",
};

export default function RecipePricingPanel() {
  const { locale, data, refreshAll } = useApp();
  const gr = locale === "gr";

  const [skuMap, setSkuMap] = useState<db.ProductSkuMapEntry[] | null>(null);
  const [convs, setConvs] = useState<db.SkuConversion[] | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"link" | "conv" | "other">("link");
  const [choice, setChoice] = useState<Record<string, string>>({});   // υλικό → "SKU|ομάδα"
  const [gramsIn, setGramsIn] = useState<Record<string, string>>({});  // "sku|unit" → γρ.
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [linkFilter, setLinkFilter] = useState("");
  const [tier, setTier] = useState<"high" | "medium" | "none">("high");

  async function reload() {
    const [m, c] = await Promise.all([db.fetchProductSkuMap(), db.fetchSkuConversions()]);
    setSkuMap(m); setConvs(c);
  }
  useEffect(() => {
    let alive = true;
    Promise.all([db.fetchProductSkuMap(), db.fetchSkuConversions()])
      .then(([m, c]) => { if (alive) { setSkuMap(m); setConvs(c); } })
      .catch(() => { if (alive) { setSkuMap([]); setConvs(null); } });
    return () => { alive = false; };
  }, []);

  const lookup = useMemo(() => buildSkuLookup(skuMap ?? []), [skuMap]);
  const conversions = useMemo(() => convs ?? [], [convs]);

  const purchases = useMemo(() => data.orderItems.filter(i => i?.orderDate).map(i => ({
    date: i.orderDate!, product: i.productName,
    qty: Number(i.deliveredQuantity ?? i.orderedQuantity ?? 0) || Number(i.orderedQuantity ?? 0),
    unit: i.unit ?? "", net: Number(i.netAmount ?? 0),
  })), [data.orderItems]);

  const prices = useMemo(() => buildGroupPrices(purchases, lookup, conversions), [purchases, lookup, conversions]);

  // Υποψήφιες ομάδες για προτάσεις / λίστα επιλογής (μόνο ομάδες με αγορές)
  const candidates = useMemo<GroupCandidate[]>(() => {
    const lines: PurchaseLine[] = purchases.map((p, k) => ({ id: k, date: p.date, orderNumber: "", supplier: "", product: p.product, qty: p.qty, unit: p.unit, price: 0, vatPercent: 0, net: p.net, gross: 0 }));
    return [...groupLines(lines, lookup, "group").entries()]
      .filter(([, g]) => g.sku)
      .map(([key, g]) => ({ key, label: g.label, sku: g.sku, text: g.label + " " + [...new Set(g.lines.map(l => l.product))].join(" "), weight: g.lines.reduce((s, l) => s + l.net, 0) }))
      .sort((a, b) => a.label.localeCompare(b.label, "el"));
  }, [purchases, lookup]);
  const optionValue = (c: { sku: string | null; label: string }) => `${c.sku} — ${c.label}`;
  const byOption = useMemo(() => new Map(candidates.map(c => [optionValue(c), c])), [candidates]);

  // Τιμολόγηση όλων των υλικών όλων των συνταγών
  const analysis = useMemo(() => {
    if (!skuMap) return null;
    type Row = { recipeId: number; ingId: number; name: string; qty: number; unit: string; old: number; p: IngredientPrice };
    const rows: Row[] = [];
    for (const r of data.recipes) for (const ing of r.ingredients ?? []) {
      if (!ing.id) continue;
      rows.push({ recipeId: r.id, ingId: ing.id, name: ing.ingredientName, qty: Number(ing.quantity) || 0, unit: ing.unit, old: Number(ing.unitCost) || 0,
        p: priceIngredient(ing.ingredientName, ing.unit, lookup, prices, conversions) });
    }
    const unlinked = new Map<string, { name: string; uses: number }>();
    const needConv = new Map<string, { sku: string; label: string; unit: string; examples: Set<string> }>();
    const noPurch = new Map<string, number>(), badUnit = new Map<string, number>();
    for (const r of rows) {
      const k = normKey(r.name);
      if (r.p.status === "no_group") { const e = unlinked.get(k) ?? { name: r.name.trim(), uses: 0 }; e.uses++; unlinked.set(k, e); }
      else if (r.p.status === "needs_conversion" && r.p.sku) {
        const key = `${r.p.sku}|${r.p.needUnit}`;
        const e = needConv.get(key) ?? { sku: r.p.sku, label: r.p.groupLabel ?? "", unit: r.p.needUnit ?? "ΤΕΜ", examples: new Set<string>() };
        e.examples.add(r.name.trim()); needConv.set(key, e);
      }
      else if (r.p.status === "no_purchases") noPurch.set(r.name.trim(), (noPurch.get(r.name.trim()) ?? 0) + 1);
      else if (r.p.status === "unknown_unit") badUnit.set(`${r.name.trim()} (${r.unit})`, (badUnit.get(`${r.name.trim()} (${r.unit})`) ?? 0) + 1);
    }
    const ok = rows.filter(r => r.p.status === "ok").length;
    const okIds = new Set(rows.filter(r => r.p.status === "ok").map(r => r.ingId));
    const recipesFull = data.recipes.filter(r => (r.ingredients ?? []).length > 0 &&
      (r.ingredients ?? []).every(i => i.id != null && okIds.has(i.id))).length;
    return {
      rows, ok, recipesFull,
      unlinked: [...unlinked.values()].sort((a, b) => b.uses - a.uses),
      needConv: [...needConv.values()].sort((a, b) => b.examples.size - a.examples.size),
      noPurch: [...noPurch.entries()].sort((a, b) => b[1] - a[1]),
      badUnit: [...badUnit.entries()].sort((a, b) => b[1] - a[1]),
    };
  }, [data.recipes, lookup, prices, conversions, skuMap]);

  // Προτάσεις βάρους συσκευασίας από τα ονόματα των προϊόντων της ομάδας
  const packSuggest = useMemo(() => {
    const prodBy = new Map<string, Map<string, number>>();   // "sku|unit" → προϊόν → ποσότητα
    for (const p of purchases) {
      const sku = lookup.get(normKey(p.product))?.sku;
      if (!sku) continue;
      const k = `${sku}|${purchaseUnitKey(p.unit)}`;
      const m = prodBy.get(k) ?? new Map<string, number>();
      m.set(p.product, (m.get(p.product) ?? 0) + p.qty);
      prodBy.set(k, m);
    }
    const out = new Map<string, { grams: number; parsed: number; total: number }>();
    for (const c of analysis?.needConv ?? []) {
      if (c.unit === "ΤΕΜΑΧΙΟ") continue;
      const k = `${c.sku}|${c.unit}`;
      const buyKey = `${c.sku}|${c.unit.replace("#ΤΕΜ", "")}`;
      const prods = [...(prodBy.get(buyKey) ?? new Map()).entries()].map(([product, qty]) => ({ product, qty }));
      const sg = suggestPackGrams(prods, c.unit);
      if (sg) out.set(k, sg);
    }
    return out;
  }, [purchases, lookup, analysis?.needConv]);

  async function saveAllConversions() {
    const rows = (analysis?.needConv ?? []).map(c => {
      const k = `${c.sku}|${c.unit}`;
      const raw = gramsIn[k] ?? (packSuggest.get(k) ? String(packSuggest.get(k)!.grams) : "");
      return { sku: c.sku, unit: c.unit, grams: Number(String(raw).replace(",", ".")) };
    }).filter(r => r.grams > 0);
    if (rows.length === 0) { setMsg({ ok: false, text: gr ? "Δεν υπάρχει καμία τιμή για αποθήκευση." : "Nothing to save." }); return; }
    setBusy(true); setMsg(null);
    try {
      await db.upsertSkuConversions(rows);
      await reload();
      setMsg({ ok: true, text: gr ? `✅ Αποθηκεύτηκαν ${rows.length} μετατροπές.` : `✅ Saved ${rows.length}.` });
    } catch (err) {
      setMsg({ ok: false, text: (gr ? "Αποτυχία: " : "Failed: ") + String((err as { message?: string })?.message ?? err) });
    } finally { setBusy(false); }
  }

  // Αρχικές προτάσεις για υλικά χωρίς ομάδα
  const suggestions = useMemo(() => {
    const m = new Map<string, ScoredCandidate[]>();
    for (const u of analysis?.unlinked ?? []) m.set(u.name, suggestGroups(u.name, candidates, 3));
    return m;
  }, [analysis?.unlinked, candidates]);

  // Προσυμπλήρωση ΜΟΝΟ για βέβαιες προτάσεις — στις πιθανές διαλέγει ο χρήστης.
  function chosen(name: string): string {
    if (choice[name] !== undefined) return choice[name];
    const s = suggestions.get(name)?.[0];
    return s && s.confidence === "high" ? optionValue(s) : "";
  }

  async function saveLinks(names: string[]) {
    const rows = names.map(n => ({ n, c: byOption.get(chosen(n)) })).filter(x => x.c && x.c.sku);
    if (rows.length === 0) { setMsg({ ok: false, text: gr ? "Δεν έχει επιλεγεί ομάδα." : "No group selected." }); return; }
    setBusy(true); setMsg(null);
    try {
      await db.bulkCreateProductSkuMapEntries(rows.map(x => ({ productName: x.n, sku: x.c!.sku!, finalGroup: x.c!.label })));
      await reload();
      setMsg({ ok: true, text: gr ? `✅ Συνδέθηκαν ${rows.length} υλικά.` : `✅ Linked ${rows.length} items.` });
    } catch (err) {
      setMsg({ ok: false, text: (gr ? "Αποτυχία: " : "Failed: ") + String((err as { message?: string })?.message ?? err) });
    } finally { setBusy(false); }
  }

  async function saveConversion(sku: string, unit: string) {
    const k = `${sku}|${unit}`;
    const g = Number(String(gramsIn[k] ?? (packSuggest.get(k)?.grams ?? "")).replace(",", "."));
    if (!(g > 0)) { setMsg({ ok: false, text: gr ? "Γράψε θετικό αριθμό γραμμαρίων/ml." : "Enter a positive number." }); return; }
    setBusy(true); setMsg(null);
    try {
      await db.upsertSkuConversion(sku, unit, g);
      await reload();
      setMsg({ ok: true, text: gr ? `✅ ${sku}: 1 ${unit} = ${g} γρ./ml` : `✅ Saved` });
    } catch (err) {
      setMsg({ ok: false, text: (gr ? "Αποτυχία: " : "Failed: ") + String((err as { message?: string })?.message ?? err) });
    } finally { setBusy(false); }
  }

  async function applyPrices() {
    if (!analysis) return;
    const okRows = analysis.rows.filter(r => r.p.status === "ok");
    if (!confirm(gr
      ? `Ενημέρωση τιμών σε ${okRows.length} υλικά και επανυπολογισμός κόστους σε ${data.recipes.length} συνταγές;\n\nΥλικά χωρίς τιμή από αγορές κρατούν την τιμή που έχουν.`
      : `Update ${okRows.length} ingredient prices and recompute ${data.recipes.length} recipes?`)) return;
    setBusy(true); setMsg(null);
    try {
      const newCost = new Map<number, { unit: number; total: number }>();
      for (const r of okRows) newCost.set(r.ingId, { unit: r6(r.p.unitCost), total: r2(r.qty * r.p.unitCost) });
      const payload: db.RecipePricePayload = { ingredients: [], recipes: [] };
      for (const [id, c] of newCost) payload.ingredients.push({ id, unit_cost: c.unit, total_cost: c.total });
      for (const rec of data.recipes) {
        const raw = r2((rec.ingredients ?? []).reduce((s, i) => s + (i.id && newCost.has(i.id) ? newCost.get(i.id)!.total : Number(i.totalCost) || 0), 0));
        const t = recipeTotals(raw, Number(rec.laborCost) || 0, Number(rec.overheadCost) || 0, Number(rec.profitMarginPercent || 60), Number(rec.portionYield) || 1);
        payload.recipes.push({ id: rec.id, raw: t.rawMaterial, total: r2(t.total), selling: r2(t.selling), menu_vat: r2(t.menuVat), menu_final: r2(t.menuFinal) });
      }
      const res = await db.applyRecipePrices(payload);
      await refreshAll();
      setMsg({ ok: true, text: gr ? `✅ Ενημερώθηκαν ${res.ingredients} υλικά και ${res.recipes} συνταγές.` : `✅ Updated ${res.ingredients} items, ${res.recipes} recipes.` });
    } catch (err) {
      const t = String((err as { message?: string })?.message ?? err);
      setMsg({ ok: false, text: (gr ? "Αποτυχία: " : "Failed: ") + t + (/apply_recipe_prices/.test(t) ? (gr ? " — τρέξε πρώτα το migration_recipe_pricing.sql" : "") : "") });
    } finally { setBusy(false); }
  }

  if (convs === null) {
    return (
      <div className="erp-card mb-6 p-4 text-sm bg-amber-50 border-amber-300 text-amber-800 print:hidden">
        {gr ? "Για τις τιμές συνταγών από αγορές χρειάζεται μία φορά το SQL «migration_recipe_pricing.sql» στο Supabase." : "Run migration_recipe_pricing.sql once to enable purchase-based pricing."}
      </div>
    );
  }
  if (!analysis) return <div className="erp-card mb-6 p-4 text-sm text-slate-400 print:hidden">{gr ? "Φόρτωση τιμών από αγορές…" : "Loading…"}</div>;

  const total = analysis.rows.length;
  const tierOf = (name: string): "high" | "medium" | "none" => suggestions.get(name)?.[0]?.confidence ?? "none";
  const tierCount = { high: 0, medium: 0, none: 0 };
  for (const u of analysis.unlinked) tierCount[tierOf(u.name)]++;
  const filteredUnlinked = analysis.unlinked.filter(u => tierOf(u.name) === tier && (!linkFilter || normKey(u.name).includes(normKey(linkFilter))));

  return (
    <div className="erp-card mb-6 print:hidden">
      <div className="erp-card-header flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">🔄 {gr ? `Τιμές από αγορές — μέση σταθμισμένη ${PRICE_WINDOW_DAYS} ημερών, χωρίς ΦΠΑ` : `Prices from purchases — ${PRICE_WINDOW_DAYS}-day weighted average, net`}</h3>
        <div className="flex gap-2">
          <button onClick={() => setOpen(!open)} className="erp-btn-secondary text-sm">{open ? (gr ? "Απόκρυψη" : "Hide") : (gr ? "Εκκρεμότητες" : "Pending")}</button>
          <button onClick={applyPrices} disabled={busy || analysis.ok === 0} className="erp-btn-primary text-sm">{busy ? "…" : "🔄"} {gr ? "Ενημέρωση τιμών συνταγών" : "Update recipe prices"}</button>
        </div>
      </div>
      <div className="p-4 grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
        <Stat label={gr ? "Υλικά με τιμή" : "Priced"} value={`${analysis.ok} / ${total}`} tone="green" />
        <Stat label={gr ? "Συνταγές πλήρεις" : "Recipes complete"} value={`${analysis.recipesFull} / ${data.recipes.length}`} tone="blue" />
        <Stat label={gr ? "Χωρίς ομάδα SKU" : "No SKU group"} value={String(analysis.unlinked.length)} tone="amber" onClick={() => { setOpen(true); setTab("link"); }} />
        <Stat label={gr ? "Θέλουν μετατροπή" : "Need conversion"} value={String(analysis.needConv.length)} tone="amber" onClick={() => { setOpen(true); setTab("conv"); }} />
        <Stat label={gr ? "Χωρίς αγορές / μονάδα" : "No purchases / unit"} value={String(analysis.noPurch.length + analysis.badUnit.length)} tone="slate" onClick={() => { setOpen(true); setTab("other"); }} />
      </div>
      {msg && <div className={`mx-4 mb-3 p-2 rounded text-sm ${msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}>{msg.text}</div>}

      {open && (
        <div className="border-t border-slate-100">
          <div className="flex gap-1 px-4 pt-3">
            {([["link", gr ? `Σύνδεση με ομάδα (${analysis.unlinked.length})` : "Link"], ["conv", gr ? `Μετατροπές (${analysis.needConv.length})` : "Conversions"], ["other", gr ? "Λοιπά" : "Other"]] as const).map(([k, l]) => (
              <button key={k} onClick={() => setTab(k)} className={`px-3 py-1.5 rounded-t text-sm ${tab === k ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"}`}>{l}</button>
            ))}
          </div>

          {tab === "link" && (
            <div className="p-4">
              <datalist id="sku-groups">{candidates.map(c => <option key={c.key} value={optionValue(c)} />)}</datalist>
              <div className="flex flex-wrap gap-2 mb-3 text-sm">
                {([["high", gr ? "✅ Βέβαιες προτάσεις" : "Confident"], ["medium", gr ? "❓ Πιθανές — έλεγξε" : "Possible"], ["none", gr ? "✖ Χωρίς πρόταση" : "No suggestion"]] as const).map(([k, l]) => (
                  <button key={k} onClick={() => setTier(k)} className={`px-3 py-1 rounded-full border ${tier === k ? "bg-slate-800 text-white border-slate-800" : "bg-white text-slate-600 border-slate-200"}`}>{l} ({tierCount[k]})</button>
                ))}
              </div>
              <p className="text-xs text-slate-500 mb-3">
                {tier === "high" && (gr ? "Όλες οι λέξεις του υλικού ταιριάζουν και δεν υπάρχει άλλη εξίσου καλή ομάδα. Ρίξε μια ματιά και πάτα «Αποθήκευση όλων»." : "")}
                {tier === "medium" && (gr ? "Κλικ στη σωστή από τις 3 προτάσεις (ή γράψε για αναζήτηση). Όσα δεν επιλέξεις μένουν ασύνδετα. Ξεκίνα από τα πάνω — είναι ταξινομημένα κατά χρήσεις. Στο τέλος «Αποθήκευση όλων»." : "")}
                {tier === "none" && (gr ? "Δεν βρέθηκε ομάδα — πιθανώς δεν αγοράστηκε φέτος. Γράψε για αναζήτηση ή άφησέ τα κενά (κρατούν την τιμή που έχουν)." : "")}
              </p>
              <div className="flex flex-wrap items-center gap-2 mb-3 text-sm">
                <input className="erp-input max-w-xs" placeholder={gr ? "Φίλτρο υλικού…" : "Filter…"} value={linkFilter} onChange={e => setLinkFilter(e.target.value)} />
                <button disabled={busy} onClick={() => saveLinks(filteredUnlinked.map(u => u.name))} className="erp-btn-success text-sm">
                  ✓ {gr ? `Αποθήκευση όλων των επιλογών (${filteredUnlinked.filter(u => byOption.has(chosen(u.name))).length})` : "Save all"}
                </button>
                <span className="text-xs text-slate-500">{gr ? "Η πρόταση είναι προσυμπληρωμένη — άλλαξε ή σβήσε όσες δεν ταιριάζουν πριν αποθηκεύσεις." : "Suggestions are prefilled — fix any wrong ones first."}</span>
              </div>
              <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
                <table className="erp-table text-sm">
                  <thead><tr><th>{gr ? "Υλικό συνταγής" : "Ingredient"}</th><th className="text-right">{gr ? "Χρήσεις" : "Uses"}</th><th>{gr ? "Ομάδα SKU (αγορές)" : "SKU group"}</th><th></th></tr></thead>
                  <tbody>
                    {filteredUnlinked.slice(0, 300).map(u => {
                      const v = chosen(u.name);
                      const valid = byOption.has(v);
                      return (
                        <tr key={u.name}>
                          <td className="font-medium">{u.name}</td>
                          <td className="text-right">{u.uses}</td>
                          <td className="min-w-[22rem]">
                            {tier !== "high" && (suggestions.get(u.name) ?? []).length > 0 && (
                              <div className="flex flex-wrap gap-1 mb-1">
                                {(suggestions.get(u.name) ?? []).map(sg => {
                                  const val = optionValue(sg);
                                  const on = v === val;
                                  return (
                                    <button key={sg.key} type="button" onClick={() => setChoice(c => ({ ...c, [u.name]: on ? "" : val }))}
                                      className={`text-xs px-2 py-0.5 rounded-full border ${on ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-700 border-slate-300 hover:bg-blue-50"}`}>
                                      {sg.label}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                            <input list="sku-groups" className={`erp-input text-sm py-1 ${v && !valid ? "border-red-300" : ""}`} value={v}
                              placeholder={gr ? "γράψε για αναζήτηση…" : "type to search…"}
                              onChange={e => setChoice(c => ({ ...c, [u.name]: e.target.value }))} />
                          </td>
                          <td><button disabled={busy || !valid} onClick={() => saveLinks([u.name])} className="erp-btn-secondary text-xs px-2 py-1">✓</button></td>
                        </tr>
                      );
                    })}
                    {filteredUnlinked.length === 0 && <tr><td colSpan={4} className="text-center py-6 text-slate-400">{gr ? "Όλα τα υλικά έχουν ομάδα 👍" : "All linked 👍"}</td></tr>}
                  </tbody>
                </table>
                {filteredUnlinked.length > 300 && <div className="text-xs text-slate-400 mt-2">{gr ? `Εμφανίζονται 300 από ${filteredUnlinked.length} — χρησιμοποίησε το φίλτρο.` : "Showing 300 — use the filter."}</div>}
              </div>
            </div>
          )}

          {tab === "conv" && (
            <div className="p-4 overflow-x-auto">
              <div className="flex flex-wrap items-center gap-3 mb-2">
                <p className="text-xs text-slate-500">{gr ? "Πόσα γρ. (ή ml) είναι κατά μέσο όρο 1 μονάδα αγοράς — μία φορά ανά ομάδα. Όπου το όνομα έχει μέγεθος (5Lt, 2,5KG, 4x2.5Kg…) η τιμή είναι προσυμπληρωμένη (μπλε σημείωση). Για είδη με μεταβλητό βάρος (π.χ. παντζάρι βακούμ) γράψε το μέσο βάρος." : "Average grams/ml per purchase unit."}</p>
                <button disabled={busy} onClick={saveAllConversions} className="erp-btn-success text-sm">✓ {gr ? `Αποθήκευση όλων όσων έχουν τιμή (${(analysis.needConv).filter(c => { const k = `${c.sku}|${c.unit}`; return Number(String(gramsIn[k] ?? packSuggest.get(k)?.grams ?? "").replace(",", ".")) > 0; }).length})` : "Save all"}</button>
              </div>
              <table className="erp-table text-sm">
                <thead><tr><th>SKU</th><th>{gr ? "Ομάδα" : "Group"}</th><th>{gr ? "Υλικά συνταγών" : "Used as"}</th><th>{gr ? "Μετατροπή" : "Conversion"}</th></tr></thead>
                <tbody>
                  {analysis.needConv.map(c => {
                    const key = `${c.sku}|${c.unit}`;
                    return (
                      <tr key={key}>
                        <td className="font-mono text-xs">{c.sku}</td>
                        <td className="font-medium">{c.label}</td>
                        <td className="text-xs text-slate-500 max-w-[16rem]">{[...c.examples].slice(0, 4).join(", ")}</td>
                        <td>
                          <div className="flex items-center gap-2 whitespace-nowrap">
                            <span>1 {c.unit === "ΤΕΜΑΧΙΟ" ? (gr ? "τεμάχιο συνταγής" : "recipe piece") : c.unit.replace("#ΤΕΜ", "")} =</span>
                            <input className="erp-input text-sm py-1 text-right" style={{ width: "6.5rem", minWidth: "6.5rem" }} inputMode="decimal"
                              value={gramsIn[key] ?? (packSuggest.get(key) ? String(packSuggest.get(key)!.grams) : "")} onChange={e => setGramsIn(g => ({ ...g, [key]: e.target.value }))}
                              onKeyDown={e => { if (e.key === "Enter") saveConversion(c.sku, c.unit); }} />
                            <span>{isPiecesKey(c.unit) ? (gr ? "τεμάχια" : "pieces") : (gr ? "γρ./ml" : "g/ml")}</span>
                            <button disabled={busy} onClick={() => saveConversion(c.sku, c.unit)} className="erp-btn-secondary text-xs px-2 py-1">✓</button>
                          </div>
                          {packSuggest.get(key) && gramsIn[key] === undefined
                            ? <div className="text-[11px] text-blue-600 mt-0.5">📏 {gr ? `πρόταση από το όνομα (${packSuggest.get(key)!.parsed}/${packSuggest.get(key)!.total} προϊόντα) — έλεγξε και ✓` : "suggested from name"}</div>
                            : <div className="text-[11px] text-slate-400 mt-0.5">{isPiecesKey(c.unit) ? (gr ? "πόσα τεμάχια/μερίδες έχει 1 συσκευασία (π.χ. brioche 1*25 = 25, κέτσαπ 100T = 100)" : "pieces per pack") : <>{gr ? "μέσο βάρος/όγκος · " : ""}{UNIT_HINT[c.unit] ?? ""}</>}</div>}
                        </td>
                      </tr>
                    );
                  })}
                  {analysis.needConv.length === 0 && <tr><td colSpan={4} className="text-center py-6 text-slate-400">{gr ? "Δεν χρειάζεται καμία μετατροπή 👍" : "Nothing to convert 👍"}</td></tr>}
                </tbody>
              </table>
            </div>
          )}

          {tab === "other" && (
            <div className="p-4 grid md:grid-cols-2 gap-6 text-sm">
              <div>
                <h4 className="font-semibold mb-1">{gr ? "Ομάδα χωρίς αγορές" : "Group without purchases"} ({analysis.noPurch.length})</h4>
                <p className="text-xs text-slate-500 mb-2">{gr ? "Συνδεδεμένα υλικά, αλλά η ομάδα δεν έχει αγορές στην ενεργή επιχείρηση. Κρατούν την τιμή που έχουν." : "Linked, but no purchases yet."}</p>
                <ul className="max-h-64 overflow-y-auto space-y-0.5">{analysis.noPurch.map(([n, c]) => <li key={n}>• {n} <span className="text-slate-400">({c})</span></li>)}</ul>
              </div>
              <div>
                <h4 className="font-semibold mb-1">{gr ? "Άγνωστη μονάδα συνταγής" : "Unknown recipe unit"} ({analysis.badUnit.length})</h4>
                <p className="text-xs text-slate-500 mb-2">{gr ? "Διόρθωσε τη μονάδα στη συνταγή (γραμμάρια, κιλό, ml, λίτρο, τεμάχιο, μάτσο, κουταλάκι/κουτάλι)." : "Fix the unit in the recipe."}</p>
                <ul className="max-h-64 overflow-y-auto space-y-0.5">{analysis.badUnit.map(([n, c]) => <li key={n}>• {n} <span className="text-slate-400">({c})</span></li>)}</ul>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone, onClick }: { label: string; value: string; tone: "green" | "blue" | "amber" | "slate"; onClick?: () => void }) {
  const c = { green: "text-emerald-700", blue: "text-blue-700", amber: "text-amber-700", slate: "text-slate-600" }[tone];
  return (
    <div onClick={onClick} className={`rounded-lg border border-slate-200 p-3 ${onClick ? "cursor-pointer hover:bg-slate-50" : ""}`}>
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-lg font-bold ${c}`}>{value}</div>
    </div>
  );
}
