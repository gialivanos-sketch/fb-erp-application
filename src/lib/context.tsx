"use client";
import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { t as translate, type Locale } from "./i18n";
import type { AppDatabase, AppUser, UserRole, BuffetCycleEntry, Reservation, Recipe } from "./types";
import { supabase, isSupabaseConfigured } from "./supabaseClient";
import { useAuthSession, signOut as authSignOut } from "./auth";
import * as db from "./supabaseData";

export type { UserRole };

// ── Οικονομία κίνησης δεδομένων (Supabase Egress) ──────────────────
// Κάθε αλλαγή σε πίνακα ξαναφορτώνει ΜΟΝΟ τα δεδομένα που επηρεάζει,
// μαζεμένα (μία φόρτωση για χιλιάδες αλλαγές στη σειρά), και όχι όσο η
// καρτέλα είναι κρυφή. Οι αλλαγές σε συνταγές/υλικά συνταγών περνάνε
// τοπικά χωρίς καμία φόρτωση.
type Slice = Exclude<keyof AppDatabase, "version" | "nextIds">;
const TABLE_SLICES: Record<string, Slice[]> = {
  users: ["users"],
  suppliers: ["suppliers", "supplierProducts", "orders", "orderItems", "supplierPayments"],
  supplier_products: ["supplierProducts"],
  orders: ["orders", "orderItems"],
  order_items: ["orderItems"],
  supplier_payments: ["supplierPayments"],
  stock_takings: ["stockTakings"],
  stock_taking_items: ["stockTakings"],
  inventory_snapshots: ["inventorySnapshots"],
  ingredients: ["ingredients"],
  recipes: ["recipes"],
  recipe_ingredients: ["recipes"],
  menus: ["menus"],
  menu_recipes: ["menus"],
  prep_lists: ["prepLists"],
  ingestion_logs: ["ingestionLogs"],
  buffet_cycle_entries: ["buffetCycleEntries"],
  buffet_dishes: ["buffetCycleEntries"],
  reservations: ["reservations"],
};
// χωρίς ειδοποιήσεις realtime: ξαναφορτώνονται (είναι μικρά) σε κάθε ρητή ανανέωση
const NON_REALTIME_SLICES: Slice[] = ["departments", "internalTransfers", "units"];
const SLICE_LOADERS: Record<Slice, () => Promise<unknown>> = {
  users: db.fetchUsers, suppliers: db.fetchSuppliers, supplierProducts: db.fetchSupplierProducts,
  orders: db.fetchOrders, orderItems: db.fetchOrderItems, supplierPayments: db.fetchPayments,
  stockTakings: db.fetchStockTakings, inventorySnapshots: db.fetchInventorySnapshots,
  ingredients: db.fetchIngredients, recipes: db.fetchRecipes, menus: db.fetchMenus, prepLists: db.fetchPrepLists,
  departments: db.fetchDepartments, internalTransfers: db.fetchInternalTransfers, units: db.fetchUnits, ingestionLogs: db.fetchIngestionLogs,
  buffetCycleEntries: db.fetchBuffetCycleEntries, reservations: db.fetchReservations,
};
type RtEvent = { table: string; eventType: string; new: Record<string, unknown>; old: Record<string, unknown> };
/** Εφαρμόζει αλλαγές συνταγών τοπικά. Επιστρέφει null αν χρειάζεται πλήρης φόρτωση. */
export function patchRecipes(recipes: Recipe[], events: RtEvent[]): Recipe[] | null {
  const byId = new Map(recipes.map(r => [r.id, { ...r, ingredients: [...(r.ingredients ?? [])] }]));
  // υλικό συνταγής → συνταγή (για γρήγορη εύρεση)
  const owner = new Map<number, number>();
  for (const r of byId.values()) for (const x of r.ingredients) if (x.id != null) owner.set(x.id, r.id);
  const removeIng = (id: number) => {
    const rid = owner.get(id);
    if (rid == null) return;
    const r = byId.get(rid);
    if (r) { const i = r.ingredients.findIndex(x => x.id === id); if (i >= 0) r.ingredients.splice(i, 1); }
    owner.delete(id);
  };
  for (const e of events) {
    if (e.table === "recipes") {
      if (e.eventType === "DELETE") { byId.delete(Number(e.old?.id)); continue; }
      if (!e.new || e.new.id == null) return null;
      const prev = byId.get(Number(e.new.id));
      byId.set(Number(e.new.id), db.mapRecipeRow(e.new, prev?.ingredients ?? []));
    } else if (e.table === "recipe_ingredients") {
      if (e.eventType === "DELETE") {
        const id = Number(e.old?.id);
        if (!id) return null;
        removeIng(id);
        continue;
      }
      const row = e.new as Parameters<typeof db.mapRecipeIngredient>[0];
      if (!row || row.id == null || row.ingredient_name === undefined) return null;
      const ing = db.mapRecipeIngredient(row);
      const rid = Number(ing.recipeId);
      const rec = byId.get(rid);
      if (!rec) return null;
      if (owner.get(ing.id!) === rid) {
        const i = rec.ingredients.findIndex(x => x.id === ing.id);
        rec.ingredients[i] = ing;
      } else {
        removeIng(ing.id!);
        rec.ingredients.push(ing);
        owner.set(ing.id!, rid);
      }
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, "el") || a.id - b.id);
}

