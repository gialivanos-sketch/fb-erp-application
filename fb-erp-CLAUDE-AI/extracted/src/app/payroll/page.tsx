"use client";
import { useState, useMemo } from "react";
import { useLanguage } from "@/lib/context";
import { PageHeader } from "@/components/shared";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface PayrollEntry {
  id: number;
  period_month: number;
  period_year: number;
  employee_name: string;
  role: string;
  base_salary: number;
  hours_worked: number;
  overtime_hours: number;
  bonuses: number;
  deductions: number;
  net_pay: number;
  notes: string;
}

const now = new Date();
const EMPTY_FORM = {
  period_month: String(now.getMonth() + 1),
  period_year: String(now.getFullYear()),
  employee_name: "", role: "",
  base_salary: "", hours_worked: "", overtime_hours: "0",
  bonuses: "0", deductions: "0", notes: ""
};

const MONTHS_GR = ["Ιανουάριος","Φεβρουάριος","Μάρτιος","Απρίλιος","Μάιος","Ιούνιος","Ιούλιος","Αύγουστος","Σεπτέμβριος","Οκτώβριος","Νοέμβριος","Δεκέμβριος"];
const MONTHS_EN = ["January","February","March","April","May","June","July","August","September","October","November","December"];

export default function PayrollPage() {
  const { locale } = useLanguage();
  const [entries, setEntries] = useState<PayrollEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [filterMonth, setFilterMonth] = useState(String(now.getMonth() + 1));
  const [filterYear, setFilterYear] = useState(String(now.getFullYear()));

  async function loadEntries() {
    setLoading(true);
    try {
      const { data } = await supabase
        .from("payroll_entries")
        .select("*")
        .eq("period_month", Number(filterMonth))
        .eq("period_year", Number(filterYear))
        .order("employee_name");
      setEntries(data || []);
      setLoaded(true);
    } finally {
      setLoading(false);
    }
  }

  async function saveEntry() {
    if (!form.employee_name) return alert(locale === "gr" ? "Εισάγετε όνομα εργαζομένου" : "Enter employee name");
    setSaving(true);
    try {
      await supabase.from("payroll_entries").insert({
        period_month: Number(form.period_month),
        period_year: Number(form.period_year),
        employee_name: form.employee_name,
        role: form.role,
        base_salary: Number(form.base_salary) || 0,
        hours_worked: Number(form.hours_worked) || 0,
        overtime_hours: Number(form.overtime_hours) || 0,
        bonuses: Number(form.bonuses) || 0,
        deductions: Number(form.deductions) || 0,
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
    await supabase.from("payroll_entries").delete().eq("id", id);
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }

  const totals = useMemo(() => ({
    totalNet: entries.reduce((s, e) => s + Number(e.net_pay), 0),
    totalBase: entries.reduce((s, e) => s + Number(e.base_salary), 0),
    totalBonuses: entries.reduce((s, e) => s + Number(e.bonuses), 0),
    totalDeductions: entries.reduce((s, e) => s + Number(e.deductions), 0),
  }), [entries]);

  const previewNet = (Number(form.base_salary) || 0) + (Number(form.bonuses) || 0) - (Number(form.deductions) || 0);

  return (
    <div>
      <PageHeader
        title={locale === "gr" ? "👥 Μισθοδοσία" : "👥 Payroll"}
        subtitle={locale === "gr" ? "Καταχώρηση & Ανάλυση Μισθοδοσίας" : "Payroll Entry & Analysis"}
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="erp-card p-4 text-center">
          <div className="text-2xl font-bold text-purple-600">€{totals.totalNet.toFixed(2)}</div>
          <div className="text-xs text-slate-500 mt-1">{locale === "gr" ? "Σύνολο Καθαρό" : "Total Net Pay"}</div>
        </div>
        <div className="erp-card p-4 text-center">
          <div className="text-xl font-bold text-blue-600">€{totals.totalBase.toFixed(2)}</div>
          <div className="text-xs text-slate-500 mt-1">{locale === "gr" ? "Βασικές Αποδοχές" : "Base Salaries"}</div>
        </div>
        <div className="erp-card p-4 text-center">
          <div className="text-xl font-bold text-emerald-600">€{totals.totalBonuses.toFixed(2)}</div>
          <div className="text-xs text-slate-500 mt-1">{locale === "gr" ? "Bonus" : "Bonuses"}</div>
        </div>
        <div className="erp-card p-4 text-center">
          <div className="text-xl font-bold text-red-600">{entries.length}</div>
          <div className="text-xs text-slate-500 mt-1">{locale === "gr" ? "Εργαζόμενοι" : "Employees"}</div>
        </div>
      </div>

      {/* Φόρμα */}
      <div className="erp-card mb-6">
        <div className="erp-card-header">
          <h3 className="font-semibold">➕ {locale === "gr" ? "Νέα Εγγραφή" : "New Entry"}</h3>
        </div>
        <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className="erp-label">{locale === "gr" ? "Μήνας" : "Month"}</label>
            <select value={form.period_month} onChange={(e) => setForm({ ...form, period_month: e.target.value })} className="erp-input">
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i + 1} value={i + 1}>{locale === "gr" ? MONTHS_GR[i] : MONTHS_EN[i]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="erp-label">{locale === "gr" ? "Έτος" : "Year"}</label>
            <input type="number" value={form.period_year} onChange={(e) => setForm({ ...form, period_year: e.target.value })} className="erp-input" />
          </div>
          <div>
            <label className="erp-label">{locale === "gr" ? "Εργαζόμενος" : "Employee"}</label>
            <input type="text" value={form.employee_name} onChange={(e) => setForm({ ...form, employee_name: e.target.value })} className="erp-input" />
          </div>
          <div>
            <label className="erp-label">{locale === "gr" ? "Θέση" : "Role"}</label>
            <input type="text" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="erp-input" />
          </div>
          <div>
            <label className="erp-label">{locale === "gr" ? "Βασικές Αποδοχές (€)" : "Base Salary (€)"}</label>
            <input type="number" value={form.base_salary} onChange={(e) => setForm({ ...form, base_salary: e.target.value })} className="erp-input" step="0.01" />
          </div>
          <div>
            <label className="erp-label">{locale === "gr" ? "Bonus (€)" : "Bonus (€)"}</label>
            <input type="number" value={form.bonuses} onChange={(e) => setForm({ ...form, bonuses: e.target.value })} className="erp-input" step="0.01" />
          </div>
          <div>
            <label className="erp-label">{locale === "gr" ? "Κρατήσεις (€)" : "Deductions (€)"}</label>
            <input type="number" value={form.deductions} onChange={(e) => setForm({ ...form, deductions: e.target.value })} className="erp-input" step="0.01" />
          </div>
          <div>
            <label className="erp-label">{locale === "gr" ? "Καθαρό (preview)" : "Net (preview)"}</label>
            <div className={`erp-input font-bold ${previewNet >= 0 ? "text-emerald-700" : "text-red-700"}`}>
              €{previewNet.toFixed(2)}
            </div>
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
          <h3 className="font-semibold">{locale === "gr" ? "📋 Μισθοδοσία" : "📋 Payroll"}</h3>
          <div className="flex items-center gap-2">
            <select value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)} className="erp-input text-sm">
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i + 1} value={i + 1}>{locale === "gr" ? MONTHS_GR[i] : MONTHS_EN[i]}</option>
              ))}
            </select>
            <input type="number" value={filterYear} onChange={(e) => setFilterYear(e.target.value)} className="erp-input text-sm w-24" />
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
                  <th>{locale === "gr" ? "Εργαζόμενος" : "Employee"}</th>
                  <th>{locale === "gr" ? "Θέση" : "Role"}</th>
                  <th>{locale === "gr" ? "Βασικές" : "Base"}</th>
                  <th>{locale === "gr" ? "Bonus" : "Bonus"}</th>
                  <th>{locale === "gr" ? "Κρατήσεις" : "Deductions"}</th>
                  <th>{locale === "gr" ? "Καθαρό" : "Net"}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td className="font-medium">{e.employee_name}</td>
                    <td className="text-slate-500">{e.role}</td>
                    <td>€{Number(e.base_salary).toFixed(2)}</td>
                    <td className="text-emerald-600">€{Number(e.bonuses).toFixed(2)}</td>
                    <td className="text-red-600">€{Number(e.deductions).toFixed(2)}</td>
                    <td className="font-bold text-purple-700">€{Number(e.net_pay).toFixed(2)}</td>
                    <td><button onClick={() => deleteEntry(e.id)} className="text-red-400 hover:text-red-600">✕</button></td>
                  </tr>
                ))}
                <tr className="bg-slate-50 font-bold">
                  <td colSpan={2}>{locale === "gr" ? "ΣΥΝΟΛΟ" : "TOTAL"}</td>
                  <td>€{totals.totalBase.toFixed(2)}</td>
                  <td className="text-emerald-600">€{totals.totalBonuses.toFixed(2)}</td>
                  <td className="text-red-600">€{totals.totalDeductions.toFixed(2)}</td>
                  <td className="text-purple-700">€{totals.totalNet.toFixed(2)}</td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
