"use client";
import { useState } from "react";
import { useApp } from "@/lib/context";
import { signIn, signUp, requestPasswordReset } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/supabaseClient";

type Mode = "signin" | "signup" | "reset";

export default function AuthScreen() {
  const { locale, toggleLocale } = useApp();
  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    if (!email || (mode !== "reset" && !password)) return;
    setSubmitting(true);
    try {
      if (mode === "signin") {
        const { error } = await signIn(email, password);
        if (error) setError(error);
        // On success, useAuthSession's onAuthStateChange listener picks up
        // the new session automatically — no further action needed here.
      } else if (mode === "signup") {
        if (!name.trim()) {
          setError(locale === "gr" ? "Παρακαλώ εισάγετε το όνομά σας." : "Please enter your name.");
          return;
        }
        const { error } = await signUp(email, password, name.trim());
        if (error) {
          setError(error);
        } else {
          setMessage(
            locale === "gr"
              ? "✅ Ελέγξτε το email σας για να επιβεβαιώσετε τον λογαριασμό σας πριν συνδεθείτε."
              : "✅ Check your email to confirm your account before signing in."
          );
        }
      } else {
        const { error } = await requestPasswordReset(email);
        if (error) {
          setError(error);
        } else {
          setMessage(
            locale === "gr"
              ? "✅ Αν υπάρχει λογαριασμός με αυτό το email, θα λάβετε οδηγίες επαναφοράς κωδικού."
              : "✅ If an account exists for that email, you'll receive password reset instructions."
          );
        }
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setMessage(null);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
      <div className="w-full max-w-md">
        {/* Language toggle */}
        <div className="flex justify-end mb-4">
          <div className="flex items-center bg-slate-800/60 rounded-lg p-0.5">
            <button
              onClick={() => locale !== "gr" && toggleLocale()}
              className={`text-xs font-semibold px-3 py-1.5 rounded-md transition-all ${locale === "gr" ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white"}`}
            >
              🇬🇷 ΕΛ
            </button>
            <button
              onClick={() => locale !== "en" && toggleLocale()}
              className={`text-xs font-semibold px-3 py-1.5 rounded-md transition-all ${locale === "en" ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white"}`}
            >
              🇬🇧 EN
            </button>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl p-8">
          {/* Logo */}
          <div className="flex flex-col items-center mb-6">
            <div className="w-14 h-14 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl flex items-center justify-center text-white font-bold text-xl shadow-lg mb-3">
              F&B
            </div>
            <h1 className="text-lg font-bold text-slate-800">F&B ERP</h1>
            <p className="text-xs text-slate-400 uppercase tracking-widest">
              {locale === "gr" ? "Έξυπνη Διαχείριση" : "Smart Management"}
            </p>
          </div>

          {!isSupabaseConfigured && (
            <div className="mb-4 p-3 bg-amber-50 border border-amber-300 text-amber-800 rounded-lg text-xs">
              ⚠️ {locale === "gr"
                ? "Το Supabase δεν έχει ρυθμιστεί ακόμα. Ορίστε τις μεταβλητές NEXT_PUBLIC_SUPABASE_URL και NEXT_PUBLIC_SUPABASE_ANON_KEY."
                : "Supabase isn't configured yet. Set the NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY environment variables."}
            </div>
          )}

          {/* Mode tabs */}
          <div className="flex bg-slate-100 rounded-lg p-1 mb-6">
            <button
              onClick={() => switchMode("signin")}
              className={`flex-1 text-sm font-semibold py-2 rounded-md transition-all ${mode === "signin" ? "bg-white shadow text-blue-700" : "text-slate-500"}`}
            >
              {locale === "gr" ? "Σύνδεση" : "Sign In"}
            </button>
            <button
              onClick={() => switchMode("signup")}
              className={`flex-1 text-sm font-semibold py-2 rounded-md transition-all ${mode === "signup" ? "bg-white shadow text-blue-700" : "text-slate-500"}`}
            >
              {locale === "gr" ? "Εγγραφή" : "Sign Up"}
            </button>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-300 text-red-800 rounded-lg text-sm">⚠️ {error}</div>
          )}
          {message && (
            <div className="mb-4 p-3 bg-emerald-50 border border-emerald-300 text-emerald-800 rounded-lg text-sm">{message}</div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === "signup" && (
              <div>
                <label className="erp-label">{locale === "gr" ? "Ονοματεπώνυμο" : "Full Name"}</label>
                <input
                  type="text" value={name} onChange={(e) => setName(e.target.value)}
                  className="erp-input" placeholder={locale === "gr" ? "Γιώργος Παπαδόπουλος" : "Jane Smith"}
                  autoComplete="name"
                />
              </div>
            )}
            <div>
              <label className="erp-label">Email</label>
              <input
                type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
                className="erp-input" placeholder="you@example.com" autoComplete="email"
              />
            </div>
            {mode !== "reset" && (
              <div>
                <label className="erp-label">{locale === "gr" ? "Κωδικός Πρόσβασης" : "Password"}</label>
                <input
                  type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
                  minLength={6} className="erp-input" placeholder="••••••••"
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                />
                {mode === "signup" && (
                  <p className="text-xs text-slate-400 mt-1">
                    {locale === "gr" ? "Τουλάχιστον 6 χαρακτήρες." : "At least 6 characters."}
                  </p>
                )}
              </div>
            )}

            <button type="submit" disabled={submitting || !isSupabaseConfigured} className="erp-btn-primary w-full justify-center">
              {submitting ? "…" : mode === "signin" ? (locale === "gr" ? "Σύνδεση" : "Sign In") : mode === "signup" ? (locale === "gr" ? "Δημιουργία Λογαριασμού" : "Create Account") : (locale === "gr" ? "Αποστολή Οδηγιών" : "Send Instructions")}
            </button>
          </form>

          {mode === "signin" && (
            <button onClick={() => switchMode("reset")} className="w-full text-center text-xs text-slate-400 hover:text-slate-600 mt-4">
              {locale === "gr" ? "Ξεχάσατε τον κωδικό σας;" : "Forgot your password?"}
            </button>
          )}
          {mode === "reset" && (
            <button onClick={() => switchMode("signin")} className="w-full text-center text-xs text-slate-400 hover:text-slate-600 mt-4">
              {locale === "gr" ? "← Πίσω στη σύνδεση" : "← Back to sign in"}
            </button>
          )}

          {mode === "signup" && (
            <p className="text-xs text-slate-400 text-center mt-4">
              {locale === "gr"
                ? "Ο πρώτος λογαριασμός που δημιουργείται γίνεται αυτόματα Διαχειριστής."
                : "The very first account created automatically becomes Admin."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
