"use client";
import { useState, useMemo } from "react";
import { useApp } from "@/lib/context";
import type { Reservation, BuffetCycleEntry, InternalTransfer } from "@/lib/types";

// ── constants ────────────────────────────────────────────────
const DAY_NAMES = ["", "Δευ", "Τρί", "Τετ", "Πέμ", "Παρ", "Σάβ", "Κυρ"];
const MEAL_LABEL: Record<string, string> = { breakfast: "Πρωινό", lunch: "Μεσημεριανό", dinner: "Δείπνο" };
const BOARD_MEALS: Record<string, string[]> = {
  BB: ["breakfast"],
  HB: ["breakfast", "dinner"],
  FB: ["breakfast", "lunch", "dinner"],
  AI: ["breakfast", "lunch", "dinner"],
};

// ── helpers ──────────────────────────────────────────────────
function isoWeekday(dateStr: string): number {
  const d = new Date(dateStr + "T12:00:00Z");
  const day = d.getUTCDay();
  return day === 0 ? 7 : day; // 1=Mon..7=Sun
}

// ISO week → cycle week 1-4
function toCycleWeek(dateStr: string): 1 | 2 | 3 | 4 {
  const d = new Date(dateStr + "T12:00:00Z");
  const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const startOfWeek1 = new Date(jan4);
  startOfWeek1.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7));
  const diff = d.getTime() - startOfWeek1.getTime();
  const isoWeek = Math.floor(diff / (7 * 86400000)) + 1;
  return (((isoWeek - 1) % 4) + 1) as 1 | 2 | 3 | 4;
}

function fmt2(n: number) { return n.toFixed(2); }
function fmtKg(n: number) { return n < 1 ? `${(n * 1000).toFixed(0)}g` : `${n.toFixed(1)}kg`; }
function pct(actual: number, theoretical: number): number {
  if (theoretical === 0) return 0;
  return ((actual - theoretical) / theoretical) * 100;
}
function pctColor(p: number): string {
  if (p > 15) return "text-red-600 dark:text-red-400";
  if (p > 5) return "text-amber-600 dark:text-amber-400";
  if (p < -10) return "text-blue-600 dark:text-blue-400";
  return "text-emerald-600 dark:text-emerald-400";
}
function pctBg(p: number): string {
  if (p > 15) return "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800";
  if (p > 5) return "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800";
  return "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800";
}

// ── types ────────────────────────────────────────────────────
interface DishLine {
  dishName: string;
  dishCategory: string;
  unit: string;
  theoreticalKg: number;   // pax × kgPerPerson
  actualKg: number;        // from transfers (matched by name)
  deviation: number;       // %
  pax: number;
  kgPerPerson: number;
}

interface DayReport {
  date: string;
  mealType: string;
  pax: number;
  weekNumber: 1 | 2 | 3 | 4;
  weekday: number;
  dishes: DishLine[];
  totalTheoretical: number;
  totalActual: number;
  totalDeviation: number;
}

