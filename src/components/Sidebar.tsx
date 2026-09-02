"use client";
import { useState } from "react";
import { useApp } from "@/lib/context";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { RoleGuard } from "./RoleGuard";

const procurementLinks = [
  { key: "navSupplierQuotes", href: "/supplier-quotes", icon: "📊" },
  { key: "navSkuMapping", href: "/sku-mapping", icon: "🏷️" },
  { key: "navDraftOrder", href: "/draft-order", icon: "📝" },
  { key: "navSupplierCRM", href: "/supplier-crm", icon: "🏢" },
  { key: "navPayments", href: "/payments", icon: "💳" },
  { key: "navOrdersArchive", href: "/orders-archive", icon: "📦" },
  { key: "navOrderHistory", href: "/order-history", icon: "📋" },
  { key: "navInventory", href: "/inventory", icon: "📐" },
  { key: "navInventoryArchive", href: "/inventory-archive", icon: "🗄️" },
];

const kitchenLinks = [
  { key: "navRecipe", href: "/recipe", icon: "👨‍🍳" },
  { key: "navRecipeIngredients", href: "/recipe-ingredients", icon: "🧂" },
  { key: "navRecipeCosting", href: "/recipe-costing", icon: "💰" },
  { key: "navConsumption", href: "/consumption", icon: "📈" },
  { key: "navMenuPlanner", href: "/menu-planner", icon: "🍽️" },
  { key: "navMenuArchive", href: "/menu-archive", icon: "📚" },
  { key: "navUnits", href: "/units", icon: "⚖️" },
  { key: "navPrepList", href: "/prep-list", icon: "🔪" },
];

const adminLinks = [
  { key: "navUserManagement", href: "/user-management", icon: "👥" },
];

