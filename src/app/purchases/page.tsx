"use client";
import { useState, useMemo } from "react";
import { useLanguage } from "@/lib/context";
import { PageHeader } from "@/components/shared";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface PurchaseInvoice {
  id: number;
  date: string;
  supplier_name: string;
  invoice_number: string;
  category: string;
  amount_net: number;
  vat_rate: number;
  amount_gross: number;
  notes: string;
}

const CATEGORIES = [
  { value: "kitchen", labelGr: "Κουζίνα", labelEn: "Kitchen" },
  { value: "beverages", labelGr: "Ποτά", labelEn: "Beverages" },
  { value: "coffee", labelGr: "Καφές", labelEn: "Coffee" },
  { value: "consumables", labelGr: "Αναλώσιμα", labelEn: "Consumables" },
  { value: "other", labelGr: "Άλλο", labelEn: "Other" },
];

const EMPTY_FORM = {
  date: new Date().toISOString().slice(0, 10),
  supplier_name: "", invoice_number: "",
  category: "kitchen", amount_net: "", vat_rate: "24", notes: ""
};

export default function PurchasesPage() {
  const { locale } = useLanguage();
  const [entries, setEntries] = useState<PurchaseInvoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [filterMonth, setFilterMonth] = useState(new Date().toISOString().slice(0, 7));

  async function loadEntries() {
    setLoading(true);
    try {
      const { data } = await supabase
        .from("purchase_invoices")
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
    if (!form.supplier_name) return alert(locale === "gr" ? "Εισάγετε προμηθευτή" : "Enter supplier");
    if (!form.amount_net || Number(form.amount_net) <= 0) return alert(locale === "gr" ? "Εισάγετε ποσό" : "Enter amount");
    setSaving(true);
    try {
      await supabase.from("purchase_invoices").insert({
        date: form.date,
        supplier_name: form.supplier_name,
        invoice_number: form.invoice_number,
        category: form.category,
        amount_net: Number(form.amount_net),
        vat_rate: Number(form.vat_rate),
        amount_gross: Math.round(Number(form.amount_net) * (1 + Number(form.vat_rate) / 100) * 100) / 100,
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
    await supabase.from("purchase_invoices").delete().eq("id", id);
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }

  const totals = useMemo(() => {
    const byCategory: Record<string, number> = {};
    let totalNet = 0; let totalGross = 0;
    for (const e of entries) {
      byCategory[e.category] = (byCategory[e.category] || 0) + Number(e.amount_net);
      totalNet += Number(e.amount_net);
      totalGross += Number(e.amount_gross);
    }
    return { byCategory, totalNet, totalGross };
  }, [entries]);

  const catLabel = (cat: string) => CATEGORIES.find((c) => c.value === cat)?.[locale === "gr" ? "labelGr" : "labelEn"] ?? cat;

  return (
    <div>
      <PageHeader
        title={locale === "gr" ? "🛒 Αγορές" : "🛒 Purchases"}
        subtitle={locale === "gr" ? "Τιμολόγια & Ανάλυση Αγορών" : "Invoices & Purchase Analysis"}
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="erp-card p-4 text-center">
          <div className="text-2xl font-bold text-red-600">€{totals.totalNet.toFixed(2)}</div>
          <div className="text-xs text-slate-500 mt-1">{locale === "gr" ? "Σύνολο Καθαρό" : "Total Net"}</div>
        </div>
        <div className="erp-card p-4 text-center">
          <div className="text-2xl font-bold text-orange-600">€{totals.totalGross.toFixed(2)}</div>
          <div className="text-xs text-slate-500 mt-1">{locale === "gr" ? "Σύνολο με ΦΠΑ" : "Total with VAT"}</div>
        </div>
        {CATEGORIES.slice(0, 2).map((cat) => (
          <div key={cat.value} className="erp-card p-4 text-center">
            <div className="text-xl font-bold text-blue-600">€{(totals.byCategory[cat.value] || 0).toFixed(2)}</div>
            <div className="text-xs text-slate-500 mt-1">{locale === "gr" ? cat.labelGr : cat.labelEn}</div>
          </div>
        ))}
      </div>

      {/* Φόρμα */}
      <div className="erp-card mb-6">
        <div className="erp-card-header">
          <h3 className="font-semibold">➕ {locale === "gr" ? "Νέο Τιμολόγιο" : "New Invoice"}</h3>
        </div>
        <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className="erp-label">{locale === "gr" ? "Ημερομηνία" : "Date"}</label>
            <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="erp-input" />
          </div>
          <div>
            <label className="erp-label">{locale === "gr" ? "Προμηθευτής" : "Supplier"}</label>
            <input type="text" value={form.supplier_name} onChange={(e) => setForm({ ...form, supplier_name: e.target.value })} className="erp-input" />
          </div>
          <div>
            <label className="erp-label">{locale === "gr" ? "Αρ. Τιμολογίου" : "Invoice #"}</label>
            <input type="text" value={form.invoice_number} onChange={(e) => setForm({ ...form, invoice_number: e.target.value })} className="erp-input" />
          </div>
          <div>
            <label className="erp-label">{locale === "gr" ? "Κατηγορία" : "Category"}</label>
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="erp-input">
              {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{locale === "gr" ? c.labelGr : c.labelEn}</option>)}
            </select>
          </div>
          <div>
            <label className="erp-label">{locale === "gr" ? "Καθαρό Ποσό (€)" : "Net Amount (€)"}</label>
            <input type="number" value={form.amount_net} onChange={(e) => setForm({ ...form, amount_net: e.target.value })} className="erp-input" step="0.01" min="0" placeholder="0.00" />
          </div>
          <div>
            <label className="erp-label">{locale === "gr" ? "ΦΠΑ %" : "VAT %"}</label>
            <select value={form.vat_rate} onChange={(e) => setForm({ ...form, vat_rate: e.target.value })} className="erp-input">
              <option value="0">0%</option>
              <option value="13">13%</option>
              <option value="24">24%</option>
            </select>
          </div>
          <div>
            <label className="erp-label">{locale === "gr" ? "Ποσό με ΦΠΑ" : "Gross Amount"}</label>
            <div className="erp-input bg-slate-50 text-slate-600 font-semibold">
              €{form.amount_net ? (Number(form.amount_net) * (1 + Number(form.vat_rate) / 100)).toFixed(2) : "0.00"}
            </div>
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
          <h3 className="font-semibold">{locale === "gr" ? "📋 Τιμολόγια" : "📋 Invoices"}</h3>
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
                  <th>{locale === "gr" ? "Προμηθευτής" : "Supplier"}</th>
                  <th>{locale === "gr" ? "Αρ. Τιμ." : "Invoice #"}</th>
                  <th>{locale === "gr" ? "Κατηγορία" : "Category"}</th>
                  <th>{locale === "gr" ? "Καθαρό" : "Net"}</th>
                  <th>{locale === "gr" ? "ΦΠΑ%" : "VAT%"}</th>
                  <th>{locale === "gr" ? "Με ΦΠΑ" : "Gross"}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td>{e.date}</td>
                    <td className="font-medium">{e.supplier_name}</td>
                    <td className="text-slate-500">{e.invoice_number}</td>
                    <td>{catLabel(e.category)}</td>
                    <td>€{Number(e.amount_net).toFixed(2)}</td>
                    <td>{e.vat_rate}%</td>
                    <td className="font-semibold text-red-700">€{Number(e.amount_gross).toFixed(2)}</td>
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
