"use client";
import { AppProvider, useApp } from "@/lib/context";
import Sidebar from "./Sidebar";
import AuthScreen from "./AuthScreen";

// Lives inside AppProvider (needs useApp()) and decides what the person
// actually sees: the sign-in/sign-up screen while unauthenticated, a
// brief loading state while the session check is in flight, or the real
// app shell (sidebar + page content) once signed in. This is the gate
// that makes the whole app require a real login before showing any data.
function AppGate({ children }: { children: React.ReactNode }) {
  const { authStatus, locale } = useApp();

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

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 lg:ml-64">
        <div className="p-4 sm:p-6 lg:p-8 pt-16 lg:pt-8">
          {children}
        </div>
      </main>
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