export default function Sidebar() {
  const {
    t, locale, toggleLocale,
    currentUser, isAdmin, isChef, isStorekeeper,
    canAccessFinancials, canAccessRecipes, canAccessInventory,
    signOut,
  } = useApp();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const isActive = (href: string) => pathname === href;

  const sidebarBody = (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="p-5 border-b border-slate-700/50">
        <Link href="/" className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center text-white font-bold text-lg shadow-lg">
            F&B
          </div>
          <div>
            <div className="text-white font-bold text-sm tracking-wide">ERP SYSTEM</div>
            <div className="text-slate-400 text-[10px] uppercase tracking-widest">
              {locale === "gr" ? "Έξυπνη Διαχείριση" : "Smart Management"}
            </div>
          </div>
        </Link>
      </div>

      {/* Language Toggle */}
      <div className="px-4 py-3 border-b border-slate-700/50">
        <div className="flex items-center bg-slate-800 rounded-lg p-0.5">
          <button
            onClick={() => locale !== "gr" && toggleLocale()}
            className={`flex-1 text-xs font-semibold py-2 rounded-md transition-all duration-200 ${
              locale === "gr"
                ? "bg-blue-600 text-white shadow-md"
                : "text-slate-400 hover:text-white"
            }`}
          >
            🇬🇷 ΕΛ
          </button>
          <button
            onClick={() => locale !== "en" && toggleLocale()}
            className={`flex-1 text-xs font-semibold py-2 rounded-md transition-all duration-200 ${
              locale === "en"
                ? "bg-blue-600 text-white shadow-md"
                : "text-slate-400 hover:text-white"
            }`}
          >
            🇬🇧 EN
          </button>
        </div>
      </div>

      {/* Current User & Sign Out */}
      <div className="px-4 py-3 border-b border-slate-700/50">
        <div className="flex items-center gap-2 mb-2">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold ${
            isAdmin ? "bg-blue-600" : isChef ? "bg-emerald-600" : "bg-amber-600"
          }`}>
            {isAdmin ? "A" : isChef ? "C" : "S"}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-white text-xs font-medium truncate">
              {currentUser?.name ?? "—"}
            </div>
            <div className="text-slate-400 text-[10px]">
              {isAdmin ? t("roleAdmin") : isChef ? t("roleChef") : t("roleStorekeeper")}
            </div>
          </div>
        </div>
        <button
          onClick={() => signOut()}
          className="w-full text-[10px] font-semibold py-1.5 rounded bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white transition-all"
        >
          🚪 {locale === "gr" ? "Αποσύνδεση" : "Sign Out"}
        </button>
      </div>

      {/* Nav Links */}
      <div className="flex-1 overflow-y-auto scrollbar-thin py-2">
        {/* Dashboard */}
        <div className="px-2 mb-1">
          <Link
            href="/"
            className={`sidebar-item ${isActive("/") ? "sidebar-item-active" : ""}`}
            onClick={() => setMobileOpen(false)}
          >
            <span className="text-lg">🏠</span>
            <span>{t("navDashboard")}</span>
          </Link>
        </div>

        {/* Procurement Section — Admin + Storekeeper */}
        <RoleGuard roles={["admin", "storekeeper"]}>
          <div className="sidebar-section-title">{t("sectionProcurement")}</div>
          {procurementLinks.map((item) => {
            // Hide financial links from storekeeper
            const isFinancial = item.href === "/supplier-crm" || item.href === "/payments";
            if (isFinancial && !canAccessFinancials) return null;
            return (
              <div key={item.href} className="px-2 mb-0.5">
                <Link
                  href={item.href}
                  className={`sidebar-item ${isActive(item.href) ? "sidebar-item-active" : ""}`}
                  onClick={() => setMobileOpen(false)}
                >
                  <span className="text-lg">{item.icon}</span>
                  <span>{t(item.key)}</span>
                </Link>
              </div>
            );
          })}
        </RoleGuard>

        {/* Kitchen Section — Admin + Chef */}
        <RoleGuard roles={["admin", "chef"]}>
          <div className="sidebar-section-title">{t("sectionKitchen")}</div>
          {kitchenLinks.map((item) => {
            // Hide financial/costing links from chef
            const isCosting = item.href === "/recipe-costing" || item.href === "/consumption";
            if (isCosting && !canAccessFinancials) return null;
            return (
              <div key={item.href} className="px-2 mb-0.5">
                <Link
                  href={item.href}
                  className={`sidebar-item ${isActive(item.href) ? "sidebar-item-active" : ""}`}
                  onClick={() => setMobileOpen(false)}
                >
                  <span className="text-lg">{item.icon}</span>
                  <span>{t(item.key)}</span>
                </Link>
              </div>
            );
          })}
        </RoleGuard>

        {/* Admin Section — Admin Only */}
        <RoleGuard adminOnly>
          <div className="sidebar-section-title">{t("sectionAdmin")}</div>
          {adminLinks.map((item) => (
            <div key={item.href} className="px-2 mb-0.5">
              <Link
                href={item.href}
                className={`sidebar-item ${isActive(item.href) ? "sidebar-item-active" : ""}`}
                onClick={() => setMobileOpen(false)}
              >
                <span className="text-lg">{item.icon}</span>
                <span>{t(item.key)}</span>
              </Link>
            </div>
          ))}
        </RoleGuard>
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-slate-700/50">
        <div className="text-[10px] text-slate-500 text-center">
          F&B ERP v2.0 &copy; 2026<br />
          <span className="text-slate-600">{currentUser?.email ?? ""}</span>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile hamburger */}
      <button
        onClick={() => setMobileOpen(!mobileOpen)}
        className="fixed top-4 left-4 z-50 lg:hidden bg-slate-900 text-white p-2 rounded-lg shadow-lg"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          {mobileOpen ? (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          )}
        </svg>
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex w-64 bg-[#0f172a] min-h-screen fixed left-0 top-0 bottom-0 z-40 flex-col shadow-xl">
        {sidebarBody}
      </aside>

      {/* Mobile Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-[#0f172a] lg:hidden transform transition-transform duration-300 ease-in-out ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {sidebarBody}
      </aside>
    </>
  );
}
