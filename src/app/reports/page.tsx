"use client";
import { useState } from "react";
import { useLanguage } from "@/lib/context";
import { PageHeader } from "@/components/shared";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const MONTHS_GR = ["Ιανουάριος","Φεβρουάριος","Μάρτιος","Απρίλιος","Μάιος","Ιούνιος","Ιούλιος","Αύγουστος","Σεπτέμβριος","Οκτώβριος","Νοέμβριος","Δεκέμβριος"];

interface MonthSummary {
  totalRevenue: number;
  totalPurchasesNet: number;
  totalPayrollNet: number;
  grossProfit: number;
  netProfit: number;
  revenueByCategory: Record<string, number>;
  purchasesByCategory: Record<string, number>;
}

export default function ReportsPage() {
  const { locale } = useLanguage();
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [filterMonth, setFilterMonth] = useState(new Date().toISOString().slice(0, 7));
  const [summary, setSummary] = useState<MonthSummary | null>(null);

  async function loadReport() {
    setLoading(true);
    try {
      const [year, month] = filterMonth.split("-");
      const start = `${year}-${month}-01`;
      const end = `${year}-${month}-31`;

      const [{ data: rev }, { data: pur }, { data: pay }] = await Promise.all([
        supabase.from("revenue_entries").select("category,amount").gte("date", start).lte("date", end),
        supabase.from("purchase_invoices").select("category,amount_net").gte("date", start).lte("date", end),
        supabase.from("payroll_entries").select("net_pay").eq("period_month", Number(month)).eq("period_year", Number(year)),
      ]);

      const revenueByCategory: Record<string, number> = {};
      let totalRevenue = 0;
      for (const r of (rev || [])) {
        revenueByCategory[r.category] = (revenueByCategory[r.category] || 0) + Number(r.amount);
        totalRevenue += Number(r.amount);
      }

      const purchasesByCategory: Record<string, number> = {};
      let totalPurchasesNet = 0;
      for (const p of (pur || [])) {
        purchasesByCategory[p.category] = (purchasesByCategory[p.category] || 0) + Number(p.amount_net);
        totalPurchasesNet += Number(p.amount_net);
      }

      const totalPayrollNet = (pay || []).reduce((s, p) => s + Number(p.net_pay), 0);
      const grossProfit = totalRevenue - totalPurchasesNet;
      const netProfit = grossProfit - totalPayrollNet;

      setSummary({ totalRevenue, totalPurchasesNet, totalPayrollNet, grossProfit, netProfit, revenueByCategory, purchasesByCategory });
      setLoaded(true);
    } finally {
      setLoading(false);
    }
  }

  const pct = (val: number, total: number) => total > 0 ? ((val / total) * 100).toFixed(1) : "0.0";
  const [year, month] = filterMonth.split("-");
  const monthName = locale === "gr" ? MONTHS_GR[Number(month) - 1] : new Date(Number(year), Number(month) - 1).toLocaleString("en", { month: "long" });

  return (
    <div>
      <PageHeader
        title={locale === "gr" ? "📊 Αναφορές" : "📊 Reports"}
        subtitle={locale === "gr" ? "Οικονομική Σύνοψη" : "Financial Summary"}
      />

      {/* Φίλτρο */}
      <div className="erp-card mb-6">
        <div className="p-4 flex items-center gap-3">
          <div>
            <label className="erp-label">{locale === "gr" ? "Περίοδος" : "Period"}</label>
            <input type="month" value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)} className="erp-input" />
          </div>
          <div className="mt-5">
            <button onClick={loadReport} disabled={loading} className="erp-btn-primary">
              {loading ? "…" : (locale === "gr" ? "📊 Δημιουργία Αναφοράς" : "📊 Generate Report")}
            </button>
          </div>
        </div>
      </div>

      {!loaded || !summary ? (
        <div className="erp-card p-12 text-center text-slate-400">
          {locale === "gr" ? "Επιλέξτε περίοδο και πατήστε «Δημιουργία Αναφοράς»" : "Select period and press «Generate Report»"}
        </div>
      ) : (
        <>
          <h2 className="text-lg font-bold text-slate-700 mb-4">{monthName} {year}</h2>

          {/* Κύρια KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
            <div className="erp-card p-4 text-center border-2 border-emerald-200">
              <div className="text-2xl font-bold text-emerald-600">€{summary.totalRevenue.toFixed(2)}</div>
              <div className="text-xs text-slate-500 mt-1">{locale === "gr" ? "💰 Έσοδα" : "💰 Revenue"}</div>
            </div>
            <div className="erp-card p-4 text-center border-2 border-red-200">
              <div className="text-2xl font-bold text-red-600">€{summary.totalPurchasesNet.toFixed(2)}</div>
              <div className="text-xs text-slate-500 mt-1">{locale === "gr" ? "🛒 Αγορές" : "🛒 Purchases"}</div>
              <div className="text-xs text-red-400">{pct(summary.totalPurchasesNet, summary.totalRevenue)}%</div>
            </div>
            <div className="erp-card p-4 text-center border-2 border-purple-200">
              <div className="text-2xl font-bold text-purple-600">€{summary.totalPayrollNet.toFixed(2)}</div>
              <div className="text-xs text-slate-500 mt-1">{locale === "gr" ? "👥 Μισθοδοσία" : "👥 Payroll"}</div>
              <div className="text-xs text-purple-400">{pct(summary.totalPayrollNet, summary.totalRevenue)}%</div>
            </div>
            <div className="erp-card p-4 text-center border-2 border-blue-200">
              <div className={`text-2xl font-bold ${summary.grossProfit >= 0 ? "text-blue-600" : "text-red-600"}`}>
                €{summary.grossProfit.toFixed(2)}
              </div>
              <div className="text-xs text-slate-500 mt-1">{locale === "gr" ? "📈 Μεικτό Κέρδος" : "📈 Gross Profit"}</div>
              <div className="text-xs text-blue-400">{pct(summary.grossProfit, summary.totalRevenue)}%</div>
            </div>
            <div className={`erp-card p-4 text-center border-2 ${summary.netProfit >= 0 ? "border-emerald-400" : "border-red-400"}`}>
              <div className={`text-2xl font-bold ${summary.netProfit >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                €{summary.netProfit.toFixed(2)}
              </div>
              <div className="text-xs text-slate-500 mt-1">{locale === "gr" ? "🏆 Καθαρό Κέρδος" : "🏆 Net Profit"}</div>
              <div className="text-xs">{pct(summary.netProfit, summary.totalRevenue)}%</div>
            </div>
          </div>

          {/* Ανάλυση ανά κατηγορία */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="erp-card">
              <div className="erp-card-header">
                <h3 className="font-semibold">{locale === "gr" ? "💰 Έσοδα ανά Κατηγορία" : "💰 Revenue by Category"}</h3>
              </div>
              <div className="p-4 space-y-3">
                {Object.entries(summary.revenueByCategory).sort((a, b) => b[1] - a[1]).map(([cat, val]) => (
                  <div key={cat}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="capitalize">{cat}</span>
                      <span className="font-semibold">€{val.toFixed(2)} ({pct(val, summary.totalRevenue)}%)</span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-2">
                      <div className="bg-emerald-500 h-2 rounded-full" style={{ width: `${pct(val, summary.totalRevenue)}%` }} />
                    </div>
                  </div>
                ))}
                {Object.keys(summary.revenueByCategory).length === 0 && (
                  <div className="text-slate-400 text-sm">{locale === "gr" ? "Δεν υπάρχουν δεδομένα" : "No data"}</div>
                )}
              </div>
            </div>

            <div className="erp-card">
              <div className="erp-card-header">
                <h3 className="font-semibold">{locale === "gr" ? "🛒 Αγορές ανά Κατηγορία" : "🛒 Purchases by Category"}</h3>
              </div>
              <div className="p-4 space-y-3">
                {Object.entries(summary.purchasesByCategory).sort((a, b) => b[1] - a[1]).map(([cat, val]) => (
                  <div key={cat}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="capitalize">{cat}</span>
                      <span className="font-semibold">€{val.toFixed(2)} ({pct(val, summary.totalPurchasesNet)}%)</span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-2">
                      <div className="bg-red-500 h-2 rounded-full" style={{ width: `${pct(val, summary.totalPurchasesNet)}%` }} />
                    </div>
                  </div>
                ))}
                {Object.keys(summary.purchasesByCategory).length === 0 && (
                  <div className="text-slate-400 text-sm">{locale === "gr" ? "Δεν υπάρχουν δεδομένα" : "No data"}</div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
