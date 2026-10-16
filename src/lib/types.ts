// ============================================================
// Shared entity types — client-side replacement for the old
// Postgres/Drizzle schema. Field names intentionally match the
// old API response shapes (including joined fields like
// `supplierName`) so page components need minimal changes.
// ============================================================

export type UserRole = "admin" | "chef" | "storekeeper";

export interface AppUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  lastLoginAt?: string | null;
  createdAt?: string;
}

export interface Supplier {
  id: number;
  name: string;
  nameEn: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  address: string | null;
  category: string | null;
  createdAt?: string;
}

export interface SupplierProduct {
  id: number;
  supplierId: number;
  productName: string;
  productNameEn: string | null;
  category: string;
  unit: string;
  basePrice: string;
  listPrice: string | null;
  discountPercent: string;
  qualityGrade: string | null;
  regionOfOrigin: string | null;
  isContractPrice: boolean | null;
  isActive: boolean | null;
  createdAt?: string;
  // Joined at read time (mirrors the old API's leftJoin):
  supplierName?: string;
  supplierNameEn?: string | null;
}

export interface OrderItem {
  id: number;
  orderId: number;
  supplierProductId?: number | null;
  productName: string;
  orderedQuantity: string;
  deliveredQuantity: string | null;
  unit: string;
  basePrice: string;
  vatPercent: string;
  discountPercent: string;
  netAmount: string;
  vatAmount: string;
  grossAmount: string;
  createdAt?: string;
  // Joined at read time:
  orderNumber?: string | null;
  orderDate?: string | null;
  invoiceNumber?: string | null;
  supplierName?: string | null;
  supplierNameEn?: string | null;
}

export interface Order {
  id: number;
  orderNumber: string;
  supplierId: number;
  orderDate: string;
  invoiceNumber: string | null;
  deliveryNoteNumber: string | null;
  notes: string | null;
  status: string;
  totalNet: string;
  totalVat: string;
  totalGross: string;
  createdAt?: string;
  // Joined at read time:
  supplierName?: string;
  supplierNameEn?: string | null;
}

export interface SupplierPayment {
  id: number;
  supplierId: number;
  transactionDate: string;
  amount: string;
  type: string; // "debit" | "payment"
  reference: string | null;
  notes: string | null;
  createdAt?: string;
  // Joined at read time:
  supplierName?: string;
  supplierNameEn?: string | null;
}

export interface StockTakingItem {
  id?: number;
  stockTakingId?: number;
  productName: string;
  initialStock: string;
  supplier: string;
  lastPurchaseDate: string;
  price: string;
  unit: string;
  manualCount: string;
  inventoryValue: string;
  variance: string;
}

export interface StockTaking {
  id: number;
  takingDate: string;
  notes: string | null;
  totalRecordedValue: string;
  totalPurchaseValue: string;
  totalQuantityBought: string;
  distinctSkuCount: number;
  createdAt?: string;
  items: StockTakingItem[];
}

export interface InventorySnapshot {
  id: number;
  snapshotDate: string;
  monthLabel: string | null;
  recordedValue: string;
  previousValue: string;
  deltaVariance: string;
  notes: string | null;
  createdAt?: string;
}

export interface Ingredient {
  id: number;
  sku: string;
  name: string;
  nameEn: string | null;
  currentStock: string;
  unit: string;
  basePrice: string;
  conversionFactor: string;
  conversionPerUnit: string | null;
  mappedSupplierProductId?: number | null;
  wastageFactor: string;
  calories: number;
  isActive: boolean | null;
  createdAt?: string;
}

export interface RecipeIngredient {
  id?: number;
  recipeId?: number;
  ingredientId: number;
  ingredientName: string;
  quantity: number;
  unit: string;
  unitCost: number;
  totalCost: number;
  wastageFactor: number;
  requiresPrep: boolean;
  prepNotes: string;
}

export interface Recipe {
  id: number;
  name: string;
  nameEn: string | null;
  portionYield: string;
  portionUnit: string;
  allergens: string | null; // JSON-stringified array
  platingImages?: string | null;
  technicalGuide: string | null;
  totalRawMaterialCost: string;
  laborCost: string;
  overheadCost: string;
  totalCost: string;
  profitMarginPercent: string;
  sellingPrice: string;
  menuPriceVat: string;
  menuPriceFinal: string;
  isActive: boolean | null;
  createdAt?: string;
  ingredients: RecipeIngredient[];
}

export interface MenuRecipe {
  id?: number;
  menuId?: number;
  recipeId: number;
  recipeName: string;
  portions: number;
  portionType: "portion" | "kg"; // "portion" = μερίδα, "kg" = κιλό (μπουφές)
  foodCost: string;
  sellingPrice: string;
  profitMargin: string;
}

export interface Menu {
  id: number;
  title: string;
  titleEn: string | null;
  status: string;
  totalRecipes: number;
  totalPortions: number;
  avgProfitMargin: string;
  totalFoodCost: string;
  createdAt?: string;
  recipes: MenuRecipe[];
}

