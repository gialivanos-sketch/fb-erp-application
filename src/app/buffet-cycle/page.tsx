"use client";
import { useState, useMemo } from "react";
import { useApp } from "@/lib/context";
import { upsertBuffetCycleEntry, deleteBuffetCycleEntry } from "@/lib/supabaseData";
import type { BuffetCycleEntry, BuffetDish, MealType, DayOfWeek } from "@/lib/types";

const DAYS_GR = ["", "Δευτέρα", "Τρίτη", "Τετάρτη", "Πέμπτη", "Παρασκευή", "Σάββατο", "Κυριακή"];
const DAYS_EN = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MEALS: { key: MealType; gr: string; en: string; icon: string }[] = [
  { key: "breakfast", gr: "Πρωινό", en: "Breakfast", icon: "☀️" },
  { key: "lunch", gr: "Μεσημεριανό", en: "Lunch", icon: "🍽️" },
  { key: "dinner", gr: "Βραδινό", en: "Dinner", icon: "🌙" },
];

const DEFAULT_CATEGORIES = ["Ζεστά", "Κρύα / Σαλάτες", "Ζυμαρικά / Ρύζι", "Γλυκά", "Φρούτα", "Τυριά & Αλλαντικά", "Ψωμί & Αρτοσκευάσματα"];

interface DraftDish {
  dishName: string;
  dishCategory: string;
  kgPerPerson: string;
  unit: string;
  recipeId: number | null;
  sortOrder: number;
}

const emptyDraft = (): DraftDish => ({
  dishName: "", dishCategory: DEFAULT_CATEGORIES[0], kgPerPerson: "0.15", unit: "kg", recipeId: null, sortOrder: 0,
});

