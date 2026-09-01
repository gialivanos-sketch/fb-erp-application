"use client";
import { useApp } from "@/lib/context";
import type { ReactNode } from "react";

interface RoleGuardProps {
  /** Only show to users with these roles */
  roles?: ("admin" | "chef" | "storekeeper")[];
  /** Only show to admin */
  adminOnly?: boolean;
  /** Only show to admin or chef */
  kitchenOnly?: boolean;
  /** Only show to admin or storekeeper */
  warehouseOnly?: boolean;
  /** Fallback when user lacks access */
  fallback?: ReactNode;
  children: ReactNode;
}

export function RoleGuard({ roles, adminOnly, kitchenOnly, warehouseOnly, fallback, children }: RoleGuardProps) {
  const { currentUser, t, locale, authStatus, dataStatus, signOut, refreshAll } = useApp();

  // This can be legitimately reached now that currentUser comes from a
  // real Supabase Auth session: either the person is still loading, or
  // they're authenticated but their public.users profile row hasn't
  // appeared yet (e.g. right after sign-up, before the schema.sql
  // trigger has finished creating it — usually resolved by refreshing).
  if (!currentUser) {
    if (authStatus === "loading" || dataStatus === "loading") {
      return (
        <div className="flex items-center justify-center py-16 text-slate-400 text-sm">
          {locale === "gr" ? "Φόρτωση…" : "Loading…"}
        </div>
      );
    }
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
        <div className="text-4xl">👤</div>
        <div className="text-slate-600 font-medium max-w-sm">
          {locale === "gr"
            ? "Δεν βρέθηκε προφίλ χρήστη για τον λογαριασμό σας. Αν μόλις εγγραφήκατε, δοκιμάστε ξανά σε λίγα δευτερόλεπτα."
            : "No user profile was found for your account. If you just signed up, try again in a few seconds."}
        </div>
        <div className="flex gap-2">
          <button onClick={() => refreshAll()} className="erp-btn-primary">
            🔄 {locale === "gr" ? "Επανάληψη" : "Retry"}
          </button>
          <button onClick={() => signOut()} className="erp-btn-ghost">
            {locale === "gr" ? "Αποσύνδεση" : "Sign Out"}
          </button>
        </div>
      </div>
    );
  }

  let allowed = true;
  if (adminOnly && currentUser.role !== "admin") allowed = false;
  if (kitchenOnly && currentUser.role !== "admin" && currentUser.role !== "chef") allowed = false;
  if (warehouseOnly && currentUser.role !== "admin" && currentUser.role !== "storekeeper") allowed = false;
  if (roles && !roles.includes(currentUser.role)) allowed = false;

  if (!allowed) {
    if (fallback) return <>{fallback}</>;
    // Default masked fallback
    return (
      <div className="flex items-center justify-center py-6">
        <div className="bg-slate-100 rounded-lg px-4 py-3 text-sm text-slate-500 font-medium flex items-center gap-2">
          <span>🔒</span>
          <span>{t("maskedFinancial")}</span>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

/** Simple inline component to show that data is masked for non-admin users */
export function MaskedValue({ children }: { children: ReactNode }) {
  const { isAdmin } = useApp();
  if (isAdmin) return <>{children}</>;
  return <span className="text-slate-400 italic font-mono text-xs">••••••</span>;
}
