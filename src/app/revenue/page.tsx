"use client";
import { useState, useMemo } from "react";
import { useLanguage } from "@/lib/context";
import { PageHeader } from "@/components/shared";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface RevenueEntry {
  id: number;
  date: string;
  category: "kitchen" | "beverages" | "coffee" | "other";
  amount: number;
  covers: number;
  notes: string;
}

const CATEGORIES = [
  { value: "kitchen", labelGr: "Κουζίνα", labelEn: "Kitchen" },
  { value: "beverages", labelGr: "Ποτά", labelEn: "Beverages" },
  { value: "coffee", labelGr: "Καφές", labelEn: "Coffee" },
  { value: "other", labelGr: "Άλλο", labelEn: "Other" },
];

const EMPTY_FORM = { date: new Date().toISOString().slice(0, 10), category: "kitchen" as const, amount: "", covers: "", notes: "" };

export default function RevenuePage() {
  const { locale } = useLanguage();
  const [entries, setEntries] = useState<RevenueEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [filterMonth, setFilterMonth] = useState(new Date().toISOString().slice(0, 7));

  async function loadEntries() {
    setLoading(true);
    try {
      const { data } = await supabase
        .from("revenue_entries")
        .select("*")
        .gte("date", filterMonth + "-01")
        .lte("date", filterMonth + "-31")
        .order("date", { ascending: false });
      setEntries(data || []);
      setLoaded(true);
    } finally {
      setLoading(false);
    }
  }

  async function saveEntry() {
    if (!form.amount || Number(form.amount) <= 0) return alert(locale === "gr" ? "Εισάγετε ποσό" : "Enter amount");
    setSaving(true);
    try {
      await supabase.from("revenue_entries").insert({
        date: form.date,
        category: form.category,
        amount: Number(form.amount),
        covers: Number(form.covers) || 0,
        notes: form.notes,
      });
      setForm(EMPTY_FORM);
      await loadEntries();
    } finally {
      setSaving(false);
    }
  }

  async function deleteEntry(id: number) {
    if (!confirm(locale === "gr" ? "Διαγραφή;" : "Delete?")) return;
    await supabase.from("revenue_entries").delete().eq("id", id);
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }

  const totals = useMemo(() => {
    const byCategory: Record<string, number> = {};
    let total = 0;
    let totalCovers = 0;
    for (const e of entries) {
      byCategory[e.category] = (byCategory[e.category] || 0) + Number(e.amount);
      total += Number(e.amount);
      totalCovers += Number(e.covers);
    }
    return { byCategory, total, totalCovers, avgPerCover: totalCovers > 0 ? total / totalCovers : 0 };
  }, [entries]);

  const catLabel = (cat: string) => CATEGORIES.find((c) => c.value === cat)?.[locale === "gr" ? "labelGr" : "labelEn"] ?? cat;

  return (
    <div>
      <PageHeader
        title={locale === "gr" ? "💰 Έσοδα" : "💰 Revenue"}
        subtitle={locale === "gr" ? "Καταχώρηση & Ανάλυση Εσόδων" : "Revenue Entry & Analysis"}
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="erp-card p-4 text-center">
          <div className="text-2xl font-bold text-emerald-600">€{totals.total.toFixed(2)}</div>
          <div className="text-xs text-slate-500 mt-1">{locale === "gr" ? "Σύνολο Μήνα" : "Monthly Total"}</div>
        </div>
        {CATEGORIES.map((cat) => (
          <div key={cat.value} className="erp-card p-4 text-center">
            <div className="text-xl font-bold text-blue-600">€{(totals.byCategory[cat.value] || 0).toFixed(2)}</div>
            <div className="text-xs text-slate-500 mt-1">{locale === "gr" ? cat.labelGr : cat.labelEn}</div>
          </div>
        ))}
        <div className="erp-card p-4 text-center">
          <div className="text-xl font-bold text-purple-600">{totals.totalCovers}</div>
          <div className="text-xs text-slate-500 mt-1">{locale === "gr" ? "Πελάτες" : "Covers"}</div>
        </div>
        <div className="erp-card p-4 text-center">
          <div className="text-xl font-bold text-amber-600">€{totals.avgPerCover.toFixed(2)}</div>
          <div className="text-xs text-slate-500 mt-1">{locale === "gr" ? "Μέσος/Πελάτη" : "Avg/Cover"}</div>
        </div>
      </div>

      {/* Φόρμα Καταχώρησης */}
      <div className="erp-card mb-6">
        <div className="erp-card-header">
          <h3 className="font-semibold">➕ {locale === "gr" ? "Νέα Καταχώρηση" : "New Entry"}</h3>
        </div>
        <div className="p-4 grid grid-cols-2 md:grid-cols-5 gap-3">
          <div>
            <label className="erp-label">{locale === "gr" ? "Ημερομηνία" : "Date"}</label>
            <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="erp-input" />
          </div>
          <div>
            <label className="erp-label">{locale === "gr" ? "Κατηγορία" : "Category"}</label>
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as typeof form.category })} className="erp-input">
              {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{locale === "gr" ? c.labelGr : c.labelEn}</option>)}
            </select>
          </div>
          <div>
            <label className="erp-label">{locale === "gr" ? "Ποσό (€)" : "Amount (€)"}</label>
            <input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="erp-input" step="0.01" placeholder="0.00" />
          </div>
          <div>
            <label className="erp-label">{locale === "gr" ? "Πελάτες" : "Covers"}</label>
            <input type="number" value={form.covers} onChange={(e) => setForm({ ...form, covers: e.target.value })} className="erp-input" placeholder="0" />
          </div>
          <div>
            <label className="erp-label">{locale === "gr" ? "Σημειώσεις" : "Notes"}</label>
            <input type="text" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="erp-input" />
          </div>
        </div>
        <div className="px-4 pb-4">
          <button onClick={saveEntry} disabled={saving} className="erp-btn-primary">
            {saving ? "…" : (locale === "gr" ? "💾 Αποθήκευση" : "💾 Save")}
          </button>
        </div>
      </div>

      {/* Λίστα */}
      <div className="erp-card">
        <div className="erp-card-header flex items-center justify-between">
          <h3 className="font-semibold">{locale === "gr" ? "📋 Καταχωρήσεις" : "📋 Entries"}</h3>
          <div className="flex items-center gap-2">
            <input type="month" value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)} className="erp-input text-sm" />
            <button onClick={loadEntries} disabled={loading} className="erp-btn-secondary text-sm">
              {loading ? "…" : (locale === "gr" ? "🔄 Φόρτωση" : "🔄 Load")}
            </button>
          </div>
        </div>
        {!loaded ? (
          <div className="p-8 text-center text-slate-400">{locale === "gr" ? "Πατήστε «Φόρτωση» για να δείτε τα δεδομένα" : "Press «Load» to view data"}</div>
        ) : entries.length === 0 ? (
          <div className="p-8 text-center text-slate-400">{locale === "gr" ? "Δεν υπάρχουν εγγραφές" : "No entries"}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="erp-table">
              <thead>
                <tr>
                  <th>{locale === "gr" ? "Ημερομηνία" : "Date"}</th>
                  <th>{locale === "gr" ? "Κατηγορία" : "Category"}</th>
                  <th>{locale === "gr" ? "Ποσό" : "Amount"}</th>
                  <th>{locale === "gr" ? "Πελάτες" : "Covers"}</th>
                  <th>{locale === "gr" ? "Μέσος/Πελάτη" : "Avg/Cover"}</th>
                  <th>{locale === "gr" ? "Σημειώσεις" : "Notes"}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td>{e.date}</td>
                    <td>{catLabel(e.category)}</td>
                    <td className="font-semibold text-emerald-700">€{Number(e.amount).toFixed(2)}</td>
                    <td>{e.covers}</td>
                    <td>€{e.covers > 0 ? (Number(e.amount) / e.covers).toFixed(2) : "—"}</td>
                    <td className="text-slate-500 text-sm">{e.notes}</td>
                    <td><button onClick={() => deleteEntry(e.id)} className="text-red-400 hover:text-red-600">✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
