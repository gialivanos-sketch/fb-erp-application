// ============================================================
// ΟΛΕΣ ΟΙ ΚΑΡΤΕΛΕΣ ΤΗΣ ΕΦΑΡΜΟΓΗΣ + ΑΔΕΙΕΣ ΧΡΗΣΤΩΝ
// ============================================================
// Μία λίστα για: πλαϊνό μενού, Πίνακα Ελέγχου, πίνακα αδειών
// (Διαχείριση Χρηστών) και φραγή σελίδων.
//
// Άδειες χρήστη = λίστα από hrefs (+ "financials" για τιμές/οικονομικά).
// Αν ο διαχειριστής δεν έχει ορίσει τίποτα (permissions = null), ισχύουν
// οι προεπιλογές του ρόλου — ακριβώς όπως λειτουργούσε μέχρι τώρα.
// Ο διαχειριστής βλέπει πάντα τα πάντα.
// ============================================================
import type { AppUser, UserRole } from "./types";

export type TabSection = "procurement" | "kitchen" | "buffet" | "finance" | "admin";

export interface AppTab {
  href: string;
  /** κλειδί i18n (αν υπάρχει) */
  key?: string;
  gr: string;
  en: string;
  icon: string;
  section: TabSection;
  /** ρόλοι που τη βλέπουν από προεπιλογή (ο admin πάντα) */
  defaults: UserRole[];
  /** μόνο διαχειριστής — δεν δίνεται σε άλλους */
  adminOnly?: boolean;
}

const S: UserRole[] = ["storekeeper"];
const C: UserRole[] = ["chef"];
const NONE: UserRole[] = [];

export const APP_TABS: AppTab[] = [
  // ── Αγορές & Αποθήκη
  { href: "/supplier-quotes", key: "navSupplierQuotes", gr: "Προσφορές Προμηθευτών", en: "Supplier Quotes", icon: "📊", section: "procurement", defaults: S },
  { href: "/draft-order", key: "navDraftOrder", gr: "Νέα Παραγγελία", en: "Draft Order", icon: "📝", section: "procurement", defaults: S },
  { href: "/supplier-crm", key: "navSupplierCRM", gr: "CRM Προμηθευτών", en: "Supplier CRM", icon: "🏢", section: "procurement", defaults: NONE },
  { href: "/payments", key: "navPayments", gr: "Πληρωμές", en: "Payments", icon: "💳", section: "procurement", defaults: NONE },
  { href: "/orders-archive", key: "navOrdersArchive", gr: "Αρχείο Παραγγελιών", en: "Orders Archive", icon: "📦", section: "procurement", defaults: S },
  { href: "/order-history", key: "navOrderHistory", gr: "Ιστορικό Παραγγελιών", en: "Order History", icon: "📋", section: "procurement", defaults: S },
  { href: "/import-orders", key: "navImportOrders", gr: "Εισαγωγή Παραγγελιών", en: "Import Orders", icon: "📥", section: "procurement", defaults: NONE },
  { href: "/item-analysis", key: "navItemAnalysis", gr: "Ανάλυση Είδους", en: "Item Analysis", icon: "🔎", section: "procurement", defaults: NONE },
  { href: "/sku-mapping", key: "navSkuMapping", gr: "Ομαδοποίηση SKU", en: "SKU Mapping", icon: "🏷️", section: "procurement", defaults: S },
  { href: "/inventory", key: "navInventory", gr: "Απογραφή", en: "Inventory", icon: "📐", section: "procurement", defaults: S },
  { href: "/inventory-archive", key: "navInventoryArchive", gr: "Αρχείο Απογραφών", en: "Inventory Archive", icon: "🗄️", section: "procurement", defaults: S },
  // ── Κουζίνα
  { href: "/ingredients", key: "navIngredients", gr: "Υλικά", en: "Ingredients", icon: "🥘", section: "kitchen", defaults: C },
  { href: "/recipe", key: "navRecipe", gr: "Συνταγές", en: "Recipes", icon: "👨‍🍳", section: "kitchen", defaults: C },
  { href: "/import-recipes", key: "navImportRecipes", gr: "Εισαγωγή Συνταγών", en: "Import Recipes", icon: "📥", section: "kitchen", defaults: C },
  { href: "/recipe-ingredients", key: "navRecipeIngredients", gr: "Υλικά Συνταγών", en: "Recipe Ingredients", icon: "🧂", section: "kitchen", defaults: C },
  { href: "/recipe-costing", key: "navRecipeCosting", gr: "Κοστολόγηση Συνταγής", en: "Recipe Costing", icon: "💰", section: "kitchen", defaults: NONE },
  { href: "/consumption", key: "navConsumption", gr: "Κατανάλωση", en: "Consumption", icon: "📈", section: "kitchen", defaults: NONE },
  { href: "/menu-planner", key: "navMenuPlanner", gr: "Σχεδιασμός Μενού", en: "Menu Planner", icon: "🍽️", section: "kitchen", defaults: C },
  { href: "/menu-archive", key: "navMenuArchive", gr: "Αρχείο Μενού", en: "Menu Archive", icon: "📚", section: "kitchen", defaults: C },
  { href: "/units", key: "navUnits", gr: "Μονάδες", en: "Units", icon: "⚖️", section: "kitchen", defaults: C },
  { href: "/prep-list", key: "navPrepList", gr: "Prep List", en: "Prep List", icon: "🔄", section: "kitchen", defaults: C },
  // ── Μπουφές & κρατήσεις
  { href: "/buffet-cycle", key: "navBuffetCycle", gr: "Κύκλος Μπουφέ", en: "Buffet Cycle", icon: "🗓️", section: "buffet", defaults: C },
  { href: "/reservations", key: "navReservations", gr: "Κρατήσεις", en: "Reservations", icon: "🏨", section: "buffet", defaults: C },
  { href: "/food-cost", key: "navFoodCost", gr: "Food Cost Report", en: "Food Cost Report", icon: "📊", section: "buffet", defaults: C },
  // ── Οικονομικά (υπήρχαν ήδη, χωρίς σύνδεσμο στο μενού)
  { href: "/purchases", gr: "Αγορές (τιμολόγια)", en: "Purchases", icon: "🛒", section: "finance", defaults: NONE },
  { href: "/revenue", gr: "Έσοδα", en: "Revenue", icon: "💶", section: "finance", defaults: NONE },
  { href: "/payroll", gr: "Μισθοδοσία", en: "Payroll", icon: "👥", section: "finance", defaults: NONE },
  { href: "/reports", gr: "Αναφορές", en: "Reports", icon: "📑", section: "finance", defaults: NONE },
  // ── Διαχείριση (μόνο διαχειριστής)
  { href: "/admin", key: "navAdminPanel", gr: "Admin Panel", en: "Admin Panel", icon: "⚙️", section: "admin", defaults: NONE, adminOnly: true },
  { href: "/user-management", key: "navUserManagement", gr: "Διαχείριση Χρηστών", en: "User Management", icon: "👥", section: "admin", defaults: NONE, adminOnly: true },
  { href: "/profile", key: "navBusinessProfile", gr: "Στοιχεία Επιχείρησης", en: "Business Profile", icon: "🏬", section: "admin", defaults: NONE, adminOnly: true },
];

