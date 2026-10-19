"use client";
import { useMemo } from "react";
import { useLanguage } from "@/lib/context";
import { PageHeader, KpiCard } from "@/components/shared";
import Link from "next/link";
import { APP_TABS, SECTION_LABELS, SECTION_ORDER, tabLabel } from "@/lib/appTabs";

export default function DashboardPage() {
  const { t, locale, currentUser, isAdmin, isChef, isStorekeeper, data, dataStatus, dataError, refreshAll, can, canAccessFinancials } = useLanguage();

  const stats = useMemo(() => {
    const totalPurchases = data.orders.reduce((s, o) => s + Number(o.totalGross || 0), 0);
    const totalDebits = data.supplierPayments.filter((p) => p.type === "debit").reduce((s, p) => s + Number(p.amount || 0), 0);
    const totalPayments = data.supplierPayments.filter((p) => p.type === "payment").reduce((s, p) => s + Number(p.amount || 0), 0);
    const sortedStockTakings = [...data.stockTakings].sort((a, b) => b.id - a.id);
    const inventoryValue = sortedStockTakings.length > 0 ? Number(sortedStockTakings[0].totalRecordedValue || 0) : 0;
    return {
      suppliers: data.suppliers.length,
      orders: data.orders.length,
      recipes: data.recipes.length,
      menus: data.menus.length,
      totalPurchases,
      inventoryValue,
      totalDebits,
      totalPayments,
    };
  }, [data]);

  const fmt = (n: number) => `€${n.toLocaleString("el-GR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div>
      <PageHeader title={t("navDashboard")} subtitle={`${t("headerProcurement")} & ${t("headerKitchen")}`} />

      {dataStatus === "error" && (
        <div className="mb-4 p-3 bg-red-50 border border-red-300 text-red-800 rounded-lg text-sm font-medium flex items-center justify-between gap-3">
          <span>⚠️ {dataError}</span>
          <button onClick={() => refreshAll()} className="erp-btn-secondary text-xs">
            {t("localeGR") === "Ελληνικά" ? "Επανάληψη" : "Retry"}
          </button>
        </div>
      )}

      {dataStatus === "loading" && (
        <div className="erp-card p-8 text-center text-slate-400">
          {t("localeGR") === "Ελληνικά" ? "Φόρτωση δεδομένων…" : "Loading data…"}
        </div>
      )}

      {/* Role Banner */}
      <div className={`mb-6 rounded-xl p-4 flex items-center gap-3 ${
        isAdmin ? "bg-blue-50 border border-blue-200" :
        isChef ? "bg-emerald-50 border border-emerald-200" :
        "bg-amber-50 border border-amber-200"
      }`}>
        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white text-lg font-bold ${
          isAdmin ? "bg-blue-600" : isChef ? "bg-emerald-600" : "bg-amber-600"
        }`}>
          {isAdmin ? "A" : isChef ? "C" : "S"}
        </div>
        <div>
          <div className="font-semibold text-slate-800">
            {t("loggedInAs")}: {currentUser?.name ?? "—"}
          </div>
          <div className="text-sm text-slate-500">
            {isAdmin ? t("roleAdmin") : isChef ? t("roleChef") : t("roleStorekeeper")}
            {" — "}
            {isAdmin
              ? (t("localeGR") === "Ελληνικά" ? "Πλήρης πρόσβαση σε οικονομικά, συνταγές, απογραφή & χρήστες" : "Full access to financials, recipes, inventory & users")
              : isChef
              ? (t("localeGR") === "Ελληνικά" ? "Πρόσβαση σε Συνταγές, Παρουσίαση & Prep Lists — Τα οικονομικά & περιθώρια είναι περιορισμένα" : "Access to Recipes, Plating & Prep Lists — Financials & margins are restricted")
              : (t("localeGR") === "Ελληνικά" ? "Πρόσβαση σε Απογραφή, Παραγγελίες & Τιμολόγια — Οι συνταγές & αναλύσεις κέρδους είναι περιορισμένες" : "Access to Inventory, Orders & Invoices — Recipes & profit analytics are restricted")
            }
          </div>
        </div>
      </div>

      {dataStatus === "ready" && stats.suppliers === 0 && (
        <div className="erp-card mb-6 p-6 text-center">
          <div className="text-4xl mb-4">🍽️</div>
          <h2 className="text-lg font-semibold mb-2">
            {t("localeGR") === "Ελληνικά" ? "Καλώς ήρθατε στο F&B ERP" : "Welcome to F&B ERP"}
          </h2>
          <p className="text-slate-500 text-sm mb-4">
            {t("localeGR") === "Ελληνικά"
              ? "Δεν υπάρχουν ακόμα δεδομένα. Μεταβείτε στη Διαχείριση Χρηστών για να εισάγετε προμηθευτές, υλικά και συνταγές μέσω αρχείων .csv/.xlsx."
              : "No data yet. Go to User Management to import suppliers, ingredients, and recipes via .csv/.xlsx files."}
          </p>
          <a href="/user-management" className="erp-btn-primary no-underline inline-flex">
            📥 {t("localeGR") === "Ελληνικά" ? "Μετάβαση στη Μαζική Εισαγωγή" : "Go to Bulk Import"}
          </a>
        </div>
      )}

      {/* KPI Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard label={t("kpiTotalSuppliers")} value={stats.suppliers} color="blue" icon="🏢" />
        <KpiCard label={t("kpiTotalOrders")} value={stats.orders} color="indigo" icon="📦" />
        <KpiCard label={t("kpiTotalRecipes")} value={stats.recipes} color="green" icon="👨‍🍳" />
        <KpiCard label={t("kpiTotalMenus")} value={stats.menus} color="purple" icon="🍽️" />
      </div>

      {canAccessFinancials && <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard label={t("kpiMasterPurchaseValue")} value={fmt(stats.totalPurchases)} color="amber" icon="💳" />
        <KpiCard label={t("kpiTotalInventoryValue")} value={fmt(stats.inventoryValue)} color="red" icon="📐" />
        <KpiCard label={t("kpiTotalDebits")} value={fmt(stats.totalDebits)} color="amber" icon="📊" />
        <KpiCard label={t("kpiTotalPayments")} value={fmt(stats.totalPayments)} color="green" icon="✅" />
      </div>}

      {/* Όλες οι καρτέλες της εφαρμογής (όσες επιτρέπονται στον χρήστη) */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {SECTION_ORDER.map((section) => {
          const items = APP_TABS.filter((tab) => tab.section === section && can(tab.href));
          if (!items.length) return null;
          const lbl = SECTION_LABELS[section];
          return (
            <div key={section} className="erp-card">
              <div className="erp-card-header">
                <h3 className="font-semibold text-slate-700">{lbl.icon} {locale === "gr" ? lbl.gr : lbl.en}</h3>
              </div>
              <div className="p-4 grid grid-cols-2 gap-2">
                {items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="flex items-center gap-2 p-3 rounded-lg hover:bg-blue-50 text-sm text-slate-700 transition-colors"
                  >
                    <span>{item.icon}</span> {tabLabel(item, locale, t)}
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
