// ============================================================
// Authentication helpers — thin wrappers around Supabase Auth.
// Every function here returns { error: string | null } (or
// throws only for programmer errors like calling before
// Supabase is configured), so callers can show a message
// instead of an unhandled exception.
// ============================================================
"use client";
import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase, isSupabaseConfigured } from "./supabaseClient";

export interface AuthResult {
  error: string | null;
}

/** Creates a new Supabase Auth account and — via the schema.sql
 * trigger — an accompanying row in public.users. `name` is passed
 * as user metadata so the trigger can use it as the display name;
 * if omitted, the trigger falls back to the email's local part. */
export async function signUp(email: string, password: string, name: string): Promise<AuthResult> {
  if (!supabase) return { error: "Supabase δεν έχει ρυθμιστεί." };
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { name } },
  });
  return { error: error?.message ?? null };
}

export async function signIn(email: string, password: string): Promise<AuthResult> {
  if (!supabase) return { error: "Supabase δεν έχει ρυθμιστεί." };
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return { error: error?.message ?? null };
}

export async function signOut(): Promise<AuthResult> {
  if (!supabase) return { error: "Supabase δεν έχει ρυθμιστεί." };
  const { error } = await supabase.auth.signOut();
  return { error: error?.message ?? null };
}

export async function requestPasswordReset(email: string): Promise<AuthResult> {
  if (!supabase) return { error: "Supabase δεν έχει ρυθμιστεί." };
  const { error } = await supabase.auth.resetPasswordForEmail(email);
  return { error: error?.message ?? null };
}

export type AuthStatus = "loading" | "signed-out" | "signed-in";

/** Tracks the current Supabase Auth session reactively — updates
 * automatically on sign-in, sign-out, or token refresh in ANY
 * browser tab/device using the same account (not just this one).
 * `status` starts as "loading" for exactly one render (the time it
 * takes to check for an existing session on mount), then settles
 * to "signed-in" or "signed-out" and stays in sync from then on. */
export function useAuthSession(): { status: AuthStatus; session: Session | null; user: User | null } {
  // isSupabaseConfigured is a constant fixed at module load (from env
  // vars), never changes during the app's lifetime — so the "not
  // configured" case is decided once, here, as the initial state itself,
  // rather than being set inside the effect below on every mount.
  const [status, setStatus] = useState<AuthStatus>(isSupabaseConfigured ? "loading" : "signed-out");
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setStatus(data.session ? "signed-in" : "signed-out");
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!active) return;
      setSession(newSession);
      setStatus(newSession ? "signed-in" : "signed-out");
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  return { status, session, user: session?.user ?? null };
}
