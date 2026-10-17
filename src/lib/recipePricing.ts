// ----------------------------------------------------------------
// Τιμές υλικών συνταγών από τις ΠΡΑΓΜΑΤΙΚΕΣ αγορές.
//
//  • Κάθε υλικό συνταγής συνδέεται με μία ομάδα της Ομαδοποίησης Ειδών
//    (SKU) — μέσω εγγραφής του ονόματος του υλικού στο product_sku_map.
//  • Τιμή = μέση σταθμισμένη τιμή ΧΩΡΙΣ ΦΠΑ των αγορών της ομάδας στις
//    90 ημέρες πριν από την τελευταία αγορά της (έτσι μια εποχική
//    επιχείρηση που έκλεισε δεν μένει χωρίς τιμές).
//  • Μονάδες: ΚΙΛΟ → γραμμάρια αυτόματα. Για ΤΕΜ/ΚΙΒ/ΚΟΥΤΙ κ.λπ. ο
//    χρήστης δηλώνει μία φορά ανά ομάδα «1 ΤΕΜ = Χ γρ./ml».
//    Γραμμάρια και ml θεωρούνται ισοδύναμα (πυκνότητα ≈ 1).
// ----------------------------------------------------------------
import { normKey, groupOf, type SkuInfo } from "./itemAnalysis";

export const PRICE_WINDOW_DAYS = 90;

export interface PurchaseRow {
  date: string; product: string; qty: number; unit: string; net: number;
}

/** 1 <unit> του SKU = grams γρ. (ή ml) — ανά επιχείρηση. */
export interface UnitConversion { sku: string; unit: string; grams: number }

export type Measure = "mass" | "count";

// Μονάδα συνταγής → { διάσταση, πολλαπλασιαστής προς γρ. ή «τεμάχια» }
export function recipeUnitInfo(raw: string): { measure: Measure; factor: number; countUnit?: string } | null {
  const u = normKey(raw).replace(/\./g, "");
  if (["ΓΡΑΜΜΑΡΙΑ", "ΓΡΑΜΜΑΡΙΟ", "ΓΡ", "GR", "G"].includes(u)) return { measure: "mass", factor: 1 };
  if (["ΚΙΛΟ", "ΚΙΛΑ", "KG", "ΚG"].includes(u)) return { measure: "mass", factor: 1000 };
  if (["ML", "ΜL", "ΧΙΛΙΟΣΤΑ"].includes(u)) return { measure: "mass", factor: 1 };
  if (["ΛΙΤΡΟ", "ΛΙΤΡΑ", "LT", "L"].includes(u)) return { measure: "mass", factor: 1000 };
  if (u === "ΚΟΥΤΑΛΑΚΙ ΓΛΥΚΟΥ") return { measure: "mass", factor: 5 };
  if (u === "ΚΟΥΤΑΛΙΑ ΣΟΥΠΑΣ") return { measure: "mass", factor: 15 };
  if (u === "CUP") return { measure: "mass", factor: 240 };
  if (["ΤΕΜΑΧΙΟ", "ΤΕΜΑΧΙΑ", "ΤΕΜ", "TEM"].includes(u)) return { measure: "count", factor: 1, countUnit: "ΤΕΜΑΧΙΟ" };
  if (u === "ΜΑΤΣΟ") return { measure: "count", factor: 1, countUnit: "ΜΑΤΣΟ" };
  return null;
}

// Μονάδα αγοράς (ήδη ενοποιημένη στην εισαγωγή): ΚΙΛΟ / ΤΕΜ / ΚΙΒ / ΚΟΥΤΙ / ΠΑΚ / ΚΑΡΤΕΛΑ / ΜΑΤΣΟ
export function purchaseUnitKey(raw: string): string {
  const u = normKey(raw).replace(/\./g, "");
  if (/^(ΚΙΛ|KG|ΚG)/.test(u)) return "ΚΙΛΟ";
  if (/^(ΤΕΜ|TEM|ΤΜΧ|TMX)/.test(u)) return "ΤΕΜ";
  if (/^ΚΙΒ/.test(u)) return "ΚΙΒ";
  if (/^ΚΑΡΤ/.test(u)) return "ΚΑΡΤΕΛΑ";
  if (/^ΚΟΥΤ/.test(u)) return "ΚΟΥΤΙ";
  if (/^ΠΑΚ/.test(u)) return "ΠΑΚ";
  if (/^ΜΑΤΣ/.test(u)) return "ΜΑΤΣΟ";
  if (/^(ΛΙΤ|LT|L$)/.test(u)) return "ΛΙΤΡΟ";
  return u || "ΤΕΜ";
}

