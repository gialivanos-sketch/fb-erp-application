"use client";
import { AppProvider, useApp } from "@/lib/context";
import Sidebar from "./Sidebar";
import AuthScreen from "./AuthScreen";
import ClaudeChat from "./ClaudeChat";
import { usePathname } from "next/navigation";
import { tabForPath } from "@/lib/appTabs";

// Lives inside AppProvider (needs useApp()) and decides what the person
// actually sees: the sign-in/sign-up screen while unauthenticated, a
// brief loading state while the session check is in flight, or the real
// app shell (sidebar + page content) once signed in. This is the gate
// that makes the whole app require a real login before showing any data.
function AppGate({ children }: { children: React.ReactNode }) {
  const { authStatus, locale, currentUser, can, signOut } = useApp();
  const pathname = usePathname();

  if (authStatus === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900 text-slate-400 text-sm">
        {locale === "gr" ? "Φόρτωση…" : "Loading…"}
      </div>
    );
  }

  if (authStatus === "signed-out") {
    return <AuthScreen />;
  }

  // Νέος λογαριασμός που δεν έχει εγκριθεί ακόμα από τον διαχειριστή
  if (currentUser && !currentUser.isActive) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900 p-6">
        <div className="bg-white rounded-2xl p-8 max-w-md text-center shadow-xl">
          <div className="text-5xl mb-4">⏳</div>
          <h1 className="text-lg font-bold mb-2">{locale === "gr" ? "Ο λογαριασμός σου περιμένει έγκριση" : "Your account is awaiting approval"}</h1>
          <p className="text-sm text-slate-600 mb-6">
            {locale === "gr"
              ? `Ο διαχειριστής πρέπει να ενεργοποιήσει τον λογαριασμό ${currentUser.email} και να ορίσει τι θα βλέπεις. Μετά κάνε ανανέωση της σελίδας.`
              : `An administrator must activate ${currentUser.email} and set your permissions. Then refresh this page.`}
          </p>
          <button onClick={() => signOut()} className="erp-btn-secondary">🚪 {locale === "gr" ? "Αποσύνδεση" : "Sign Out"}</button>
        </div>
      </div>
    );
  }

  // Σελίδα χωρίς άδεια (π.χ. άνοιγμα με απευθείας διεύθυνση)
  const tab = tabForPath(pathname ?? "/");
  const blocked = !!(currentUser && tab && !can(tab.href));

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 lg:ml-64">
        <div className="p-4 sm:p-6 lg:p-8 pt-16 lg:pt-8">
          {blocked ? (
            <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
              <div className="text-5xl">🔒</div>
              <div className="text-slate-700 font-semibold">{locale === "gr" ? "Δεν έχεις άδεια για αυτή την καρτέλα" : "You don't have access to this page"}</div>
              <div className="text-sm text-slate-500">{locale === "gr" ? "Ζήτα από τον διαχειριστή να σου τη δώσει από τη Διαχείριση Χρηστών." : "Ask an administrator to grant it in User Management."}</div>
            </div>
          ) : children}
        </div>
      </main>
      <ClaudeChat />
    </div>
  );
}

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppProvider>
      <AppGate>{children}</AppGate>
    </AppProvider>
  );
}
