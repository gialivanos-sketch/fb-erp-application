"use client";
import { useState, useMemo, useRef } from "react";
import { useApp } from "@/lib/context";
import { createReservation, createReservationsBulk, deleteReservation, deleteReservationsByDate } from "@/lib/supabaseData";
import type { Reservation, MealType, BoardType } from "@/lib/types";
import * as XLSX from "xlsx";

const MEALS: { key: MealType; gr: string; en: string; icon: string }[] = [
  { key: "breakfast", gr: "Πρωινό", en: "Breakfast", icon: "☀️" },
  { key: "lunch", gr: "Μεσημεριανό", en: "Lunch", icon: "🍽️" },
  { key: "dinner", gr: "Βραδινό", en: "Dinner", icon: "🌙" },
];

const BOARD_TYPES: { key: BoardType; gr: string; en: string }[] = [
  { key: "BB", gr: "Πρωινό (BB)", en: "Bed & Breakfast" },
  { key: "HB", gr: "Ημιδιατροφή (HB)", en: "Half Board" },
  { key: "FB", gr: "Πλήρης (FB)", en: "Full Board" },
  { key: "AI", gr: "All Inclusive (AI)", en: "All Inclusive" },
];

// Which board types contribute to which meals
const BOARD_MEAL_MAP: Record<BoardType, MealType[]> = {
  BB: ["breakfast"],
  HB: ["breakfast", "dinner"],
  FB: ["breakfast", "lunch", "dinner"],
  AI: ["breakfast", "lunch", "dinner"],
};

/** Get ISO week number of date */
function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

/** Map ISO week to cycle week 1-4 */
function toCycleWeek(date: string): number {
  const d = new Date(date);
  return ((getISOWeek(d) - 1) % 4) + 1;
}