export interface PrepListItem {
  id: number;
  menuId: number | null;
  recipeName: string;
  ingredientName: string;
  quantityNeeded: string;
  unit: string;
  isPrepped: boolean;
  manualOverride: string | null;
  portionCalculation: string | null;
  createdAt?: string;
}

export interface Unit {
  id: number;
  name: string;
  nameEn: string | null;
  abbreviation: string;
  baseUnit: string | null;
  conversionFactor: string;
  description: string | null;
}

// Αντιστοίχιση υλικού συνταγής → supplier product (με τιμή)
export interface IngredientSupplierMap {
  id: number;
  ingredientName: string;
  supplierProductId: number | null;
  isManual: boolean;
  matchScore: number | null;
  // joined fields
  productName?: string;
  basePrice?: string;
  supplierId?: number;
  supplierName?: string;
  unit?: string;
}

// Για dropdown επιλογής προμηθευτή ανά υλικό στην αναφορά ανάλωσης
export interface IngredientSupplierOption {
  supplierProductId: number;
  productName: string;
  basePrice: string;
  supplierId: number;
  supplierName: string;
  unit: string;
}

export interface InternalTransferItem {
  id?: number;
  transferId?: number;
  ingredientId: number | null;
  ingredientName: string;
  quantity: number;
  unit: string;
}

export interface InternalTransfer {
  id: number;
  transferNumber: string;       // ΔΕΔ-001, ΔΕΔ-002 κλπ
  transferDate: string;
  fromDepartment: string;       // πάντα ΑΠΟΘΗΚΗ
  toDepartment: string;         // ΚΟΥΖΙΝΑ / ΖΑΧΑΡΟΠΛΑΣΤΕΙΟ / κλπ
  deliveredBy: string | null;   // αποθηκάριος
  receivedBy: string | null;    // τμηματάρχης
  notes: string | null;
  createdAt?: string;
  items: InternalTransferItem[];
}

export interface IngestionLog {
  id: number;
  fileName: string;
  fileType: string;
  recordsParsed: number;
  recordsInserted: number;
  status: string;
  errors: string | null;
  createdAt: string;
}

// ============================================================
// Buffet Menu Cycle — 4-week rotating menu
// ============================================================

export type MealType = "breakfast" | "lunch" | "dinner";
export type DayOfWeek = 1 | 2 | 3 | 4 | 5 | 6 | 7; // 1=Δευ, 7=Κυρ

export interface BuffetDish {
  id: number;
  cycleEntryId: number;
  dishName: string;       // e.g. "Μουσακάς"
  dishCategory: string;   // e.g. "Ζεστά", "Σαλάτες", "Γλυκά"
  kgPerPerson: number;    // συντελεστής kg/άτομο
  unit: string;           // "kg" ή "τεμ" για γλυκά
  recipeId: number | null; // σύνδεση με συνταγή (προαιρετικό)
  sortOrder: number;
}

export interface BuffetCycleEntry {
  id: number;
  weekNumber: 1 | 2 | 3 | 4;
  dayOfWeek: DayOfWeek;   // 1=Δευτέρα .. 7=Κυριακή
  mealType: MealType;
  notes: string | null;
  createdAt?: string;
  dishes: BuffetDish[];
}

// ============================================================
// Reservations — hotel buffet pax per day/meal/board
// ============================================================

export type BoardType = "BB" | "HB" | "FB" | "AI"; // BB=Ημιδιατροφή, HB=Ημιδιατροφή, FB=Πλήρης, AI=All-Inclusive

export interface Reservation {
  id: number;
  reservationDate: string;   // ISO date
  mealType: MealType;
  boardType: BoardType;
  pax: number;
  source: "manual" | "excel_import";
  weekNumber: number | null;  // εβδομάδα κύκλου (1-4), αυτόματα
  notes: string | null;
  createdAt?: string;
}

// ============================================================
// The full app database shape persisted to LocalStorage
// ============================================================
export interface AppDatabase {
  version: number;
  users: AppUser[];
  suppliers: Supplier[];
  supplierProducts: SupplierProduct[];
  orders: Order[];
  orderItems: OrderItem[];
  supplierPayments: SupplierPayment[];
  stockTakings: StockTaking[];
  inventorySnapshots: InventorySnapshot[];
  ingredients: Ingredient[];
  recipes: Recipe[];
  menus: Menu[];
  prepLists: PrepListItem[];
  internalTransfers: InternalTransfer[];
  units: Unit[];
  ingestionLogs: IngestionLog[];
  buffetCycleEntries: BuffetCycleEntry[];
  reservations: Reservation[];
  // Auto-incrementing id counters, one per entity, so ids never collide
  // even after deletions.
  nextIds: Record<string, number>;
}

export interface BusinessProfile {
  name: string;
  address: string;
  phone: string;
  email: string;
  taxId: string;
  logoDataUrl: string | null;
}