export interface GroupPrice {
  sku: string | null;
  label: string;
  lastDate: string;
  windowFrom: string;
  lines: number;
  perGram: number | null;                 // €/γρ. (από γραμμές που μετατρέπονται σε γρ.)
  perUnit: Record<string, number>;        // €/ΤΕΜ, €/ΜΑΤΣΟ … (γραμμές στη μονάδα αυτή)
  unconverted: Record<string, number>;    // μονάδες αγοράς χωρίς δηλωμένη μετατροπή → πλήθος γραμμών
}

export function buildGroupPrices(rows: PurchaseRow[], lookup: Map<string, SkuInfo>, conversions: UnitConversion[]): Map<string, GroupPrice> {
  const conv = new Map(conversions.map(c => [`${c.sku}|${c.unit}`, c.grams]));
  const byGroup = new Map<string, { label: string; sku: string | null; rows: PurchaseRow[] }>();
  for (const r of rows) {
    if (!(r.qty > 0) || !(r.net > 0)) continue;
    const g = groupOf(r.product, lookup);
    const e = byGroup.get(g.key) ?? { label: g.label, sku: g.sku, rows: [] };
    e.rows.push(r);
    byGroup.set(g.key, e);
  }
  const out = new Map<string, GroupPrice>();
  for (const [key, g] of byGroup) {
    const lastDate = g.rows.reduce((m, r) => (r.date > m ? r.date : m), "");
    const from = new Date(lastDate + "T00:00:00Z");
    from.setUTCDate(from.getUTCDate() - PRICE_WINDOW_DAYS);
    const windowFrom = from.toISOString().slice(0, 10);
    const win = g.rows.filter(r => r.date >= windowFrom);
    let gNet = 0, grams = 0;
    const unitNet: Record<string, number> = {}, unitQty: Record<string, number> = {}, unconverted: Record<string, number> = {};
    for (const r of win) {
      const pu = purchaseUnitKey(r.unit);
      unitNet[pu] = (unitNet[pu] ?? 0) + r.net;
      unitQty[pu] = (unitQty[pu] ?? 0) + r.qty;
      let g1: number | null = null;
      if (pu === "ΚΙΛΟ" || pu === "ΛΙΤΡΟ") g1 = 1000;
      else if (g.sku && conv.has(`${g.sku}|${pu}`)) g1 = conv.get(`${g.sku}|${pu}`)!;
      if (g1 && g1 > 0) { gNet += r.net; grams += r.qty * g1; }
      else unconverted[pu] = (unconverted[pu] ?? 0) + 1;
    }
    const perUnit: Record<string, number> = {};
    for (const u of Object.keys(unitNet)) if (unitQty[u] > 0 && u !== "ΚΙΛΟ" && u !== "ΛΙΤΡΟ") perUnit[u] = unitNet[u] / unitQty[u];
    out.set(key, {
      sku: g.sku, label: g.label, lastDate, windowFrom, lines: win.length,
      perGram: grams > 0 ? gNet / grams : null, perUnit, unconverted,
    });
  }
  return out;
}

export type PriceStatus = "ok" | "no_group" | "no_purchases" | "needs_conversion" | "unknown_unit";

export interface IngredientPrice {
  status: PriceStatus;
  unitCost: number;          // € ανά μονάδα ΣΥΝΤΑΓΗΣ (χωρίς ΦΠΑ)
  groupKey?: string;
  groupLabel?: string;
  sku?: string | null;
  needUnit?: string;         // για needs_conversion: ποια μονάδα θέλει «= Χ γρ.»
  detail?: string;
}