export default function BuffetCyclePage() {
  const { data, refreshAll, locale, t } = useApp();
  const entries = data.buffetCycleEntries;

  // ── View state ──────────────────────────────────────────────
  const [selectedWeek, setSelectedWeek] = useState<1 | 2 | 3 | 4>(1);
  const [selectedDay, setSelectedDay] = useState<DayOfWeek>(1);
  const [selectedMeal, setSelectedMeal] = useState<MealType>("breakfast");

  // ── Form state ──────────────────────────────────────────────
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formNotes, setFormNotes] = useState("");
  const [draftDishes, setDraftDishes] = useState<DraftDish[]>([emptyDraft()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const days = locale === "gr" ? DAYS_GR : DAYS_EN;

  // ── Find current entry ──────────────────────────────────────
  const currentEntry = useMemo<BuffetCycleEntry | undefined>(() =>
    entries.find(e => e.weekNumber === selectedWeek && e.dayOfWeek === selectedDay && e.mealType === selectedMeal),
    [entries, selectedWeek, selectedDay, selectedMeal]
  );

  // ── Overview: dishes count per cell ────────────────────────
  const cellCount = useMemo(() => {
    const map: Record<string, number> = {};
    for (const e of entries) {
      map[`${e.weekNumber}-${e.dayOfWeek}-${e.mealType}`] = e.dishes.length;
    }
    return map;
  }, [entries]);

  function openNew() {
    setEditingId(null);
    setFormNotes("");
    setDraftDishes([emptyDraft()]);
    setError(null);
    setShowForm(true);
  }

  function openEdit(entry: BuffetCycleEntry) {
    setEditingId(entry.id);
    setFormNotes(entry.notes ?? "");
    setDraftDishes(entry.dishes.map(d => ({
      dishName: d.dishName, dishCategory: d.dishCategory, kgPerPerson: String(d.kgPerPerson),
      unit: d.unit, recipeId: d.recipeId, sortOrder: d.sortOrder,
    })));
    setError(null);
    setShowForm(true);
  }

  function addDish() {
    setDraftDishes(prev => [...prev, { ...emptyDraft(), sortOrder: prev.length }]);
  }

  function removeDish(idx: number) {
    setDraftDishes(prev => prev.filter((_, i) => i !== idx));
  }

  function updateDish(idx: number, field: keyof DraftDish, value: string | number | null) {
    setDraftDishes(prev => prev.map((d, i) => i === idx ? { ...d, [field]: value } : d));
  }

  async function handleSave() {
    const validDishes = draftDishes.filter(d => d.dishName.trim());
    if (validDishes.length === 0) { setError("Προσθέστε τουλάχιστον 1 πιάτο"); return; }
    setSaving(true); setError(null);
    try {
      await upsertBuffetCycleEntry(
        { id: editingId ?? undefined, weekNumber: selectedWeek, dayOfWeek: selectedDay, mealType: selectedMeal, notes: formNotes || null },
        validDishes.map((d, i) => ({
          dishName: d.dishName.trim(),
          dishCategory: d.dishCategory,
          kgPerPerson: parseFloat(d.kgPerPerson) || 0,
          unit: d.unit,
          recipeId: d.recipeId,
          sortOrder: i,
        }))
      );
      await refreshAll();
      setShowForm(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm(locale === "gr" ? "Να διαγραφεί αυτή η καταχώριση;" : "Delete this entry?")) return;
    try {
      await deleteBuffetCycleEntry(id);
      await refreshAll();
      setShowForm(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const mealLabel = (m: MealType) => MEALS.find(x => x.key === m)!;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">🗓️ {locale === "gr" ? "Κύκλος Μενού Μπουφέ" : "Buffet Menu Cycle"}</h1>
          <p className="text-slate-400 text-sm mt-1">
            {locale === "gr" ? "4 εβδομάδες · επαναλαμβανόμενο μενού · συντελεστές kg/άτομο" : "4-week rotating menu · kg/person coefficients"}
          </p>
        </div>
        <div className="text-right">
          <div className="text-slate-400 text-sm">{locale === "gr" ? "Σύνολο καταχωρήσεων" : "Total entries"}</div>
          <div className="text-2xl font-bold text-blue-400">{entries.length}</div>
        </div>
      </div>

      {/* Week tabs */}
      <div className="flex gap-2 mb-4">
        {([1, 2, 3, 4] as const).map(w => (
          <button
            key={w}
            onClick={() => setSelectedWeek(w)}
            className={`px-4 py-2 rounded-lg font-semibold text-sm transition-all ${
              selectedWeek === w ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white"
            }`}
          >
            {locale === "gr" ? `Εβδ. ${w}` : `Week ${w}`}
          </button>
        ))}
      </div>

      {/* Main grid: 7 days × 3 meals */}
      <div className="bg-slate-800 rounded-xl overflow-hidden border border-slate-700 mb-6">
        {/* Header row */}
        <div className="grid grid-cols-8 border-b border-slate-700">
          <div className="p-3 text-slate-400 text-xs font-semibold uppercase text-center">{locale === "gr" ? "Γεύμα" : "Meal"}</div>
          {([1,2,3,4,5,6,7] as DayOfWeek[]).map(d => (
            <div key={d} className="p-3 text-center">
              <div className="text-white font-semibold text-sm">{days[d]?.slice(0, 3)}</div>
            </div>
          ))}
        </div>

        {/* Meal rows */}
        {MEALS.map(meal => (
          <div key={meal.key} className="grid grid-cols-8 border-b border-slate-700/50 last:border-0">
            <div className="p-3 flex items-center gap-2 border-r border-slate-700/50">
              <span>{meal.icon}</span>
              <span className="text-white text-sm font-medium">{locale === "gr" ? meal.gr : meal.en}</span>
            </div>
            {([1,2,3,4,5,6,7] as DayOfWeek[]).map(day => {
              const key = `${selectedWeek}-${day}-${meal.key}`;
              const count = cellCount[key] ?? 0;
              const isSelected = selectedDay === day && selectedMeal === meal.key;
              return (
                <button
                  key={day}
                  onClick={() => { setSelectedDay(day); setSelectedMeal(meal.key); setShowForm(false); }}
                  className={`p-2 text-center transition-all border-r border-slate-700/50 last:border-0 ${
                    isSelected ? "bg-blue-600/30 ring-1 ring-inset ring-blue-500" : "hover:bg-slate-700/50"
                  }`}
                >
                  {count > 0 ? (
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-bold">
                      {count}
                    </span>
                  ) : (
                    <span className="text-slate-600 text-xs">—</span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* Selected cell detail */}
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white font-bold text-lg">
            {locale === "gr" ? `Εβδ.${selectedWeek} · ${days[selectedDay]} · ${mealLabel(selectedMeal).gr}` : `Week ${selectedWeek} · ${days[selectedDay]} · ${mealLabel(selectedMeal).en}`}
          </h2>
          {currentEntry ? (
            <div className="flex gap-2">
              <button onClick={() => openEdit(currentEntry)} className="px-3 py-1.5 bg-amber-500/20 text-amber-400 rounded-lg text-sm font-semibold hover:bg-amber-500/30 transition-all">
                ✏️ {locale === "gr" ? "Επεξεργασία" : "Edit"}
              </button>
              <button onClick={() => handleDelete(currentEntry.id)} className="px-3 py-1.5 bg-red-500/20 text-red-400 rounded-lg text-sm font-semibold hover:bg-red-500/30 transition-all">
                🗑️
              </button>
            </div>
          ) : (
            <button onClick={openNew} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-all">
              + {locale === "gr" ? "Νέο Μενού" : "New Menu"}
            </button>
          )}
        </div>

        {currentEntry && !showForm ? (
          <div>
            {/* Group by category */}
            {(() => {
              const byCategory: Record<string, BuffetDish[]> = {};
              for (const d of currentEntry.dishes) {
                if (!byCategory[d.dishCategory]) byCategory[d.dishCategory] = [];
                byCategory[d.dishCategory].push(d);
              }
              return Object.entries(byCategory).map(([cat, dishes]) => (
                <div key={cat} className="mb-4">
                  <div className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">{cat}</div>
                  <div className="space-y-1">
                    {dishes.map(d => (
                      <div key={d.id} className="flex items-center justify-between bg-slate-700/50 rounded-lg px-4 py-2">
                        <span className="text-white text-sm">{d.dishName}</span>
                        <span className="text-emerald-400 text-sm font-mono">{d.kgPerPerson} {d.unit}/{locale === "gr" ? "άτ." : "pax"}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ));
            })()}
            {currentEntry.notes && (
              <div className="mt-3 bg-slate-700/30 rounded-lg px-4 py-2 text-slate-400 text-sm">📝 {currentEntry.notes}</div>
            )}
          </div>
        ) : !showForm ? (
          <div className="text-center py-8 text-slate-500">
            <div className="text-4xl mb-3">🍽️</div>
            <div>{locale === "gr" ? "Δεν υπάρχει μενού για αυτή την ημέρα / γεύμα" : "No menu for this day / meal"}</div>
            <div className="text-sm mt-1">{locale === "gr" ? "Πατήστε «Νέο Μενού» για να προσθέσετε πιάτα" : "Click «New Menu» to add dishes"}</div>
          </div>
        ) : null}

        {/* Form */}
        {showForm && (
          <div className="mt-2">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-semibold">{editingId ? (locale === "gr" ? "Επεξεργασία μενού" : "Edit menu") : (locale === "gr" ? "Νέο μενού" : "New menu")}</h3>
              <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-white text-sm">✕ {locale === "gr" ? "Ακύρωση" : "Cancel"}</button>
            </div>

            {/* Dishes table */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm mb-3">
                <thead>
                  <tr className="text-slate-400 text-xs uppercase border-b border-slate-700">
                    <th className="text-left py-2 pr-2 w-8">#</th>
                    <th className="text-left py-2 pr-2">{locale === "gr" ? "Πιάτο" : "Dish"}</th>
                    <th className="text-left py-2 pr-2 w-40">{locale === "gr" ? "Κατηγορία" : "Category"}</th>
                    <th className="text-right py-2 pr-2 w-28">kg/{locale === "gr" ? "άτ." : "pax"}</th>
                    <th className="text-left py-2 pr-2 w-20">{locale === "gr" ? "Μον." : "Unit"}</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {draftDishes.map((d, idx) => (
                    <tr key={idx} className="border-b border-slate-700/50">
                      <td className="py-1.5 pr-2 text-slate-500 text-xs">{idx + 1}</td>
                      <td className="py-1 pr-2">
                        <input
                          type="text"
                          value={d.dishName}
                          onChange={e => updateDish(idx, "dishName", e.target.value)}
                          placeholder={locale === "gr" ? "π.χ. Μουσακάς" : "e.g. Moussaka"}
                          className="w-full bg-slate-700 text-white rounded px-2 py-1 text-sm border border-slate-600 focus:border-blue-500 focus:outline-none"
                        />
                      </td>
                      <td className="py-1 pr-2">
                        <select
                          value={d.dishCategory}
                          onChange={e => updateDish(idx, "dishCategory", e.target.value)}
                          className="w-full bg-slate-700 text-white rounded px-2 py-1 text-sm border border-slate-600 focus:border-blue-500 focus:outline-none"
                        >
                          {DEFAULT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </td>
                      <td className="py-1 pr-2">
                        <input
                          type="number"
                          value={d.kgPerPerson}
                          onChange={e => updateDish(idx, "kgPerPerson", e.target.value)}
                          step="0.01"
                          min="0"
                          className="w-full bg-slate-700 text-white rounded px-2 py-1 text-sm text-right border border-slate-600 focus:border-blue-500 focus:outline-none"
                        />
                      </td>
                      <td className="py-1 pr-2">
                        <select
                          value={d.unit}
                          onChange={e => updateDish(idx, "unit", e.target.value)}
                          className="w-full bg-slate-700 text-white rounded px-2 py-1 text-sm border border-slate-600 focus:border-blue-500 focus:outline-none"
                        >
                          <option value="kg">kg</option>
                          <option value="τεμ">τεμ</option>
                          <option value="lt">lt</option>
                        </select>
                      </td>
                      <td className="py-1">
                        <button onClick={() => removeDish(idx)} className="text-red-400 hover:text-red-300 px-1">✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <button onClick={addDish} className="text-blue-400 hover:text-blue-300 text-sm mb-4">
              + {locale === "gr" ? "Προσθήκη πιάτου" : "Add dish"}
            </button>

            <div className="mb-4">
              <label className="block text-slate-400 text-xs mb-1">{locale === "gr" ? "Σημειώσεις" : "Notes"}</label>
              <input
                type="text"
                value={formNotes}
                onChange={e => setFormNotes(e.target.value)}
                className="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm border border-slate-600 focus:border-blue-500 focus:outline-none"
              />
            </div>

            {error && <div className="text-red-400 text-sm mb-3">⚠️ {error}</div>}

            <div className="flex gap-3">
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg font-semibold text-sm hover:bg-blue-700 disabled:opacity-50 transition-all"
              >
                {saving ? "⏳..." : `💾 ${locale === "gr" ? "Αποθήκευση" : "Save"}`}
              </button>
              <button onClick={() => setShowForm(false)} className="px-4 py-2 bg-slate-700 text-slate-300 rounded-lg text-sm hover:bg-slate-600 transition-all">
                {locale === "gr" ? "Ακύρωση" : "Cancel"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