// A safe, structurally-valid empty database. Used before the first
// successful load completes (or if it fails), so `data` is NEVER
// null/undefined anywhere in the component tree — this is what
// prevents the blank-screen crash this app used to have with a
// missing DATABASE_URL.
const EMPTY_DB: AppDatabase = {
  version: 1,
  users: [],
  suppliers: [],
  supplierProducts: [],
  orders: [],
  orderItems: [],
  supplierPayments: [],
  stockTakings: [],
  inventorySnapshots: [],
  ingredients: [],
  recipes: [],
  menus: [],
  prepLists: [],
  departments: [],
  internalTransfers: [],
  units: [],
  ingestionLogs: [],
  buffetCycleEntries: [],
  reservations: [],
  nextIds: {},
};

export type DataStatus = "loading" | "ready" | "error";

interface AppContextType {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string) => string;
  toggleLocale: () => void;

  // Auth
  authStatus: "loading" | "signed-out" | "signed-in";
  signOut: () => Promise<void>;

  // Whole-app data (read-only snapshot — mutate via the db* functions
  // imported from "@/lib/supabaseData" directly, then call refreshAll
  // or let the realtime subscription below pick it up automatically)
  data: AppDatabase;
  dataStatus: DataStatus;
  dataError: string | null;
  /** Re-fetches everything from Supabase. Call after any write to
   * reflect it immediately, without waiting for the realtime
   * subscription's round trip (typically a few hundred ms, but a
   * page that just wrote something usually wants to show the result
   * right away). */
  refreshAll: () => Promise<void>;

  // User / Auth profile (from public.users, linked to the Supabase
  // Auth session — NOT a role-preview switcher anymore; this is
  // always the real signed-in person)
  currentUser: AppUser | null;
  users: AppUser[];
  isAdmin: boolean;
  isChef: boolean;
  isStorekeeper: boolean;
  canAccessFinancials: boolean;
  canAccessRecipes: boolean;
  canAccessInventory: boolean;
  canAccessAdmin: boolean;
}

const AppContext = createContext<AppContextType>({
  locale: "gr",
  setLocale: () => {},
  t: (k: string) => k,
  toggleLocale: () => {},
  authStatus: "loading",
  signOut: async () => {},
  data: EMPTY_DB,
  dataStatus: "loading",
  dataError: null,
  refreshAll: async () => {},
  currentUser: null,
  users: [],
  isAdmin: false,
  isChef: false,
  isStorekeeper: false,
  canAccessFinancials: false,
  canAccessRecipes: false,
  canAccessInventory: false,
  canAccessAdmin: false,
});

