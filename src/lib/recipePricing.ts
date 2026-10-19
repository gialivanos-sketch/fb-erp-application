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
  multiPack: Record<string, boolean>;     // μονάδα αγοράς που (από το όνομα) περιέχει πολλά τεμάχια, π.χ. «5Χ100»
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
    const multiPack: Record<string, boolean> = {};
    for (const r of win) { const pu = purchaseUnitKey(r.unit); if (!multiPack[pu] && (parsePackPieces(r.product) ?? 1) > 1) multiPack[pu] = true; }
    const perUnit: Record<string, number> = {};
    for (const u of Object.keys(unitNet)) if (unitQty[u] > 0 && u !== "ΚΙΛΟ" && u !== "ΛΙΤΡΟ") perUnit[u] = unitNet[u] / unitQty[u];
    out.set(key, {
      sku: g.sku, label: g.label, lastDate, windowFrom, lines: win.length,
      perGram: grams > 0 ? gNet / grams : null, perUnit, unconverted, multiPack,
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
  if (g1 && g1 > 0) {
    // 1α) Έχουμε perGram (αγορά σε κιλά ή άλλη μονάδα με γνωστό βάρος)
    if (gp.perGram != null) return { ...base, status: "ok", unitCost: gp.perGram * g1, detail: span };
    // 1β) Δεν έχουμε perGram, αλλά υπάρχει κάποια μονάδα αγοράς με δηλωμένο βάρος ανά μονάδα
    //     → €/cu = €/u_buy × (γρ/cu / γρ/u_buy)
    for (const u of Object.keys(gp.perUnit)) {
      let guGrams: number | null = null;
      if (u === "ΚΙΛΟ" || u === "ΛΙΤΡΟ") guGrams = 1000;
      else {
        const uc = conversions.find(c => c.sku === info.sku && c.unit === u)?.grams ?? null;
        if (uc && uc > 0) guGrams = uc;
      }
      if (guGrams && guGrams > 0) {
        const costPerGram = gp.perUnit[u] / guGrams;
        return { ...base, status: "ok", unitCost: costPerGram * g1, detail: `${span} · 1 ${u} = ${guGrams}γρ, 1 ${cu} = ${g1}γρ` };
      }
    }
  }
  // 2) δηλωμένα «τεμάχια ανά συσκευασία» για οποιαδήποτε μονάδα αγοράς (1 ΚΙΒ = 25, 1 ΤΕΜ = 500…)
  for (const u of Object.keys(gp.perUnit)) {
    const n = conversions.find(c => c.sku === info.sku && c.unit === piecesKey(u))?.grams;
    if (n && n > 0) return { ...base, status: "ok", unitCost: (gp.perUnit[u] / n) * ru.factor, detail: `${span} · 1 ${u} = ${n} τεμ.` };
  }
  // 3) αγορά στην ίδια μονάδα → 1 τεμάχιο αγοράς = 1 τεμάχιο συνταγής
  //    (εκτός αν το όνομα δείχνει συσκευασία πολλών τεμαχίων, π.χ. «5Χ100» → ρώτα)
  if (gp.perUnit[buyUnit] != null) {
    if (gp.multiPack[buyUnit]) return { ...base, status: "needs_conversion", unitCost: 0, needUnit: piecesKey(buyUnit) };
    return { ...base, status: "ok", unitCost: gp.perUnit[buyUnit] * ru.factor, detail: `${span} · 1 ${buyUnit} αγοράς = 1 ${cu.toLowerCase()}` };
  }
  const packUnit = Object.keys(gp.perUnit).find(u => MULTI_UNITS.includes(u));
  if (packUnit) return { ...base, status: "needs_conversion", unitCost: 0, needUnit: piecesKey(packUnit) };
  // 4) αγορά σε ΤΕΜ ενώ συνταγή σε ΜΑΤΣΟ (ή άλλη μη-τεμάχιο μονάδα) → 1 ΤΕΜ αγοράς = 1 cu συνταγής
  if (cu !== "ΤΕΜΑΧΙΟ" && gp.perUnit["ΤΕΜ"] != null && !gp.multiPack["ΤΕΜ"]) {
    return { ...base, status: "ok", unitCost: gp.perUnit["ΤΕΜ"] * ru.factor, detail: `${span} · 1 ΤΕΜ αγοράς = 1 ${cu.toLowerCase()}` };
  }
  return { ...base, status: "needs_conversion", unitCost: 0, needUnit: cu };
}

// Μετατροπή «τεμάχια ανά συσκευασία» αποθηκεύεται ως μονάδα "ΚΙΒ#ΤΕΜ" (grams = πλήθος)
export const MULTI_UNITS = ["ΚΙΒ", "ΚΟΥΤΙ", "ΠΑΚ", "ΚΑΡΤΕΛΑ"];
export const piecesKey = (u: string) => `${u}#ΤΕΜ`;
export const isPiecesKey = (u: string) => u.endsWith("#ΤΕΜ");

/** Τεμάχια σε 1 συσκευασία από το όνομα («1*25», «100T», «Χ 35 ΤΜΧ») — ή null. */
export function parsePackPieces(productName: string): number | null {
  const s = normKey(productName);
  const PCS = String.raw`(?:T|Τ|ΤΕΜ|TEM|ΤΜΧ|TMX|PCS|ΤΕΜΑΧΙΑ)(?![A-ZΑ-Ω])`;
  // 1) «24Χ100ΤΕΜ», «10χ100τεμ» → 2400, 1000
  const abT = s.match(new RegExp(String.raw`\b(\d{1,3})\s*[*XΧ]\s*(\d{1,4})\s*` + PCS));
  if (abT) return Number(abT[1]) * Number(abT[2]);
  // 2) «1*25», «1Χ25» → 25
  const one = s.match(/\b1\s*[*XΧ]\s*(\d+)\b/);
  if (one && Number(one[1]) > 1) return Number(one[1]);
  // 2β) «30ΑΔΑ», «12άδα» (αυγά κ.λπ.)
  const ada = s.match(/(?<![0-9])(\d{1,3})\s*-?\s*ΑΔ(Α|ΕΣ)(?![Α-ΩA-Z])/);
  if (ada && Number(ada[1]) > 1) return Number(ada[1]);
  // 3) «100T», «500TEM», «35 ΤΜΧ»
  const t = s.match(new RegExp(String.raw`\b(\d{1,4})\s*` + PCS));
  if (t && Number(t[1]) > 1) return Number(t[1]);
  // 4) «5Χ100» χωρίς μονάδα — αγνοούνται διαστάσεις (33Χ33, 220Χ7, 45Χ45ΜΕΤΡΑ)
  const ab = s.match(/\b(\d{1,2})\s*[*XΧ]\s*(\d{2,4})\b(?!\s*(?:[.,]\d|KG|ΚΙΛ|GR|ΓΡ|G\b|ML|LT|L\b|ΛΙΤ|ΜΕΤ|M\b|CM|ΕΚ|MM))/);
  if (ab && ab[1] !== ab[2]) { const n = Number(ab[1]) * Number(ab[2]); if (n > 1) return n; }
  return null;
}

// ── Προτάσεις ομάδας για υλικό χωρίς σύνδεση ──────────────────────────────

const STOP = new Set(["ΚΑΙ", "ΜΕ", "ΓΙΑ", "ΤΟΥ", "ΤΗΣ", "ΤΑ", "ΤΟ", "Η", "Ο", "ΣΕ", "ΑΠΟ", "ΦΡΕΣΚΟ", "ΦΡΕΣΚΙΑ", "ΦΡΕΣΚΟΣ"]);
function words(s: string): string[] {
  return normKey(s).replace(/[^A-ZΑ-Ω0-9 ]/g, " ").split(" ")
    .filter(w => w.length >= 3 && !STOP.has(w) && !/^\d/.test(w));
}
function stems(s: string): string[] {
  return words(s).map(w => w.slice(0, Math.max(4, Math.min(6, w.length - 2))));
}
// «Μακριά» ρίζα: όλη η λέξη χωρίς την κατάληξη (κρατά τη διαφορά ΚΟΥΒΕΡΤΟΥΡΑ ≠ ΚΟΥΒΕΡ)
function longStems(s: string): string[] {
  return words(s).map(w => w.slice(0, Math.max(4, w.length - 2)));
}

/** true αν η κύρια λέξη του υλικού ΔΕΝ υπάρχει στην ομάδα — πιθανό λάθος σύνδεσης.
 *  Αρκεί η 1η λέξη του υλικού να ταιριάζει με την 1η λέξη της ομάδας (π.χ. ΔΑΦΝΗ → ΔΑΦΝΗ ΦΥΛΛΟ = ΟΚ).
 */
export function linkLooksWrong(ingredientName: string, groupText: string): boolean {
  const t = normKey(groupText);
  const ls = longStems(ingredientName);
  if (ls.length === 0) return false;
  // Αν η 1η λέξη βρέθηκε στο κείμενο της ομάδας → ΟΚ
  if (t.includes(ls[0])) return false;
  // Επιπλέον: αν η 1η λέξη του υλικού ταιριάζει με τη 1η λέξη της ομάδας (stem) → ΟΚ
  const groupFirstWord = words(groupText)[0];
  if (groupFirstWord) {
    const groupFirstStem = groupFirstWord.slice(0, Math.max(4, groupFirstWord.length - 2));
    if (groupFirstStem === ls[0]) return false;
  }
  return true;
}

export interface GroupCandidate {
  key: string; label: string; sku: string | null; text: string; weight: number;
  norm?: string; normLabel?: string;   // προϋπολογισμένα (ταχύτητα)
}
export interface ScoredCandidate extends GroupCandidate { score: number; confidence: "high" | "medium" }

/**
 * Έως `n` προτεινόμενες ομάδες για ένα υλικό (με βάση κοινές ρίζες λέξεων).
 * «high»: όλες οι λέξεις του υλικού βρέθηκαν, το όνομα της ομάδας ξεκινά με
 * την 1η λέξη, και η 2η πρόταση δεν είναι εξίσου καλή (αλλιώς είναι αμφίβολο).
 */
export function suggestGroups(ingredientName: string, candidates: GroupCandidate[], n = 3): ScoredCandidate[] {
  const st = stems(ingredientName);
  const ls = longStems(ingredientName);
  if (st.length === 0) return [];
  const scored: { c: GroupCandidate; score: number; all: boolean; first: boolean }[] = [];
  for (const c of candidates) {
    const ct = c.norm ?? normKey(c.text);
    let hits = 0;
    for (const s of st) if (ct.includes(s)) hits++;
    if (!hits) continue;
    const first = (c.normLabel ?? normKey(c.label)).startsWith(st[0]);
    scored.push({ c, all: hits === st.length, first, score: hits / st.length + (first ? 0.5 : 0) + Math.log10(1 + c.weight) / 10 });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, n).map((x, i) => {
    const runnerUp = scored[1];
    const clearWinner = i === 0 && (!runnerUp || !(runnerUp.all && runnerUp.first) || runnerUp.score < x.score - 0.25);
    // «βέβαιη» μόνο αν και η ολόκληρη κύρια λέξη υπάρχει στην ομάδα (όχι μόνο τα 4-6 πρώτα γράμματα)
    const fullWord = (x.c.norm ?? normKey(x.c.text)).includes(ls[0]);
    return { ...x.c, score: x.score, confidence: x.all && x.first && clearWinner && fullWord ? "high" : "medium" };
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

// ── Αυτόματη πρόταση βάρους/όγκου συσκευασίας από το όνομα προϊόντος ──────
// «ΜΑΓΙΟΝΕΖΑ COLONA 5Lt» → 5000 · «MC CAIN (4x2.5Kg)» → 10000 ·
// «brioche 130γρμ 1*25» (ΚΙΒ) → 3250 · «ΚΕΤΣΑΠ 10ml 100T» (ΚΙΒ) → 1000.
const SIZE_RE = /(\d+(?:[.,]\d+)?)\s*(KGR|KG|ΚΙΛΑ|ΚΙΛΟ|ΚΙΛ|K|ΚG|Κ|GR|ΓΡΜ|ΓΡ|G|LTR|LIT|LT|L|ΛΙΤ|ML|ΜΛ)(?![A-ZΑ-Ω])/;
function toGrams(n: number, u: string): number {
  if (/^(KGR|KG|ΚΙΛΑ|ΚΙΛΟ|ΚΙΛ|K|ΚG|Κ|LTR|LIT|LT|L|ΛΙΤ)$/.test(u)) return n * 1000;
  return n; // γρ. ή ml
}
const num = (s: string) => Number(s.replace(",", "."));

/** Γραμμάρια/ml σε 1 μονάδα αγοράς, όπως φαίνονται στο όνομα — ή null. */
export function parsePackGrams(productName: string, purchaseUnit: string): number | null {
  const s = normKey(productName).replace(/[()"«»]/g, " ");
  const multi = ["ΚΙΒ", "ΚΟΥΤΙ", "ΠΑΚ", "ΚΑΡΤΕΛΑ"].includes(purchaseUnit);
  // στραγγισμένο βάρος (κονσέρβες): αυτό μπαίνει στη συνταγή
  const drained = s.match(new RegExp(String.raw`ΣΤΡ\.?\s*ΒΑΡ[Α-ΩA-Z]*\s*` + SIZE_RE.source));
  if (drained) return toGrams(num(drained[1]), drained[2]);
  // N x ΜΕΓΕΘΟΣ  (4x2.5Kg, 10 X 1kg, 6*1L)
  const nx = s.match(new RegExp(String.raw`(\d+)\s*[XΧ*]\s*` + SIZE_RE.source.slice(0)));
  if (nx) {
    const g = toGrams(num(nx[2]), nx[3]) * Number(nx[1]);
    return g > 0 ? g : null;
  }
  const m = s.match(SIZE_RE);
  if (!m) return null;
  let g = toGrams(num(m[1]), m[2]);
  if (multi) {
    // «130ΓΡΜ ... 1*25» ή «10ML 100T» → πλήθος τεμαχίων στο κιβώτιο
    const pcs = s.match(/\b1\s*[*XΧ]\s*(\d+)\b/) ?? s.match(/\b(\d{2,4})\s*(?:T|Τ|ΤΕΜ|TEM|ΤΜΧ)(?![A-ZΑ-Ω])/);
    if (pcs) g *= Number(pcs[1]);
  }
  return g > 0 ? g : null;
}

/** Μέσο βάρος σταθμισμένο με τις ποσότητες αγοράς (για ομάδα με πολλά μεγέθη). */
export function suggestPackGrams(products: { product: string; qty: number }[], purchaseUnit: string): { grams: number; parsed: number; total: number } | null {
  let w = 0, sum = 0, parsed = 0;
  const pieces = isPiecesKey(purchaseUnit);
  for (const p of products) {
    const g = pieces ? parsePackPieces(p.product) : parsePackGrams(p.product, purchaseUnit);
    if (g == null) continue;
    parsed++;
    const q = p.qty > 0 ? p.qty : 1;
    w += q; sum += g * q;
  }
  return parsed ? { grams: Math.round(sum / w), parsed, total: products.length } : null;
}

// ── Τυπικό βάρος 1 τεμαχίου (για συνταγές σε τεμάχια, αγορά σε κιλό) ──────
// Ενδεικτικές τιμές κουζίνας — ο χρήστης τις ελέγχει/αλλάζει πριν τις αποθηκεύσει.
const TYPICAL_PIECE_GRAMS: [RegExp, number][] = [
  [/ΠΙΠΕΡΙ(Α|ΕΣ)? (ΚΟΚΚ|ΚΙΤΡ|ΠΡΑΣ|ΦΛΩΡ|ΧΟΝΤΡ)|ΠΙΠΕΡΙΑ|ΠΙΠΕΡΙΕΣ/, 180],
  [/ΝΤΟΜΑΤΙΝΙ|ΤΟΜΑΤΙΝΙ|CHERRY/, 15],
  [/ΝΤΟΜΑΤ/, 150],
  [/ΑΓΓΟΥΡ/, 300],
  [/ΛΕΜΟΝ/, 120],
  [/ΛΑΙΜ|LIME/, 70],
  [/ΠΟΡΤΟΚΑΛ/, 200],
  [/ΜΗΛ(Α|Ο)/, 180],
  [/ΑΧΛΑΔ/, 180],
  [/ΜΠΑΝΑΝ/, 120],
  [/ΑΒΟΚΑΝΤΟ/, 200],
  [/ΑΥΓ(Α|Ο)/, 60],
  [/ΣΚΟΡΔ/, 50],
  [/ΚΡΕΜΜΥΔΑΚ/, 20],
  [/ΚΡΕΜΜΥΔ/, 150],
  [/ΓΛΥΚΟΠΑΤΑΤ/, 250],
  [/ΠΑΤΑΤ/, 200],
  [/ΚΑΡΟΤ/, 100],
  [/ΜΕΛΙΤΖΑΝ/, 300],
  [/ΚΟΛΟΚΥΘΑΚ|ΚΟΛΟΚΥΘΙ/, 250],
  [/ΜΑΡΟΥΛ/, 400],
  [/ΙCEBERG|ΑΙΣΜΠΕΡΓΚ|ICEBERG/, 500],
  [/ΜΑΝΙΤΑΡ/, 20],
  [/ΣΕΛΙΝΟ/, 400],
  [/ΠΡΑΣΟ/, 250],
  [/ΚΑΡΠΟΥΖ/, 5000],
  [/ΠΕΠΟΝ/, 1500],
  [/ΑΝΑΝΑ/, 1200],
  [/ΜΑΝΓΚΟ|MANGO/, 300],
  [/ΑΚΤΙΝΙΔ/, 90],
  [/ΡΟΔΑΚΙΝ|ΝΕΚΤΑΡΙΝ/, 150],
];

/** Τυπικό βάρος ενός τεμαχίου για το όνομα (ομάδας ή υλικού) — ή null. */
export function typicalPieceGrams(...names: string[]): number | null {
  for (const n of names) {
    const s = normKey(n);
    for (const [re, g] of TYPICAL_PIECE_GRAMS) if (re.test(s)) return g;
  }
  return null;
}