function formatDate(iso: string, locale: string) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(locale === "gr" ? "el-GR" : "en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// ── Excel parsing ─────────────────────────────────────────────
// Expected columns (flexible): Ημερομηνία | Γεύμα | Τύπος Διατροφής | Πλήθος
// Also supports: Date | Meal | Board | Pax
interface ExcelRow {
  date: string;
  mealType: MealType;
  boardType: BoardType;
  pax: number;
}

function parseExcelFile(file: File): Promise<{ rows: ExcelRow[]; errors: string[] }> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array", cellDates: true });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

        const errors: string[] = [];
        const rows: ExcelRow[] = [];

        // Detect header aliases
        const headerMap = (key: string): string => {
          const k = String(key).toLowerCase().trim();
          if (k.includes("ημερ") || k.includes("date")) return "date";
          if (k.includes("γεύμ") || k.includes("meal") || k.includes("γευμ")) return "meal";
          if (k.includes("τύπ") || k.includes("board") || k.includes("τυπ") || k.includes("διατρ")) return "board";
          if (k.includes("πλήθ") || k.includes("pax") || k.includes("ατομ") || k.includes("count") || k.includes("αριθ")) return "pax";
          return k;
        };

        const mealMap: Record<string, MealType> = {
          "πρωινό": "breakfast", "πρωινο": "breakfast", "breakfast": "breakfast", "b": "breakfast",
          "μεσημεριανό": "lunch", "μεσημεριανο": "lunch", "lunch": "lunch", "l": "lunch", "γεύμα": "lunch",
          "βραδινό": "dinner", "βραδινο": "dinner", "dinner": "dinner", "d": "dinner",
        };
        const boardMap: Record<string, BoardType> = {
          "bb": "BB", "πρωινό": "BB",
          "hb": "HB", "ημιδιατροφή": "HB", "ημιδιατροφη": "HB",
          "fb": "FB", "πλήρης": "FB", "πληρης": "FB",
          "ai": "AI", "all inclusive": "AI", "all-inclusive": "AI",
        };

        for (let i = 0; i < raw.length; i++) {
          const rawRow = raw[i];
          const mapped: Record<string, unknown> = {};
          for (const k in rawRow) mapped[headerMap(k)] = rawRow[k];

          // Parse date
          let dateStr = "";
          const rawDate = mapped["date"];
          if (rawDate instanceof Date) {
            dateStr = rawDate.toISOString().slice(0, 10);
          } else if (typeof rawDate === "string" && rawDate) {
            // Try DD/MM/YYYY or YYYY-MM-DD
            const parts = rawDate.split(/[\/\-\.]/);
            if (parts.length === 3) {
              const [a, b, c] = parts;
              if (a.length === 4) {
                dateStr = `${a}-${b.padStart(2,"0")}-${c.padStart(2,"0")}`;
              } else {
                dateStr = `${c}-${b.padStart(2,"0")}-${a.padStart(2,"0")}`;
              }
            }
          } else if (typeof rawDate === "number") {
            // Excel serial date
            const d = XLSX.SSF.parse_date_code(rawDate);
            if (d) dateStr = `${d.y}-${String(d.m).padStart(2,"0")}-${String(d.d).padStart(2,"0")}`;
          }

          if (!dateStr) { errors.push(`Γραμμή ${i+2}: μη έγκυρη ημερομηνία`); continue; }

          // Parse meal
          const mealRaw = String(mapped["meal"] ?? "").toLowerCase().trim();
          const mealType = mealMap[mealRaw];
          if (!mealType) { errors.push(`Γραμμή ${i+2}: άγνωστο γεύμα "${mapped["meal"]}"`); continue; }

          // Parse board type
          const boardRaw = String(mapped["board"] ?? "").toLowerCase().trim();
          const boardType = boardMap[boardRaw];
          if (!boardType) { errors.push(`Γραμμή ${i+2}: άγνωστος τύπος διατροφής "${mapped["board"]}"`); continue; }

          // Parse pax
          const pax = parseInt(String(mapped["pax"] ?? "0"), 10);
          if (isNaN(pax) || pax <= 0) { errors.push(`Γραμμή ${i+2}: μη έγκυρος αριθμός ατόμων`); continue; }

          rows.push({ date: dateStr, mealType, boardType, pax });
        }

        resolve({ rows, errors });
      } catch (e) {
        resolve({ rows: [], errors: [String(e)] });
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

export default function ReservationsPage() {
  const { data, refreshAll, locale } = useApp();
  const reservations = data.reservations;

  // ── Filter ──────────────────────────────────────────────────
  const [filterWeek, setFilterWeek] = useState<string>("all");
  const [filterMeal, setFilterMeal] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"table" | "weekly">("weekly");

  // ── Manual form ─────────────────────────────────────────────
  const [showManual, setShowManual] = useState(false);
  const [manualDate, setManualDate] = useState(new Date().toISOString().slice(0, 10));
  const [manualMeal, setManualMeal] = useState<MealType>("breakfast");
  const [manualBoard, setManualBoard] = useState<BoardType>("HB");
  const [manualPax, setManualPax] = useState("0");
  const [manualSaving, setManualSaving] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);

  // ── Excel import ─────────────────────────────────────────────
  const fileRef = useRef<HTMLInputElement>(null);
  const [importPreview, setImportPreview] = useState<ExcelRow[] | null>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  const mealLabel = (m: MealType) => MEALS.find(x => x.key === m)!;
  const boardLabel = (b: BoardType) => BOARD_TYPES.find(x => x.key === b)!;

  // ── Filtered reservations ────────────────────────────────────
  const filtered = useMemo(() => {
    let r = [...reservations];
    if (filterMeal !== "all") r = r.filter(x => x.mealType === filterMeal);
    if (filterWeek !== "all") r = r.filter(x => String(x.weekNumber) === filterWeek);
    return r.sort((a, b) => a.reservationDate.localeCompare(b.reservationDate));
  }, [reservations, filterMeal, filterWeek]);

  // ── Weekly summary (unique dates × meals) ───────────────────
  const weeklySummary = useMemo(() => {
    const byDate: Record<string, Record<MealType, Record<BoardType, number>>> = {};
    for (const r of filtered) {
      if (!byDate[r.reservationDate]) byDate[r.reservationDate] = { breakfast: {} as Record<BoardType, number>, lunch: {} as Record<BoardType, number>, dinner: {} as Record<BoardType, number> };
      if (!byDate[r.reservationDate][r.mealType][r.boardType]) byDate[r.reservationDate][r.mealType][r.boardType] = 0;
      byDate[r.reservationDate][r.mealType][r.boardType] += r.pax;
    }
    return Object.entries(byDate).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  // ── KPIs ─────────────────────────────────────────────────────
  const totalPax = useMemo(() => filtered.reduce((s, r) => s + r.pax, 0), [filtered]);
  const uniqueDates = useMemo(() => new Set(filtered.map(r => r.reservationDate)).size, [filtered]);

  async function handleManualSave() {
    const paxNum = parseInt(manualPax, 10);
    if (!paxNum || paxNum <= 0) { setManualError("Μη έγκυρος αριθμός ατόμων"); return; }
    setManualSaving(true); setManualError(null);
    try {
      await createReservation({
        reservationDate: manualDate,
        mealType: manualMeal,
        boardType: manualBoard,
        pax: paxNum,
        source: "manual",
        weekNumber: toCycleWeek(manualDate),
        notes: null,
      });
      await refreshAll();
      setManualPax("0");
    } catch (e) {
      setManualError(e instanceof Error ? e.message : String(e));
    } finally {
      setManualSaving(false);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm(locale === "gr" ? "Διαγραφή κράτησης;" : "Delete reservation?")) return;
    try { await deleteReservation(id); await refreshAll(); } catch {}
  }

  async function handleDeleteByDate(date: string) {
    if (!confirm(locale === "gr" ? `Διαγραφή ΟΛΩΝ των κρατήσεων για ${formatDate(date, locale)};` : `Delete ALL reservations for ${formatDate(date, locale)}?`)) return;
    try { await deleteReservationsByDate(date); await refreshAll(); } catch {}
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportMsg(null);
    const { rows, errors } = await parseExcelFile(file);
    setImportPreview(rows);
    setImportErrors(errors);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function handleImport() {
    if (!importPreview?.length) return;
    setImporting(true); setImportMsg(null);
    try {
      const toInsert = importPreview.map(r => ({
        reservationDate: r.date,
        mealType: r.mealType,
        boardType: r.boardType,
        pax: r.pax,
        source: "excel_import" as const,
        weekNumber: toCycleWeek(r.date),
        notes: null,
      }));
      await createReservationsBulk(toInsert);
      await refreshAll();
      setImportMsg(locale === "gr" ? `✅ Εισήχθησαν ${toInsert.length} εγγραφές` : `✅ Imported ${toInsert.length} records`);
      setImportPreview(null);
    } catch (e) {
      setImportMsg(`❌ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">🏨 {locale === "gr" ? "Κρατήσεις Μπουφέ" : "Buffet Reservations"}</h1>
          <p className="text-slate-400 text-sm mt-1">
            {locale === "gr" ? "Εισαγωγή από Excel · χειροκίνητη καταχώριση · ημερήσια εικόνα" : "Excel import · manual entry · daily overview"}
          </p>
        </div>
        <div className="flex gap-3">
          <button onClick={() => setShowManual(v => !v)} className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700 transition-all">
            + {locale === "gr" ? "Χειροκίνητη Εγγραφή" : "Manual Entry"}
          </button>
          <label className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-all cursor-pointer">
            📥 Import Excel
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFileChange} />
          </label>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
          <div className="text-slate-400 text-sm">{locale === "gr" ? "Συνολικά Άτομα" : "Total Pax"}</div>
          <div className="text-3xl font-bold text-blue-400 mt-1">{totalPax.toLocaleString()}</div>
        </div>
        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
          <div className="text-slate-400 text-sm">{locale === "gr" ? "Ημέρες" : "Days"}</div>
          <div className="text-3xl font-bold text-emerald-400 mt-1">{uniqueDates}</div>
        </div>
        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
          <div className="text-slate-400 text-sm">{locale === "gr" ? "Εγγραφές" : "Records"}</div>
          <div className="text-3xl font-bold text-amber-400 mt-1">{filtered.length}</div>
        </div>
      </div>

      {/* Manual form */}
      {showManual && (
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-5 mb-5">
          <h3 className="text-white font-semibold mb-4">➕ {locale === "gr" ? "Νέα Κράτηση" : "New Reservation"}</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="text-slate-400 text-xs block mb-1">{locale === "gr" ? "Ημερομηνία" : "Date"}</label>
              <input type="date" value={manualDate} onChange={e => setManualDate(e.target.value)}
                className="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm border border-slate-600 focus:border-blue-500 focus:outline-none" />
            </div>
            <div>
              <label className="text-slate-400 text-xs block mb-1">{locale === "gr" ? "Γεύμα" : "Meal"}</label>
              <select value={manualMeal} onChange={e => setManualMeal(e.target.value as MealType)}
                className="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm border border-slate-600 focus:border-blue-500 focus:outline-none">
                {MEALS.map(m => <option key={m.key} value={m.key}>{locale === "gr" ? m.gr : m.en}</option>)}
              </select>
            </div>
            <div>
              <label className="text-slate-400 text-xs block mb-1">{locale === "gr" ? "Τύπος Διατροφής" : "Board Type"}</label>
              <select value={manualBoard} onChange={e => setManualBoard(e.target.value as BoardType)}
                className="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm border border-slate-600 focus:border-blue-500 focus:outline-none">
                {BOARD_TYPES.map(b => <option key={b.key} value={b.key}>{locale === "gr" ? b.gr : b.en}</option>)}
              </select>
            </div>
            <div>
              <label className="text-slate-400 text-xs block mb-1">{locale === "gr" ? "Άτομα (pax)" : "Pax"}</label>
              <input type="number" value={manualPax} onChange={e => setManualPax(e.target.value)} min="0"
                className="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm border border-slate-600 focus:border-blue-500 focus:outline-none" />
            </div>
          </div>
          {manualError && <div className="text-red-400 text-sm mt-2">⚠️ {manualError}</div>}
          <div className="flex gap-3 mt-4">
            <button onClick={handleManualSave} disabled={manualSaving}
              className="px-5 py-2 bg-emerald-600 text-white rounded-lg font-semibold text-sm hover:bg-emerald-700 disabled:opacity-50 transition-all">
              {manualSaving ? "⏳..." : `💾 ${locale === "gr" ? "Αποθήκευση" : "Save"}`}
            </button>
            <button onClick={() => setShowManual(false)} className="px-4 py-2 bg-slate-700 text-slate-300 rounded-lg text-sm hover:bg-slate-600 transition-all">
              {locale === "gr" ? "Κλείσιμο" : "Close"}
            </button>
          </div>
        </div>
      )}

      {/* Import preview */}
      {importPreview && (
        <div className="bg-slate-800 rounded-xl border border-amber-500/30 p-5 mb-5">
          <h3 className="text-amber-400 font-semibold mb-3">📋 {locale === "gr" ? `Προεπισκόπηση (${importPreview.length} γραμμές)` : `Preview (${importPreview.length} rows)`}</h3>
          {importErrors.length > 0 && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-3">
              <div className="text-red-400 text-sm font-semibold mb-1">{locale === "gr" ? "Σφάλματα:" : "Errors:"}</div>
              {importErrors.slice(0, 5).map((e, i) => <div key={i} className="text-red-400 text-xs">{e}</div>)}
              {importErrors.length > 5 && <div className="text-red-400 text-xs">…και {importErrors.length - 5} ακόμα</div>}
            </div>
          )}
          <div className="overflow-auto max-h-48 mb-3">
            <table className="w-full text-sm">
              <thead><tr className="text-slate-400 text-xs">
                <th className="text-left py-1 pr-3">{locale === "gr" ? "Ημ/νία" : "Date"}</th>
                <th className="text-left py-1 pr-3">{locale === "gr" ? "Γεύμα" : "Meal"}</th>
                <th className="text-left py-1 pr-3">{locale === "gr" ? "Τύπος" : "Board"}</th>
                <th className="text-right py-1">Pax</th>
              </tr></thead>
              <tbody>
                {importPreview.slice(0, 20).map((r, i) => (
                  <tr key={i} className="border-t border-slate-700/50">
                    <td className="py-1 pr-3 text-white">{formatDate(r.date, locale)}</td>
                    <td className="py-1 pr-3 text-slate-300">{mealLabel(r.mealType)[locale === "gr" ? "gr" : "en"]}</td>
                    <td className="py-1 pr-3 text-slate-300">{r.boardType}</td>
                    <td className="py-1 text-right text-emerald-400 font-mono">{r.pax}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {importPreview.length > 20 && <div className="text-slate-500 text-xs mt-1">…και {importPreview.length - 20} ακόμα γραμμές</div>}
          </div>
          {importMsg && <div className={`text-sm mb-2 ${importMsg.startsWith("✅") ? "text-emerald-400" : "text-red-400"}`}>{importMsg}</div>}
          <div className="flex gap-3">
            <button onClick={handleImport} disabled={importing}
              className="px-5 py-2 bg-blue-600 text-white rounded-lg font-semibold text-sm hover:bg-blue-700 disabled:opacity-50 transition-all">
              {importing ? "⏳..." : `📥 ${locale === "gr" ? `Εισαγωγή ${importPreview.length} εγγραφών` : `Import ${importPreview.length} records`}`}
            </button>
            <button onClick={() => { setImportPreview(null); setImportErrors([]); setImportMsg(null); }}
              className="px-4 py-2 bg-slate-700 text-slate-300 rounded-lg text-sm hover:bg-slate-600 transition-all">
              {locale === "gr" ? "Ακύρωση" : "Cancel"}
            </button>
          </div>
        </div>
      )}
      {importMsg && !importPreview && <div className={`text-sm mb-4 ${importMsg.startsWith("✅") ? "text-emerald-400" : "text-red-400"}`}>{importMsg}</div>}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <select value={filterWeek} onChange={e => setFilterWeek(e.target.value)}
          className="bg-slate-800 text-white rounded-lg px-3 py-2 text-sm border border-slate-700 focus:border-blue-500 focus:outline-none">
          <option value="all">{locale === "gr" ? "Όλες οι εβδομάδες" : "All weeks"}</option>
          {[1,2,3,4].map(w => <option key={w} value={w}>{locale === "gr" ? `Εβδ. κύκλου ${w}` : `Cycle week ${w}`}</option>)}
        </select>
        <select value={filterMeal} onChange={e => setFilterMeal(e.target.value)}
          className="bg-slate-800 text-white rounded-lg px-3 py-2 text-sm border border-slate-700 focus:border-blue-500 focus:outline-none">
          <option value="all">{locale === "gr" ? "Όλα τα γεύματα" : "All meals"}</option>
          {MEALS.map(m => <option key={m.key} value={m.key}>{locale === "gr" ? m.gr : m.en}</option>)}
        </select>
        <div className="flex gap-1 ml-auto">
          <button onClick={() => setViewMode("weekly")} className={`px-3 py-2 rounded-lg text-sm font-semibold transition-all ${viewMode === "weekly" ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}>
            📅 {locale === "gr" ? "Εβδομαδιαία" : "Weekly"}
          </button>
          <button onClick={() => setViewMode("table")} className={`px-3 py-2 rounded-lg text-sm font-semibold transition-all ${viewMode === "table" ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}>
            📋 {locale === "gr" ? "Πίνακας" : "Table"}
          </button>
        </div>
      </div>

      {/* Weekly view */}
      {viewMode === "weekly" && (
        <div className="space-y-3">
          {weeklySummary.length === 0 ? (
            <div className="text-center py-16 text-slate-500 bg-slate-800 rounded-xl border border-slate-700">
              <div className="text-4xl mb-3">🏨</div>
              <div>{locale === "gr" ? "Δεν υπάρχουν κρατήσεις" : "No reservations"}</div>
              <div className="text-sm mt-1">{locale === "gr" ? "Εισάγετε από Excel ή προσθέστε χειροκίνητα" : "Import from Excel or add manually"}</div>
            </div>
          ) : weeklySummary.map(([date, byMeal]) => (
            <div key={date} className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3 border-b border-slate-700 bg-slate-800/80">
                <div className="flex items-center gap-3">
                  <span className="text-white font-bold">{formatDate(date, locale)}</span>
                  <span className="text-slate-400 text-xs bg-slate-700 px-2 py-0.5 rounded">
                    {locale === "gr" ? `Εβδ. κύκλου ${toCycleWeek(date)}` : `Cycle week ${toCycleWeek(date)}`}
                  </span>
                </div>
                <button onClick={() => handleDeleteByDate(date)} className="text-red-400 hover:text-red-300 text-xs px-2 py-1 rounded hover:bg-red-500/10 transition-all">
                  🗑️ {locale === "gr" ? "Διαγραφή ημέρας" : "Delete day"}
                </button>
              </div>
              <div className="grid grid-cols-3 divide-x divide-slate-700">
                {MEALS.map(meal => {
                  const boards = byMeal[meal.key] ?? {};
                  const totalPaxMeal = Object.values(boards).reduce((s, n) => s + n, 0);
                  return (
                    <div key={meal.key} className="p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <span>{meal.icon}</span>
                        <span className="text-white text-sm font-semibold">{locale === "gr" ? meal.gr : meal.en}</span>
                        {totalPaxMeal > 0 && (
                          <span className="ml-auto text-emerald-400 font-bold text-lg">{totalPaxMeal}</span>
                        )}
                      </div>
                      {totalPaxMeal > 0 ? (
                        <div className="space-y-1">
                          {(Object.entries(boards) as [BoardType, number][]).map(([bt, pax]) => (
                            <div key={bt} className="flex items-center justify-between text-xs">
                              <span className="text-slate-400">{bt}</span>
                              <span className="text-white">{pax} {locale === "gr" ? "άτ." : "pax"}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-slate-600 text-xs">—</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Table view */}
      {viewMode === "table" && (
        <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
          {filtered.length === 0 ? (
            <div className="text-center py-16 text-slate-500">
              <div className="text-4xl mb-3">🏨</div>
              <div>{locale === "gr" ? "Δεν υπάρχουν κρατήσεις" : "No reservations"}</div>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700 text-slate-400 text-xs uppercase">
                  <th className="text-left px-4 py-3">{locale === "gr" ? "Ημερομηνία" : "Date"}</th>
                  <th className="text-left px-4 py-3">{locale === "gr" ? "Εβδ." : "Week"}</th>
                  <th className="text-left px-4 py-3">{locale === "gr" ? "Γεύμα" : "Meal"}</th>
                  <th className="text-left px-4 py-3">{locale === "gr" ? "Τύπος" : "Board"}</th>
                  <th className="text-right px-4 py-3">Pax</th>
                  <th className="text-center px-4 py-3">{locale === "gr" ? "Πηγή" : "Source"}</th>
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.id} className="border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors">
                    <td className="px-4 py-3 text-white">{formatDate(r.reservationDate, locale)}</td>
                    <td className="px-4 py-3 text-slate-400 text-xs">Εβδ.{r.weekNumber}</td>
                    <td className="px-4 py-3 text-slate-300">{mealLabel(r.mealType).icon} {locale === "gr" ? mealLabel(r.mealType).gr : mealLabel(r.mealType).en}</td>
                    <td className="px-4 py-3">
                      <span className="text-xs px-2 py-0.5 rounded bg-slate-700 text-slate-300">{r.boardType}</span>
                    </td>
                    <td className="px-4 py-3 text-right text-emerald-400 font-bold font-mono">{r.pax}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded ${r.source === "excel_import" ? "bg-blue-500/20 text-blue-400" : "bg-amber-500/20 text-amber-400"}`}>
                        {r.source === "excel_import" ? "Excel" : locale === "gr" ? "Χειρ." : "Manual"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={() => handleDelete(r.id)} className="text-red-400 hover:text-red-300 text-xs">✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Excel format help */}
      <div className="mt-6 bg-slate-800/50 rounded-xl border border-slate-700/50 p-4">
        <div className="text-slate-400 text-xs font-semibold uppercase mb-2">📖 {locale === "gr" ? "Μορφή αρχείου Excel" : "Excel file format"}</div>
        <div className="text-slate-500 text-xs">
          {locale === "gr"
            ? "Στήλες (ελληνικά ή αγγλικά): Ημερομηνία | Γεύμα | Τύπος Διατροφής | Άτομα"
            : "Columns (Greek or English): Date | Meal | Board Type | Pax"}
        </div>
        <div className="text-slate-500 text-xs mt-1">
          {locale === "gr"
            ? "Γεύμα: Πρωινό / Μεσημεριανό / Βραδινό · Τύπος: BB / HB / FB / AI"
            : "Meal: Breakfast / Lunch / Dinner · Board: BB / HB / FB / AI"}
        </div>
      </div>
    </div>
  );
}
