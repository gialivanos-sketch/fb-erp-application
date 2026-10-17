"use client";
// ----------------------------------------------------------------
// Όνομα επιχείρησης από την «Καρτέλα Επιχείρησης» (business_profile).
// Χρησιμοποιείται σε φόρμες παραγγελίας, email, PDF και εκτυπώσεις,
// ώστε αλλάζοντας επιχείρηση να αλλάζει παντού χωρίς αλλαγή κώδικα.
// Φορτώνεται μία φορά και κρατιέται σε cache· η Καρτέλα Επιχείρησης
// καλεί setCachedBusinessName() όταν αποθηκεύει.
// ----------------------------------------------------------------
import { useEffect, useState } from "react";
import * as db from "./supabaseData";

let cached: string | null = null;
let pending: Promise<string> | null = null;
const listeners = new Set<(n: string) => void>();

function load(): Promise<string> {
  if (cached !== null) return Promise.resolve(cached);
  if (!pending) {
    pending = db.fetchBusinessProfile()
      .then(p => (cached = (p?.name ?? "").trim()))
      .catch(() => (cached = ""))
      .finally(() => { pending = null; });
  }
  return pending;
}

export function setCachedBusinessName(name: string) {
  cached = name.trim();
  listeners.forEach(l => l(cached!));
}

/** Όνομα επιχείρησης (κεφαλαία) ή «ΕΠΙΧΕΙΡΗΣΗ» αν δεν έχει συμπληρωθεί. */
export function useBusinessName(): string {
  const [name, setName] = useState<string>(cached ?? "");
  useEffect(() => {
    let alive = true;
    load().then(n => { if (alive) setName(n); });
    const l = (n: string) => setName(n);
    listeners.add(l);
    return () => { alive = false; listeners.delete(l); };
  }, []);
  return (name || "ΕΠΙΧΕΙΡΗΣΗ").toUpperCase();
}
