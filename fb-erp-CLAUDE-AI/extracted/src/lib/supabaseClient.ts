// ============================================================
// Supabase client — the single source of truth for connecting
// to your Supabase project. Every other file that needs to talk
// to Supabase imports `supabase` from here.
//
// ============================================================
// ⚠️  WHERE TO PUT YOUR SUPABASE_URL AND SUPABASE_ANON_KEY  ⚠️
// ============================================================
// Do NOT paste them directly into this file. They must be set
// as environment variables so they never end up committed to
// git or hardcoded into a file you might share. Two places to
// set them:
//
// 1. LOCAL DEVELOPMENT — create a file named `.env.local` in the
//    project root (same folder as package.json) with exactly
//    these two lines:
//
//      NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
//      NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-public-key-here
//
//    Both values come from your Supabase project dashboard:
//    Project Settings → API → "Project URL" and "anon public" key.
//    (.env.local is already excluded from the zip/git via
//    .gitignore — never commit real keys.)
//
// 2. VERCEL DEPLOYMENT — in your Vercel project dashboard:
//    Settings → Environment Variables → add both names above
//    with the same values, for the Production/Preview/Development
//    environments. Redeploy after adding them.
//
// The NEXT_PUBLIC_ prefix is required by Next.js for any env var
// that needs to be readable in the browser (not just on the
// server) — Supabase's anon key is SAFE to expose in the browser
// by design (it's what Row Level Security is for), so this is
// the correct and expected way to use it, not a security mistake.
// ============================================================

import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** True once both env vars are present and look plausible. The app
 * checks this before rendering any data screen, so a missing/typo'd
 * key produces one clear, actionable message instead of the kind of
 * silent blank screen this app used to have with a missing
 * DATABASE_URL. */
export const isSupabaseConfigured = Boolean(
  supabaseUrl && supabaseAnonKey && supabaseUrl.startsWith("http") && supabaseAnonKey.length > 20
);

function buildClient() {
  return createClient<Database>(supabaseUrl as string, supabaseAnonKey as string, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
}

// The client's type is derived directly from createClient<Database>()'s
// own return type (via ReturnType) rather than a manually-written
// `SupabaseClient<Database>` annotation. The SupabaseClient type takes
// two further generic parameters beyond Database (schema name plumbing)
// that default in a way that silently resolves every table's row type
// to `never` if the annotation is written by hand without them — this
// was the root cause of nearly every "not assignable to type 'never'"
// error across supabaseData.ts before this fix.
export type SupabaseAppClient = ReturnType<typeof buildClient>;

// A working client is only created when configuration is valid.
// When it's not, `supabase` is null and every caller MUST check
// isSupabaseConfigured (or handle a null client) before using it.
export const supabase: SupabaseAppClient | null = isSupabaseConfigured ? buildClient() : null;

if (!isSupabaseConfigured && typeof window !== "undefined") {
  console.error(
    "[Supabase] NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are missing or invalid. " +
      "Set them in .env.local (development) or your Vercel project's Environment Variables (production). " +
      "See src/lib/supabaseClient.ts for exact instructions."
  );
}