/** Τιμή ανά μονάδα συνταγής για ένα υλικό. */
export function priceIngredient(
  ingredientName: string, recipeUnit: string,
  lookup: Map<string, SkuInfo>, prices: Map<string, GroupPrice>, conversions: UnitConversion[],
): IngredientPrice {
  const info = lookup.get(normKey(ingredientName));
  if (!info) return { status: "no_group", unitCost: 0 };
  const groupKey = "G:" + normKey(info.group);
  const base = { groupKey, groupLabel: info.group, sku: info.sku };
  const gp = prices.get(groupKey);
  if (!gp || gp.lines === 0) return { ...base, status: "no_purchases", unitCost: 0 };
  const ru = recipeUnitInfo(recipeUnit);
  if (!ru) return { ...base, status: "unknown_unit", unitCost: 0, detail: recipeUnit };
  const span = `${gp.lines} αγορές ${gp.windowFrom.split("-").reverse().join("/")}–${gp.lastDate.split("-").reverse().join("/")}`;

  if (ru.measure === "mass") {
    if (gp.perGram != null) return { ...base, status: "ok", unitCost: gp.perGram * ru.factor, detail: span };
    const need = Object.keys(gp.unconverted)[0] ?? Object.keys(gp.perUnit)[0] ?? "ΤΕΜ";
    return { ...base, status: "needs_conversion", unitCost: 0, needUnit: need };
  }
  // τεμάχια / ματσάκια συνταγής
  const cu = ru.countUnit!;                       // "ΤΕΜΑΧΙΟ" ή "ΜΑΤΣΟ" (μονάδα συνταγής)
  const buyUnit = cu === "ΤΕΜΑΧΙΟ" ? "ΤΕΜ" : cu;  // αντίστοιχη μονάδα αγοράς
  // 1) δηλωμένο βάρος τεμαχίου συνταγής (π.χ. 1 αυγό = 60 γρ., 1 λεμόνι = 120 γρ.)
  const g1 = conversions.find(c => c.sku === info.sku && c.unit === cu)?.grams;
  if (gp.perGram != null && g1) return { ...base, status: "ok", unitCost: gp.perGram * g1, detail: span };
  // 2) αγορά στην ίδια μονάδα → 1 τεμάχιο αγοράς = 1 τεμάχιο συνταγής
  if (gp.perUnit[buyUnit] != null) {
    return { ...base, status: "ok", unitCost: gp.perUnit[buyUnit] * ru.factor, detail: `${span} · 1 ${buyUnit} αγοράς = 1 ${cu.toLowerCase()}` };
  }
  return { ...base, status: "needs_conversion", unitCost: 0, needUnit: cu };
}

// ── Προτάσεις ομάδας για υλικό χωρίς σύνδεση ──────────────────────────────

const STOP = new Set(["ΚΑΙ", "ΜΕ", "ΓΙΑ", "ΤΟΥ", "ΤΗΣ", "ΤΑ", "ΤΟ", "Η", "Ο", "ΣΕ", "ΑΠΟ", "ΦΡΕΣΚΟ", "ΦΡΕΣΚΙΑ", "ΦΡΕΣΚΟΣ"]);
function stems(s: string): string[] {
  return normKey(s).replace(/[^A-ZΑ-Ω0-9 ]/g, " ").split(" ")
    .filter(w => w.length >= 3 && !STOP.has(w) && !/^\d/.test(w))
    .map(w => w.slice(0, Math.max(4, Math.min(6, w.length - 2))));
}

export interface GroupCandidate { key: string; label: string; sku: string | null; text: string; weight: number }
export interface ScoredCandidate extends GroupCandidate { score: number; confidence: "high" | "medium" }

/**
 * Έως `n` προτεινόμενες ομάδες για ένα υλικό (με βάση κοινές ρίζες λέξεων).
 * «high»: όλες οι λέξεις του υλικού βρέθηκαν, το όνομα της ομάδας ξεκινά με
 * την 1η λέξη, και η 2η πρόταση δεν είναι εξίσου καλή (αλλιώς είναι αμφίβολο).
 */
export function suggestGroups(ingredientName: string, candidates: GroupCandidate[], n = 3): ScoredCandidate[] {
  const st = stems(ingredientName);
  if (st.length === 0) return [];
  const scored: { c: GroupCandidate; score: number; all: boolean; first: boolean }[] = [];
  for (const c of candidates) {
    const ct = normKey(c.text);
    let hits = 0;
    for (const s of st) if (ct.includes(s)) hits++;
    if (!hits) continue;
    const first = normKey(c.label).startsWith(st[0]);
    scored.push({ c, all: hits === st.length, first, score: hits / st.length + (first ? 0.5 : 0) + Math.log10(1 + c.weight) / 10 });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, n).map((x, i) => {
    const runnerUp = scored[1];
    const clearWinner = i === 0 && (!runnerUp || !(runnerUp.all && runnerUp.first) || runnerUp.score < x.score - 0.25);
    return { ...x.c, score: x.score, confidence: x.all && x.first && clearWinner ? "high" : "medium" };
  });
}

// ── Κόστος συνταγής (ίδιος τύπος με τη Φόρμα Συνταγής) ────────────────────

export function recipeTotals(rawMaterial: number, labor: number, overhead: number, marginPct: number, portions: number) {
  const total = rawMaterial + labor + overhead;
  const selling = marginPct < 100 ? total / (1 - marginPct / 100) : total;
  const menuVat = selling * 1.24;
  const menuFinal = portions > 0 ? menuVat / portions : menuVat;
  return { rawMaterial, total, selling, menuVat, menuFinal };
}