export const SECTION_LABELS: Record<TabSection, { gr: string; en: string; icon: string }> = {
  procurement: { gr: "ΑΓΟΡΕΣ & ΑΠΟΘΗΚΗ", en: "PROCUREMENT", icon: "🛒" },
  kitchen: { gr: "ΚΟΥΖΙΝΑ", en: "KITCHEN", icon: "👨‍🍳" },
  buffet: { gr: "ΜΠΟΥΦΕΣ & ΚΡΑΤΗΣΕΙΣ", en: "BUFFET & RESERVATIONS", icon: "🗓️" },
  finance: { gr: "ΟΙΚΟΝΟΜΙΚΑ", en: "FINANCE", icon: "💶" },
  admin: { gr: "ΔΙΑΧΕΙΡΙΣΗ", en: "ADMINISTRATION", icon: "⚙️" },
};
export const SECTION_ORDER: TabSection[] = ["procurement", "kitchen", "buffet", "finance", "admin"];

/** Ειδική άδεια: βλέπει τιμές/ποσά/οικονομικά στοιχεία μέσα στις σελίδες. */
export const PERM_FINANCIALS = "financials";

export function defaultPermissions(role: UserRole): string[] {
  if (role === "admin") return [...APP_TABS.map(t => t.href), PERM_FINANCIALS];
  return APP_TABS.filter(t => !t.adminOnly && t.defaults.includes(role)).map(t => t.href);
}

/** Οι άδειες που ισχύουν τώρα για τον χρήστη. */
export function effectivePermissions(user: Pick<AppUser, "role" | "permissions"> | null | undefined): Set<string> {
  if (!user) return new Set();
  if (user.role === "admin") return new Set(defaultPermissions("admin"));
  const list = Array.isArray(user.permissions) ? user.permissions : defaultPermissions(user.role);
  // καρτέλες μόνο-διαχειριστή δεν δίνονται ποτέ
  return new Set(list.filter(p => !APP_TABS.find(t => t.href === p)?.adminOnly));
}

export function tabLabel(tab: AppTab, locale: string, t?: (k: string) => string): string {
  if (tab.key && t) {
    const v = t(tab.key);
    if (v && v !== tab.key) return v;
  }
  return locale === "gr" ? tab.gr : tab.en;
}

/** Η καρτέλα στην οποία ανήκει μια διαδρομή (π.χ. /recipe/12 → /recipe). */
export function tabForPath(pathname: string): AppTab | undefined {
  let best: AppTab | undefined;
  for (const tab of APP_TABS) {
    if (pathname === tab.href || pathname.startsWith(tab.href + "/")) {
      if (!best || tab.href.length > best.href.length) best = tab;
    }
  }
  return best;
}