export function AppProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>("gr");
  const { status: authStatus, user: authUser } = useAuthSession();

  const [data, setData] = useState<AppDatabase>(EMPTY_DB);
  const [dataStatus, setDataStatus] = useState<DataStatus>("loading");
  const [dataError, setDataError] = useState<string | null>(null);

  const toggleLocale = useCallback(() => {
    setLocale((prev) => (prev === "gr" ? "en" : "gr"));
  }, []);

  const tFn = useCallback((key: string) => translate(locale, key), [locale]);

  const dataRef = useRef<AppDatabase>(EMPTY_DB);
  useEffect(() => { dataRef.current = data; }, [data]);
  const rtReady = useRef(false);
  const rtCount = useRef(0);
  // εκκρεμείς αλλαγές από realtime, μαζεμένες
  const pendingRef = useRef<{ slices: Set<Slice>; recipeEvents: RtEvent[] }>({ slices: new Set(), recipeEvents: [] });
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstPendingAt = useRef<number>(0);

  const flushPending = useCallback(async () => {
    flushTimer.current = null;
    firstPendingAt.current = 0;
    if (typeof document !== "undefined" && document.hidden) return; // περιμένει να ξαναφανεί η καρτέλα
    const { slices, recipeEvents } = pendingRef.current;
    pendingRef.current = { slices: new Set(), recipeEvents: [] };
    if (!slices.size && !recipeEvents.length) return;
    try {
      if (recipeEvents.length && !slices.has("recipes")) {
        const patched = patchRecipes(dataRef.current.recipes, recipeEvents);
        if (patched) setData(prev => ({ ...prev, recipes: patched }));
        else slices.add("recipes");
      }
      const list = [...slices];
      if (!list.length) return;
      const values = await Promise.all(list.map(k => SLICE_LOADERS[k]()));
      setData(prev => {
        const next = { ...prev } as Record<string, unknown>;
        list.forEach((k, i) => { next[k] = values[i]; });
        return next as unknown as AppDatabase;
      });
    } catch {
      // αποτυχία: ξανά στην επόμενη αλλαγή
      for (const k of slices) pendingRef.current.slices.add(k);
    }
  }, []);

  const scheduleFlush = useCallback(() => {
    const now = Date.now();
    if (!firstPendingAt.current) firstPendingAt.current = now;
    if (flushTimer.current) clearTimeout(flushTimer.current);
    // 1,5 δευτ. ησυχίας, αλλά το πολύ κάθε 8 δευτ. όσο έρχονται αλλαγές
    const wait = Math.max(0, Math.min(1500, firstPendingAt.current + 8000 - now));
    flushTimer.current = setTimeout(() => { void flushPending(); }, wait);
  }, [flushPending]);

  const loadAll = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setDataStatus("error");
      setDataError(
        locale === "gr"
          ? "Το Supabase δεν έχει ρυθμιστεί. Ελέγξτε τις μεταβλητές περιβάλλοντος NEXT_PUBLIC_SUPABASE_URL και NEXT_PUBLIC_SUPABASE_ANON_KEY."
          : "Supabase is not configured. Check the NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY environment variables."
      );
      return;
    }
    pendingRef.current = { slices: new Set(), recipeEvents: [] };
    try {
      const [
        users, suppliers, supplierProducts, orders, orderItems, supplierPayments,
        stockTakings, inventorySnapshots, ingredients, recipes, menus, prepLists,
        departments, internalTransfers, units, ingestionLogs, buffetCycleEntries, reservations,
      ] = await Promise.all([
        db.fetchUsers(), db.fetchSuppliers(), db.fetchSupplierProducts(), db.fetchOrders(),
        db.fetchOrderItems(), db.fetchPayments(), db.fetchStockTakings(), db.fetchInventorySnapshots(),
        db.fetchIngredients(), db.fetchRecipes(), db.fetchMenus(), db.fetchPrepLists(),
        db.fetchDepartments(), db.fetchInternalTransfers(), db.fetchUnits(), db.fetchIngestionLogs(),
        db.fetchBuffetCycleEntries(), db.fetchReservations(),
      ]);
      setData({
        version: 1, users, suppliers, supplierProducts, orders, orderItems, supplierPayments,
        stockTakings, inventorySnapshots, ingredients, recipes, menus, prepLists,
        departments, internalTransfers, units, ingestionLogs, buffetCycleEntries, reservations,
        nextIds: {},
      });
      setDataStatus("ready");
      setDataError(null);
    } catch (err) {
      setDataStatus("error");
      setDataError(err instanceof Error ? err.message : String(err));
    }
  }, [locale]);

  // Μετά από αποθήκευση: οι αλλαγές έρχονται μέσω realtime και φορτώνεται
  // ΜΟΝΟ ό,τι άλλαξε. Πλήρης φόρτωση μόνο αν δεν ήρθε καμία ειδοποίηση.
  const refreshAll = useCallback(async () => {
    if (!rtReady.current) return loadAll();
    const before = rtCount.current;
    await new Promise(r => setTimeout(r, 800));
    if (rtCount.current === before) return loadAll();
    if (flushTimer.current) { clearTimeout(flushTimer.current); flushTimer.current = null; }
    for (const k of NON_REALTIME_SLICES) pendingRef.current.slices.add(k);
    await flushPending();
  }, [loadAll, flushPending]);

  // Initial load, once signed in. Signing out clears local data (it
  // belongs to whoever was signed in) rather than leaving stale rows
  // visible after logout.
  useEffect(() => {
    if (authStatus === "signed-in") {
      // Fire-and-forget: refreshAll is async and this effect doesn't need
      // to await it — it's the standard "fetch data when this changes"
      // pattern. The lint rule flags this because refreshAll's very
      // first branch (Supabase not configured) happens to call setState
      // before any `await`, but that's a config-error path, not state
      // derived from props/state that belongs in render.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadAll();
    } else if (authStatus === "signed-out") {
      setData(EMPTY_DB);
      setDataStatus("loading");
    }
    // refreshAll is stable per its own deps (locale), safe to omit here
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authStatus]);

  // Realtime: subscribe once signed in, so a change made on ANY device
  // (including this one) refreshes every connected screen. A single
  // subscription covering every table is simplest and correct for a
  // small team's data volume; splitting into per-table subscriptions
  // with granular local patching would reduce refetch volume but
  // isn't needed at this scale.
  useEffect(() => {
    if (!supabase || authStatus !== "signed-in") return;
    const client = supabase; // narrowed, non-null reference the cleanup closure below can safely use
    const tables = [
      "users", "suppliers", "supplier_products", "orders", "order_items",
      "supplier_payments", "stock_takings", "stock_taking_items", "inventory_snapshots",
      "ingredients", "recipes", "recipe_ingredients", "menus", "menu_recipes",
      "prep_lists", "ingestion_logs", "buffet_cycle_entries", "buffet_dishes", "reservations",
    ];
    const channel = client.channel("app-data-changes");
    for (const table of tables) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        (payload) => {
          const p = payload as unknown as RtEvent;
          rtCount.current++;
          if (table === "recipes" || table === "recipe_ingredients") {
            pendingRef.current.recipeEvents.push({ table, eventType: p.eventType, new: p.new, old: p.old });
          } else {
            for (const k of TABLE_SLICES[table] ?? []) pendingRef.current.slices.add(k);
          }
          scheduleFlush();
        }
      );
    }
    channel.subscribe((status) => { rtReady.current = status === "SUBSCRIBED"; });
    // κρυφή καρτέλα → καμία φόρτωση· μόλις ξαναφανεί, φορτώνει ό,τι άλλαξε
    const onVisible = () => { if (!document.hidden) void flushPending(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      if (flushTimer.current) clearTimeout(flushTimer.current);
      rtReady.current = false;
      client.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authStatus]);

  const signOut = useCallback(async () => {
    await authSignOut();
  }, []);

  // currentUser: the real signed-in person's profile row, matched by
  // Supabase Auth's user id — not a preview toggle anymore.
  const currentUser: AppUser | null = useMemo(() => {
    if (!authUser) return null;
    return data.users.find((u) => u.id === authUser.id) ?? null;
  }, [data.users, authUser]);

  // Role helpers. While data is still loading, default to the most
  // restrictive role (storekeeper) rather than the most permissive
  // (admin) — the old LocalStorage version could safely default open
  // because there was nothing sensitive to protect; a real backend
  // with real other people's data should fail closed instead.
  const role = currentUser?.role ?? (dataStatus === "ready" ? "storekeeper" : undefined);
  const isAdmin = role === "admin";
  const isChef = role === "chef";
  const isStorekeeper = role === "storekeeper";

  const canAccessFinancials = isAdmin;
  const canAccessRecipes = isAdmin || isChef;
  const canAccessInventory = isAdmin || isStorekeeper;
  const canAccessAdmin = isAdmin;

  return (
    <AppContext.Provider
      value={{
        locale,
        setLocale,
        t: tFn,
        toggleLocale,
        authStatus,
        signOut,
        data,
        dataStatus,
        dataError,
        refreshAll,
        currentUser,
        users: data.users,
        isAdmin,
        isChef,
        isStorekeeper,
        canAccessFinancials,
        canAccessRecipes,
        canAccessInventory,
        canAccessAdmin,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  return useContext(AppContext);
}

// Backward compatibility aliases for existing code
export const useLanguage = useApp;
export const LanguageProvider = AppProvider;
