"use client";
import { createContext, useContext, useState, useCallback, useEffect, useMemo, type ReactNode } from "react";
import { t as translate, type Locale } from "./i18n";
import type { AppDatabase, AppUser, UserRole } from "./types";
import { supabase, isSupabaseConfigured } from "./supabaseClient";
import { useAuthSession, signOut as authSignOut } from "./auth";
import * as db from "./supabaseData";

export type { UserRole };

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
  units: [],
  ingestionLogs: [],
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

  const refreshAll = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setDataStatus("error");
      setDataError(
        locale === "gr"
          ? "Το Supabase δεν έχει ρυθμιστεί. Ελέγξτε τις μεταβλητές περιβάλλοντος NEXT_PUBLIC_SUPABASE_URL και NEXT_PUBLIC_SUPABASE_ANON_KEY."
          : "Supabase is not configured. Check the NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY environment variables."
      );
      return;
    }
    try {
      const [
        users, suppliers, supplierProducts, orders, orderItems, supplierPayments,
        stockTakings, inventorySnapshots, ingredients, recipes, menus, prepLists,
        units, ingestionLogs,
      ] = await Promise.all([
        db.fetchUsers(), db.fetchSuppliers(), db.fetchSupplierProducts(), db.fetchOrders(),
        db.fetchOrderItems(), db.fetchPayments(), db.fetchStockTakings(), db.fetchInventorySnapshots(),
        db.fetchIngredients(), db.fetchRecipes(), db.fetchMenus(), db.fetchPrepLists(),
        db.fetchUnits(), db.fetchIngestionLogs(),
      ]);
      setData({
        version: 1, users, suppliers, supplierProducts, orders, orderItems, supplierPayments,
        stockTakings, inventorySnapshots, ingredients, recipes, menus, prepLists, units, ingestionLogs,
        nextIds: {},
      });
      setDataStatus("ready");
      setDataError(null);
    } catch (err) {
      setDataStatus("error");
      setDataError(err instanceof Error ? err.message : String(err));
    }
  }, [locale]);

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
      refreshAll();
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
      "prep_lists", "ingestion_logs",
    ];
    const channel = client.channel("app-data-changes");
    for (const table of tables) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        () => {
          refreshAll();
        }
      );
    }
    channel.subscribe();
    return () => {
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