// ── main component ───────────────────────────────────────────
export default function FoodCostPage() {
  const { data } = useApp();

  const reservations: Reservation[] = data.reservations ?? [];
  const cycleEntries: BuffetCycleEntry[] = data.buffetCycleEntries ?? [];
  const transfers: InternalTransfer[] = data.internalTransfers ?? [];

  // ── filters ─────────────────────────────────────────────────
  const today = new Date().toISOString().split("T")[0];
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0];
  const [dateFrom, setDateFrom] = useState(thirtyDaysAgo);
  const [dateTo, setDateTo] = useState(today);
  const [mealFilter, setMealFilter] = useState<string>("all");
  const [activeTab, setActiveTab] = useState<"daily" | "alerts" | "weekly">("daily");

  // ── build a lookup: cycleEntry by (weekNumber, dayOfWeek, mealType) ─
  const cycleMap = useMemo(() => {
    const m = new Map<string, BuffetCycleEntry>();
    for (const e of cycleEntries) {
      m.set(`${e.weekNumber}-${e.dayOfWeek}-${e.mealType}`, e);
    }
    return m;
  }, [cycleEntries]);

  // ── build actual consumption lookup: date → Map<productName, totalKg> ─
  const actualByDate = useMemo(() => {
    const m = new Map<string, Map<string, number>>();
    for (const t of transfers) {
      const date = t.transferDate;
      if (!m.has(date)) m.set(date, new Map());
      const dayMap = m.get(date)!;
      for (const item of t.items) {
        const key = item.ingredientName.toLowerCase().trim();
        dayMap.set(key, (dayMap.get(key) ?? 0) + item.quantity);
      }
    }
    return m;
  }, [transfers]);

  // ── compute daily reports ────────────────────────────────────
  const dayReports = useMemo((): DayReport[] => {
    const reports: DayReport[] = [];

    // Group reservations by date + mealType
    const resGroups = new Map<string, number>(); // "date|meal" → total pax
    for (const r of reservations) {
      if (r.reservationDate < dateFrom || r.reservationDate > dateTo) continue;
      const mealsForBoard = BOARD_MEALS[r.boardType] ?? [];
      for (const meal of mealsForBoard) {
        if (mealFilter !== "all" && meal !== mealFilter) continue;
        const key = `${r.reservationDate}|${meal}`;
        resGroups.set(key, (resGroups.get(key) ?? 0) + r.pax);
      }
    }

    for (const [key, pax] of resGroups) {
      const [date, mealType] = key.split("|");
      const weekday = isoWeekday(date);
      const weekNumber = toCycleWeek(date);
      const entry = cycleMap.get(`${weekNumber}-${weekday}-${mealType}`);

      const actualDayMap = actualByDate.get(date) ?? new Map<string, number>();

      const dishes: DishLine[] = [];
      if (entry) {
        for (const dish of entry.dishes) {
          const theoreticalKg = dish.kgPerPerson * pax;
          const matchKey = dish.dishName.toLowerCase().trim();
          const actualKg = actualDayMap.get(matchKey) ?? 0;
          const deviation = pct(actualKg, theoreticalKg);
          dishes.push({
            dishName: dish.dishName,
            dishCategory: dish.dishCategory,
            unit: dish.unit,
            theoreticalKg,
            actualKg,
            deviation,
            pax,
            kgPerPerson: dish.kgPerPerson,
          });
        }
      }

      const totalTheoretical = dishes.reduce((s, d) => s + d.theoreticalKg, 0);
      const totalActual = dishes.reduce((s, d) => s + d.actualKg, 0);
      const totalDeviation = pct(totalActual, totalTheoretical);

      reports.push({ date, mealType, pax, weekNumber, weekday, dishes, totalTheoretical, totalActual, totalDeviation });
    }

    return reports.sort((a, b) => a.date.localeCompare(b.date) || a.mealType.localeCompare(b.mealType));
  }, [reservations, cycleEntries, transfers, dateFrom, dateTo, mealFilter, cycleMap, actualByDate]);

  // ── TOP 5 alert items (highest positive deviation across all days) ─
  const alertItems = useMemo(() => {
    const allDishes: (DishLine & { date: string; mealType: string })[] = [];
    for (const day of dayReports) {
      for (const dish of day.dishes) {
        if (dish.theoreticalKg > 0) {
          allDishes.push({ ...dish, date: day.date, mealType: day.mealType });
        }
      }
    }
    return allDishes
      .filter(d => d.deviation > 5)
      .sort((a, b) => b.deviation - a.deviation)
      .slice(0, 10);
  }, [dayReports]);

  // ── weekly summary ───────────────────────────────────────────
  const weeklySummary = useMemo(() => {
    const map = new Map<string, { pax: number; theoretical: number; actual: number; days: Set<string> }>();
    for (const day of dayReports) {
      const d = new Date(day.date + "T12:00:00Z");
      // ISO week label
      const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
      const startOfWeek1 = new Date(jan4);
      startOfWeek1.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7));
      const diff = d.getTime() - startOfWeek1.getTime();
      const isoWeek = Math.floor(diff / (7 * 86400000)) + 1;
      const weekKey = `${d.getUTCFullYear()}-W${String(isoWeek).padStart(2, "0")}`;

      const existing = map.get(weekKey) ?? { pax: 0, theoretical: 0, actual: 0, days: new Set<string>() };
      existing.pax += day.pax;
      existing.theoretical += day.totalTheoretical;
      existing.actual += day.totalActual;
      existing.days.add(day.date);
      map.set(weekKey, existing);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [dayReports]);

  // ── KPIs ─────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const totalPax = new Map<string, number>();
    let totalTheoretical = 0;
    let totalActual = 0;
    let daysWithData = 0;

    for (const day of dayReports) {
      totalPax.set(day.date, (totalPax.get(day.date) ?? 0) + day.pax);
      totalTheoretical += day.totalTheoretical;
      totalActual += day.totalActual;
      if (day.dishes.length > 0) daysWithData++;
    }

    const avgPax = totalPax.size > 0 ? [...totalPax.values()].reduce((s, v) => s + v, 0) / totalPax.size : 0;
    return {
      days: totalPax.size,
      avgPax: Math.round(avgPax),
      totalTheoretical,
      totalActual,
      overallDeviation: pct(totalActual, totalTheoretical),
      alerts: alertItems.length,
      daysWithData,
    };
  }, [dayReports, alertItems]);

  // ── render ───────────────────────────────────────────────────
  return (
    <div className="p-4 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">📊 Food Cost Report</h1>
        <p className="text-sm text-gray-500 mt-1">Θεωρητική vs Πραγματική κατανάλωση μπουφέ — αποκλίσεις ανά πιάτο</p>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-5">
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">ΑΠΟ</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-white" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">ΕΩΣ</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-white" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">ΓΕΥΜΑ</label>
            <select value={mealFilter} onChange={e => setMealFilter(e.target.value)}
              className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-white">
              <option value="all">Όλα</option>
              <option value="breakfast">Πρωινό</option>
              <option value="lunch">Μεσημεριανό</option>
              <option value="dinner">Δείπνο</option>
            </select>
          </div>
          <div className="flex gap-2">
            <button onClick={() => { const d = new Date(); setDateFrom(d.toISOString().split("T")[0]); setDateTo(d.toISOString().split("T")[0]); }}
              className="text-xs px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700">
              Σήμερα
            </button>
            <button onClick={() => { const d = new Date(); const s = new Date(d); s.setDate(d.getDate() - d.getDay() + 1); const e = new Date(s); e.setDate(s.getDate() + 6); setDateFrom(s.toISOString().split("T")[0]); setDateTo(e.toISOString().split("T")[0]); }}
              className="text-xs px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700">
              Εβδ.
            </button>
            <button onClick={() => { const d = new Date(); const s = new Date(d.getFullYear(), d.getMonth(), 1); setDateFrom(s.toISOString().split("T")[0]); setDateTo(d.toISOString().split("T")[0]); }}
              className="text-xs px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700">
              Μήνας
            </button>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-4 border border-blue-100 dark:border-blue-800">
          <p className="text-xs font-semibold text-blue-600 dark:text-blue-400 mb-1">ΗΜΕΡΕΣ</p>
          <p className="text-2xl font-bold text-blue-800 dark:text-blue-200">{kpis.days}</p>
          <p className="text-xs text-blue-600/60 mt-0.5">μέσος {kpis.avgPax} pax/ημέρα</p>
        </div>
        <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
          <p className="text-xs font-semibold text-gray-500 mb-1">ΘΕΩΡΗΤΙΚΗ</p>
          <p className="text-2xl font-bold text-gray-800 dark:text-gray-200">{fmtKg(kpis.totalTheoretical)}</p>
          <p className="text-xs text-gray-400 mt-0.5">αναμενόμενη κατανάλωση</p>
        </div>
        <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
          <p className="text-xs font-semibold text-gray-500 mb-1">ΠΡΑΓΜΑΤΙΚΗ</p>
          <p className="text-2xl font-bold text-gray-800 dark:text-gray-200">{fmtKg(kpis.totalActual)}</p>
          <p className="text-xs text-gray-400 mt-0.5">από δελτία διακίνησης</p>
        </div>
        <div className={`rounded-xl p-4 border ${pctBg(kpis.overallDeviation)}`}>
          <p className="text-xs font-semibold text-gray-500 mb-1">ΑΠΟΚΛΙΣΗ</p>
          <p className={`text-2xl font-bold ${pctColor(kpis.overallDeviation)}`}>
            {kpis.overallDeviation > 0 ? "+" : ""}{fmt2(kpis.overallDeviation)}%
          </p>
          <p className="text-xs text-gray-400 mt-0.5">{kpis.alerts} ειδοποιήσεις &gt;5%</p>
        </div>
      </div>

      {/* No data warning */}
      {cycleEntries.length === 0 && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4 mb-5">
          <p className="text-amber-800 dark:text-amber-200 text-sm font-medium">⚠️ Δεν υπάρχουν εγγραφές κύκλου μπουφέ</p>
          <p className="text-amber-600 dark:text-amber-400 text-xs mt-1">Προσθέστε πιάτα στον <a href="/buffet-cycle" className="underline">Κύκλο Μπουφέ</a> για να υπολογιστεί η θεωρητική κατανάλωση.</p>
        </div>
      )}
      {reservations.length === 0 && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4 mb-5">
          <p className="text-amber-800 dark:text-amber-200 text-sm font-medium">⚠️ Δεν υπάρχουν κρατήσεις</p>
          <p className="text-amber-600 dark:text-amber-400 text-xs mt-1">Εισάγετε κρατήσεις στις <a href="/reservations" className="underline">Κρατήσεις</a> για να εμφανιστεί η ανάλυση pax.</p>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-xl p-1 mb-5 w-fit">
        {[
          { id: "daily", label: "📅 Ημερήσια" },
          { id: "alerts", label: `🚨 Alerts (${kpis.alerts})` },
          { id: "weekly", label: "📈 Εβδομαδιαία" },
        ].map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id as typeof activeTab)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === tab.id
                ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm"
                : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
            }`}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── DAILY TAB ── */}
      {activeTab === "daily" && (
        <div className="space-y-4">
          {dayReports.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <div className="text-5xl mb-3">📋</div>
              <p className="font-medium">Δεν υπάρχουν δεδομένα για αυτό το διάστημα</p>
              <p className="text-sm mt-1">Ελέγξτε ότι υπάρχουν κρατήσεις και κύκλος μπουφέ</p>
            </div>
          ) : dayReports.map((day, di) => (
            <div key={di} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
              {/* Day header */}
              <div className="flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-700/50">
                <div className="flex items-center gap-3">
                  <span className="font-bold text-gray-900 dark:text-white text-sm">
                    {new Date(day.date + "T12:00:00Z").toLocaleDateString("el-GR", { weekday: "short", day: "numeric", month: "short" })}
                  </span>
                  <span className="bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-xs font-semibold px-2 py-0.5 rounded-full">
                    {MEAL_LABEL[day.mealType] ?? day.mealType}
                  </span>
                  <span className="text-xs text-gray-500">
                    {day.pax} pax · Κύκλος Εβδ.{day.weekNumber} {DAY_NAMES[day.weekday]}
                  </span>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="text-xs text-gray-500">Θεωρητική / Πραγματική</p>
                    <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                      {fmtKg(day.totalTheoretical)} / {day.totalActual > 0 ? fmtKg(day.totalActual) : <span className="text-gray-400">—</span>}
                    </p>
                  </div>
                  {day.totalActual > 0 && (
                    <span className={`text-sm font-bold ${pctColor(day.totalDeviation)}`}>
                      {day.totalDeviation > 0 ? "+" : ""}{fmt2(day.totalDeviation)}%
                    </span>
                  )}
                </div>
              </div>

              {/* Dishes */}
              {day.dishes.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-700">
                        <th className="text-left px-4 py-2">Πιάτο</th>
                        <th className="text-left px-4 py-2">Κατηγορία</th>
                        <th className="text-right px-4 py-2">kg/άτομο</th>
                        <th className="text-right px-4 py-2">Θεωρητικό</th>
                        <th className="text-right px-4 py-2">Πραγματικό</th>
                        <th className="text-right px-4 py-2">Απόκλιση</th>
                      </tr>
                    </thead>
                    <tbody>
                      {day.dishes.map((dish, idx) => (
                        <tr key={idx} className="border-b border-gray-50 dark:border-gray-700/50 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-700/20">
                          <td className="px-4 py-2 font-medium text-gray-800 dark:text-gray-200">{dish.dishName}</td>
                          <td className="px-4 py-2 text-gray-500 text-xs">{dish.dishCategory}</td>
                          <td className="px-4 py-2 text-right text-gray-500 text-xs">{dish.kgPerPerson.toFixed(3)}</td>
                          <td className="px-4 py-2 text-right text-gray-700 dark:text-gray-300">{fmtKg(dish.theoreticalKg)}</td>
                          <td className="px-4 py-2 text-right">
                            {dish.actualKg > 0
                              ? <span className="font-medium text-gray-900 dark:text-white">{fmtKg(dish.actualKg)}</span>
                              : <span className="text-gray-300 dark:text-gray-600">—</span>
                            }
                          </td>
                          <td className="px-4 py-2 text-right">
                            {dish.actualKg > 0
                              ? <span className={`font-semibold text-xs ${pctColor(dish.deviation)}`}>
                                  {dish.deviation > 0 ? "+" : ""}{fmt2(dish.deviation)}%
                                </span>
                              : <span className="text-gray-300 dark:text-gray-600 text-xs">—</span>
                            }
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="px-4 py-3 text-xs text-gray-400 italic">
                  Δεν βρέθηκε κύκλος μπουφέ για Εβδ.{day.weekNumber} / {DAY_NAMES[day.weekday]} / {MEAL_LABEL[day.mealType]}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── ALERTS TAB ── */}
      {activeTab === "alerts" && (
        <div>
          <div className="mb-4">
            <h2 className="text-base font-bold text-gray-900 dark:text-white">🚨 Αποκλίσεις &gt;5% — Ανά Πιάτο</h2>
            <p className="text-sm text-gray-500 mt-0.5">Πιάτα με την υψηλότερη υπέρβαση θεωρητικής κατανάλωσης στο επιλεγμένο διάστημα</p>
          </div>

          {alertItems.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <div className="text-5xl mb-3">✅</div>
              <p className="font-medium">Δεν υπάρχουν αποκλίσεις &gt;5%</p>
              <p className="text-sm mt-1">Όλα τα πιάτα εντός ορίου για αυτό το διάστημα</p>
            </div>
          ) : (
            <div className="space-y-3">
              {alertItems.map((item, idx) => (
                <div key={idx} className={`rounded-xl border p-4 ${pctBg(item.deviation)}`}>
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-base">{item.deviation > 20 ? "🔴" : item.deviation > 10 ? "🟠" : "🟡"}</span>
                        <span className="font-bold text-gray-900 dark:text-white">#{idx + 1} — {item.dishName}</span>
                        <span className="text-xs text-gray-500 bg-white/60 dark:bg-black/20 px-2 py-0.5 rounded-full">{item.dishCategory}</span>
                      </div>
                      <div className="text-xs text-gray-600 dark:text-gray-400">
                        {new Date(item.date + "T12:00:00Z").toLocaleDateString("el-GR", { weekday: "short", day: "numeric", month: "short" })}
                        {" · "}{MEAL_LABEL[item.mealType]}
                        {" · "}{item.pax} pax
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`text-xl font-bold ${pctColor(item.deviation)}`}>
                        +{fmt2(item.deviation)}%
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {fmtKg(item.theoreticalKg)} → {fmtKg(item.actualKg)}
                      </div>
                      <div className="text-xs text-gray-400">
                        +{fmtKg(item.actualKg - item.theoreticalKg)} πάνω από θεωρητικό
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── WEEKLY TAB ── */}
      {activeTab === "weekly" && (
        <div>
          <h2 className="text-base font-bold text-gray-900 dark:text-white mb-4">📈 Εβδομαδιαία Σύνοψη</h2>
          {weeklySummary.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <p className="font-medium">Δεν υπάρχουν δεδομένα</p>
            </div>
          ) : (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-700/50">
                  <tr className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    <th className="text-left px-4 py-3">Εβδομάδα</th>
                    <th className="text-right px-4 py-3">Ημέρες</th>
                    <th className="text-right px-4 py-3">Σύνολο Pax</th>
                    <th className="text-right px-4 py-3">Θεωρητική</th>
                    <th className="text-right px-4 py-3">Πραγματική</th>
                    <th className="text-right px-4 py-3">Απόκλιση</th>
                    <th className="text-right px-4 py-3">Διαφορά</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {weeklySummary.map(([week, data]) => {
                    const dev = pct(data.actual, data.theoretical);
                    const diff = data.actual - data.theoretical;
                    return (
                      <tr key={week} className="hover:bg-gray-50 dark:hover:bg-gray-700/20">
                        <td className="px-4 py-3 font-semibold text-gray-900 dark:text-white">{week}</td>
                        <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-400">{data.days.size}</td>
                        <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300">{data.pax.toLocaleString("el-GR")}</td>
                        <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300">{fmtKg(data.theoretical)}</td>
                        <td className="px-4 py-3 text-right font-medium text-gray-900 dark:text-white">
                          {data.actual > 0 ? fmtKg(data.actual) : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {data.actual > 0
                            ? <span className={`font-bold ${pctColor(dev)}`}>{dev > 0 ? "+" : ""}{fmt2(dev)}%</span>
                            : <span className="text-gray-300">—</span>
                          }
                        </td>
                        <td className="px-4 py-3 text-right text-xs">
                          {data.actual > 0
                            ? <span className={diff > 0 ? "text-red-500" : "text-emerald-500"}>
                                {diff > 0 ? "+" : ""}{fmtKg(diff)}
                              </span>
                            : <span className="text-gray-300">—</span>
                          }
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {weeklySummary.length > 1 && (() => {
                  const totalPax = weeklySummary.reduce((s, [, d]) => s + d.pax, 0);
                  const totalTh = weeklySummary.reduce((s, [, d]) => s + d.theoretical, 0);
                  const totalAc = weeklySummary.reduce((s, [, d]) => s + d.actual, 0);
                  const totalDev = pct(totalAc, totalTh);
                  return (
                    <tfoot className="bg-gray-50 dark:bg-gray-700/50 border-t border-gray-200 dark:border-gray-700">
                      <tr>
                        <td className="px-4 py-3 font-bold text-gray-900 dark:text-white text-xs uppercase">ΣΥΝΟΛΟ</td>
                        <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-400">{weeklySummary.reduce((s, [, d]) => s + d.days.size, 0)}</td>
                        <td className="px-4 py-3 text-right font-bold text-gray-900 dark:text-white">{totalPax.toLocaleString("el-GR")}</td>
                        <td className="px-4 py-3 text-right font-bold text-gray-900 dark:text-white">{fmtKg(totalTh)}</td>
                        <td className="px-4 py-3 text-right font-bold text-gray-900 dark:text-white">{totalAc > 0 ? fmtKg(totalAc) : "—"}</td>
                        <td className="px-4 py-3 text-right">
                          {totalAc > 0 && <span className={`font-bold ${pctColor(totalDev)}`}>{totalDev > 0 ? "+" : ""}{fmt2(totalDev)}%</span>}
                        </td>
                        <td className="px-4 py-3 text-right text-xs">
                          {totalAc > 0 && (() => { const d = totalAc - totalTh; return <span className={d > 0 ? "text-red-500 font-bold" : "text-emerald-500 font-bold"}>{d > 0 ? "+" : ""}{fmtKg(d)}</span>; })()}
                        </td>
                      </tr>
                    </tfoot>
                  );
                })()}
              </table>
            </div>
          )}
        </div>
      )}

      {/* Legend */}
      <div className="mt-6 flex flex-wrap gap-4 text-xs text-gray-500 dark:text-gray-400 border-t border-gray-100 dark:border-gray-700 pt-4">
        <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-emerald-500 inline-block"></span> &le;5% — Εντός ορίου</div>
        <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-amber-500 inline-block"></span> 5–15% — Παρακολούθηση</div>
        <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-red-500 inline-block"></span> &gt;15% — Υπέρβαση</div>
        <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-blue-500 inline-block"></span> Αρνητικό — Κάτω από θεωρητικό</div>
        <div className="ml-auto">Θεωρητικό = pax × kg/άτομο (από κύκλο μπουφέ) · Πραγματικό = δελτία εσωτερικής διακίνησης</div>
      </div>
    </div>
  );
}
