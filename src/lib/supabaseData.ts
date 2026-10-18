// ============================================================
// Supabase data-access layer. Every function here talks to the
// real Supabase database instead of LocalStorage. Field names
// on the way in/out are camelCase (matching the app's existing
// types in types.ts) — the snake_case ↔ camelCase conversion
// happens entirely inside this file, so page components never
// need to know the database uses snake_case column names.
//
// Numeric fields: the database stores real numbers (Postgres
// `numeric`), but the app's existing types.ts defines many of
// them as `string` (a holdover from the LocalStorage version,
// where every value round-tripped through JSON). To avoid
// rewriting every page's number-formatting code, this layer
// converts numbers to strings on read and back to numbers on
// write — see `numToStr` / `strToNum` below.
// ============================================================
import { supabase } from "./supabaseClient";
import type {
  AppUser, Supplier, SupplierProduct, Order, OrderItem, SupplierPayment,
  StockTaking, StockTakingItem, InventorySnapshot, Ingredient, Recipe,
  RecipeIngredient, Menu, MenuRecipe, PrepListItem, Unit, IngestionLog, UserRole,
  InternalTransfer, InternalTransferItem, Department,
} from "./types";

function requireClient() {
  if (!supabase) throw new Error("Supabase δεν έχει ρυθμιστεί — δείτε src/lib/supabaseClient.ts");
  return supabase;
}

const numToStr = (n: number | null | undefined): string => (n == null ? "0" : String(n));

// Το Supabase επιστρέφει έως 1000 γραμμές ανά αίτημα. Για πίνακες που
// μεγαλώνουν (παραγγελίες, είδη, κινήσεις προμηθευτών) φέρνουμε όλες
// τις γραμμές σε σελίδες.
const PAGE = 1000;
async function fetchAllPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw error;
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < PAGE) break;
  }
  return all;
}
const strToNum = (s: string | null | undefined): number => (s == null || s === "" ? 0 : Number(s));

// ------------------------------------------------------------
// USERS
// ------------------------------------------------------------
function mapUser(row: {
  id: string; name: string; email: string; role: string; is_active: boolean;
  last_login_at: string | null; created_at: string;
}): AppUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role as UserRole,
    isActive: row.is_active,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
  };
}

export async function fetchUsers(): Promise<AppUser[]> {
  const { data, error } = await requireClient().from("users").select("id, name, email, role, is_active, last_login_at, created_at").order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapUser);
}

export async function updateUserRole(id: string, role: UserRole): Promise<void> {
  const { error } = await requireClient().from("users").update({ role }).eq("id", id);
  if (error) throw error;
}

export async function deleteUser(id: string): Promise<void> {
  const { error } = await requireClient().from("users").delete().eq("id", id);
  if (error) throw error;
}

// ------------------------------------------------------------
// SUPPLIERS
// ------------------------------------------------------------
function mapSupplier(row: {
  id: number; name: string; name_en: string | null; contact_email: string | null;
  contact_phone: string | null; address: string | null; category: string | null; created_at: string;
}): Supplier {
  return {
    id: row.id, name: row.name, nameEn: row.name_en, contactEmail: row.contact_email,
    contactPhone: row.contact_phone, address: row.address, category: row.category, createdAt: row.created_at,
  };
}

export async function fetchSuppliers(): Promise<Supplier[]> {
  const { data, error } = await requireClient().from("suppliers").select("id, name, name_en, contact_email, contact_phone, address, category, created_at").order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapSupplier);
}

export async function createSupplier(input: Omit<Supplier, "id" | "createdAt">): Promise<Supplier> {
  const { data, error } = await requireClient()
    .from("suppliers")
    .insert({
      name: input.name, name_en: input.nameEn, contact_email: input.contactEmail,
      contact_phone: input.contactPhone, address: input.address, category: input.category,
    })
    .select("id, name, name_en, contact_email, contact_phone, address, category, created_at")
    .single();
  if (error) throw error;
  return mapSupplier(data);
}

export async function setSupplierEmail(id: number, email: string): Promise<void> {
  const { error } = await requireClient().from("suppliers").update({ contact_email: email }).eq("id", id);
  if (error) throw error;
}

export async function updateSupplier(id: number, input: Partial<Omit<Supplier, "id" | "createdAt">>): Promise<void> {
  if (!supabase) throw new Error("Supabase not initialized");
  const { error } = await supabase.from("suppliers").update({
    name: input.name,
    name_en: input.nameEn,
    contact_email: input.contactEmail,
    contact_phone: input.contactPhone,
    address: input.address,
    category: input.category,
  }).eq("id", id);
  if (error) throw error;

  // Αν άλλαξε η κατηγορία, ενημέρωσε αυτόματα ΟΛΑ τα προϊόντα του
  // προμηθευτή στην ίδια κατηγορία
  if (input.category) {
    const { error: prodError } = await supabase
      .from("supplier_products")
      .update({ category: input.category })
      .eq("supplier_id", id);
    if (prodError) throw prodError;
  }
}

export async function deleteSupplier(id: number): Promise<void> {
  const { error } = await requireClient().from("suppliers").delete().eq("id", id);
  if (error) throw error;
}

export async function deleteOldQuotes(supplierId: number | null): Promise<number> {
  // Supplier products don't carry a per-row date, so "old quotes" means:
  // delete non-contract quotes for the given supplier (or every supplier
  // if none is specified) — matches the original LocalStorage-era intent.
  let query = requireClient().from("supplier_products").delete({ count: "exact" }).eq("is_contract_price", false);
  if (supplierId) query = query.eq("supplier_id", supplierId);
  const { error, count } = await query;
  if (error) throw error;
  return count ?? 0;
}

export async function deleteSupplierProduct(id: number): Promise<void> {
  const { error } = await requireClient().from("supplier_products").delete().eq("id", id);
  if (error) throw error;
}

// ------------------------------------------------------------
// SUPPLIER PRODUCTS (with supplier name joined in, mirroring the
// old API's leftJoin — Supabase does this via a nested select)
// ------------------------------------------------------------
interface SupplierProductRow {
  id: number; supplier_id: number; product_name: string; product_name_en: string | null;
  category: string; unit: string; base_price: number; list_price: number | null;
  discount_percent: number | null; quality_grade: string | null;
  region_of_origin: string | null; is_contract_price: boolean | null; is_active: boolean | null;
  created_at: string; suppliers: { name: string; name_en: string | null } | null;
}

function mapSupplierProduct(row: SupplierProductRow): SupplierProduct {
  return {
    id: row.id, supplierId: row.supplier_id, productName: row.product_name, productNameEn: row.product_name_en,
    category: row.category, unit: row.unit, basePrice: numToStr(row.base_price),
    listPrice: row.list_price != null ? numToStr(row.list_price) : null,
    discountPercent: numToStr(row.discount_percent ?? 0),
    qualityGrade: row.quality_grade,
    regionOfOrigin: row.region_of_origin, isContractPrice: row.is_contract_price, isActive: row.is_active,
    createdAt: row.created_at, supplierName: row.suppliers?.name, supplierNameEn: row.suppliers?.name_en ?? null,
  };
}

export async function fetchSupplierProducts(): Promise<SupplierProduct[]> {
  const { data, error } = await requireClient()
    .from("supplier_products")
    .select("id, supplier_id, product_name, product_name_en, category, unit, base_price, list_price, discount_percent, quality_grade, region_of_origin, is_contract_price, is_active, created_at, suppliers(name, name_en)")
    .order("product_name", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => mapSupplierProduct(r as unknown as SupplierProductRow));
}

/** Cross-supplier product search — the "Μηχανή Αναζήτησης SKU". Matches
 * on Greek or English product name via Postgres full-text search (see
 * the gin index in schema.sql), sorted with the lowest price first. */
export async function searchSupplierProducts(query: string): Promise<SupplierProduct[]> {
  const q = query.trim();
  if (!q) return [];
  const { data, error } = await requireClient()
    .from("supplier_products")
    .select("id, supplier_id, product_name, product_name_en, category, unit, base_price, list_price, discount_percent, quality_grade, region_of_origin, is_contract_price, is_active, created_at, suppliers(name, name_en)")
    .eq("is_active", true)
    .or(`product_name.ilike.%${q}%,product_name_en.ilike.%${q}%`)
    .order("base_price", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => mapSupplierProduct(r as unknown as SupplierProductRow));
}

export async function createSupplierProduct(input: {
  supplierId: number; productName: string; productNameEn?: string | null; category: string; unit: string;
  basePrice: string; listPrice?: string | null; discountPercent?: string;
  qualityGrade?: string | null; regionOfOrigin?: string | null; isContractPrice?: boolean;
}): Promise<void> {
  // Αν έχει listPrice + discountPercent, υπολόγισε την τελική base_price αυτόματα
  const lp = input.listPrice ? strToNum(input.listPrice) : null;
  const dp = input.discountPercent ? strToNum(input.discountPercent) : 0;
  const finalPrice = lp != null && dp > 0
    ? parseFloat((lp * (1 - dp / 100)).toFixed(4))
    : strToNum(input.basePrice);
  const { error } = await requireClient().from("supplier_products").insert({
    supplier_id: input.supplierId, product_name: input.productName, product_name_en: input.productNameEn ?? null,
    category: input.category, unit: input.unit,
    base_price: finalPrice,
    list_price: lp,
    discount_percent: dp,
    quality_grade: input.qualityGrade ?? null, region_of_origin: input.regionOfOrigin ?? null,
    is_contract_price: input.isContractPrice ?? false, is_active: true,
  });
  if (error) throw error;
}

export async function updateSupplierProduct(id: number, input: {
  productName?: string; productNameEn?: string | null; category?: string; unit?: string;
  basePrice?: string; listPrice?: string | null; discountPercent?: string;
  qualityGrade?: string | null; regionOfOrigin?: string | null; isActive?: boolean;
}): Promise<void> {
  const lp = input.listPrice !== undefined ? (input.listPrice ? strToNum(input.listPrice) : null) : undefined;
  const dp = input.discountPercent !== undefined ? strToNum(input.discountPercent) : undefined;
  // Αν αλλάζει τιμή καταλόγου ή έκπτωση, επανυπολόγισε την base_price
  let finalPrice: number | undefined;
  if (lp != null && dp != null && dp > 0) {
    finalPrice = parseFloat((lp * (1 - dp / 100)).toFixed(4));
  } else if (input.basePrice !== undefined) {
    finalPrice = strToNum(input.basePrice);
  }
  const patch: Record<string, unknown> = {};
  if (input.productName !== undefined) patch.product_name = input.productName;
  if (input.productNameEn !== undefined) patch.product_name_en = input.productNameEn;
  if (input.category !== undefined) patch.category = input.category;
  if (input.unit !== undefined) patch.unit = input.unit;
  if (finalPrice !== undefined) patch.base_price = finalPrice;
  if (lp !== undefined) patch.list_price = lp;
  if (dp !== undefined) patch.discount_percent = dp;
  if (input.qualityGrade !== undefined) patch.quality_grade = input.qualityGrade;
  if (input.regionOfOrigin !== undefined) patch.region_of_origin = input.regionOfOrigin;
  if (input.isActive !== undefined) patch.is_active = input.isActive;
  const { error } = await requireClient().from("supplier_products").update(patch).eq("id", id);
  if (error) throw error;
}

/** Bulk insert — used by the CSV/XLSX import flows so a 500-row file
 * becomes one network round trip instead of 500. */
export async function createSupplierProductsBulk(
  rows: { supplierId: number; productName: string; productNameEn?: string | null; category: string; unit: string; basePrice: string; qualityGrade?: string | null; regionOfOrigin?: string | null }[]
): Promise<number> {
  if (rows.length === 0) return 0;
  const { error, count } = await requireClient()
    .from("supplier_products")
    .insert(
      rows.map((r) => ({
        supplier_id: r.supplierId, product_name: r.productName, product_name_en: r.productNameEn ?? null,
        category: r.category, unit: r.unit, base_price: strToNum(r.basePrice),
        quality_grade: r.qualityGrade ?? null, region_of_origin: r.regionOfOrigin ?? null,
        is_contract_price: false, is_active: true,
      })),
      { count: "exact" }
    );
  if (error) throw error;
  return count ?? rows.length;
}

// ------------------------------------------------------------
// ORDERS + ORDER ITEMS
// ------------------------------------------------------------
interface OrderRow {
  id: number; order_number: string; supplier_id: number; order_date: string; invoice_number: string | null;
  delivery_note_number: string | null; notes: string | null; status: string; total_net: number;
  total_vat: number; total_gross: number; created_at: string; suppliers: { name: string; name_en: string | null } | null;
}

function mapOrder(row: OrderRow): Order {
  return {
    id: row.id, orderNumber: row.order_number, supplierId: row.supplier_id, orderDate: row.order_date,
    invoiceNumber: row.invoice_number, deliveryNoteNumber: row.delivery_note_number, notes: row.notes,
    status: row.status, totalNet: numToStr(row.total_net), totalVat: numToStr(row.total_vat),
    totalGross: numToStr(row.total_gross), createdAt: row.created_at,
    supplierName: row.suppliers?.name, supplierNameEn: row.suppliers?.name_en ?? null,
  };
}

export async function fetchOrders(): Promise<Order[]> {
  const client = requireClient();
  const data = await fetchAllPages<unknown>((from, to) => client
    .from("orders")
    .select("id, order_number, supplier_id, order_date, invoice_number, delivery_note_number, notes, status, total_net, total_vat, total_gross, created_at, suppliers(name, name_en)")
    .order("order_date", { ascending: false })
    .order("id", { ascending: false })
    .range(from, to));
  return data.map((r) => mapOrder(r as unknown as OrderRow));
}

export async function createOrderWithItems(
  order: { orderNumber: string; supplierId: number; orderDate: string; invoiceNumber?: string | null; deliveryNoteNumber?: string | null; notes?: string | null; totalNet: string; totalVat: string; totalGross: string },
  items: { productName: string; orderedQuantity: number; unit: string; basePrice: number; vatPercent: number; discountPercent: number; netAmount: number; vatAmount: number; grossAmount: number; supplierProductId?: number | null }[]
): Promise<number> {
  const client = requireClient();
  const { data: orderRow, error: orderError } = await client
    .from("orders")
    .insert({
      order_number: order.orderNumber, supplier_id: order.supplierId, order_date: order.orderDate,
      invoice_number: order.invoiceNumber ?? null, delivery_note_number: order.deliveryNoteNumber ?? null,
      notes: order.notes ?? null, status: "draft", total_net: strToNum(order.totalNet),
      total_vat: strToNum(order.totalVat), total_gross: strToNum(order.totalGross),
    })
    .select("id")
    .single();
  if (orderError) throw orderError;
  const orderId = orderRow.id as number;

  if (items.length > 0) {
    const { error: itemsError } = await client.from("order_items").insert(
      items.map((i) => ({
        order_id: orderId, supplier_product_id: i.supplierProductId ?? null, product_name: i.productName,
        ordered_quantity: i.orderedQuantity, unit: i.unit, base_price: i.basePrice, vat_percent: i.vatPercent,
        discount_percent: i.discountPercent, net_amount: i.netAmount, vat_amount: i.vatAmount, gross_amount: i.grossAmount,
      }))
    );
    if (itemsError) throw itemsError;
  }
  return orderId;
}

export async function deleteOrder(id: number): Promise<void> {
  // order_items cascade-deletes via the foreign key's ON DELETE CASCADE.
  const { error } = await requireClient().from("orders").delete().eq("id", id);
  if (error) throw error;
}

export async function updateOrderStatus(id: number, fields: { invoiceNumber?: string; status?: string; totalNet?: string; totalVat?: string; totalGross?: string }): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (fields.invoiceNumber !== undefined) patch.invoice_number = fields.invoiceNumber;
  if (fields.status !== undefined) patch.status = fields.status;
  if (fields.totalNet !== undefined) patch.total_net = strToNum(fields.totalNet);
  if (fields.totalVat !== undefined) patch.total_vat = strToNum(fields.totalVat);
  if (fields.totalGross !== undefined) patch.total_gross = strToNum(fields.totalGross);
  const { error } = await requireClient().from("orders").update(patch).eq("id", id);
  if (error) throw error;
}

interface OrderItemRow {
  id: number; order_id: number; supplier_product_id: number | null; product_name: string;
  ordered_quantity: number; delivered_quantity: number | null; unit: string; base_price: number;
  vat_percent: number; discount_percent: number; net_amount: number; vat_amount: number; gross_amount: number;
  created_at: string; orders: { order_number: string; order_date: string; invoice_number: string | null; suppliers: { name: string; name_en: string | null } | null } | null;
}

function mapOrderItem(row: OrderItemRow): OrderItem {
  return {
    id: row.id, orderId: row.order_id, supplierProductId: row.supplier_product_id, productName: row.product_name,
    orderedQuantity: numToStr(row.ordered_quantity), deliveredQuantity: row.delivered_quantity == null ? null : numToStr(row.delivered_quantity),
    unit: row.unit, basePrice: numToStr(row.base_price), vatPercent: numToStr(row.vat_percent),
    discountPercent: numToStr(row.discount_percent), netAmount: numToStr(row.net_amount), vatAmount: numToStr(row.vat_amount),
    grossAmount: numToStr(row.gross_amount), createdAt: row.created_at,
    orderNumber: row.orders?.order_number ?? null, orderDate: row.orders?.order_date ?? null,
    invoiceNumber: row.orders?.invoice_number ?? null, supplierName: row.orders?.suppliers?.name ?? null,
    supplierNameEn: row.orders?.suppliers?.name_en ?? null,
  };
}

export async function fetchOrderItems(): Promise<OrderItem[]> {
  const client = requireClient();
  const data = await fetchAllPages<unknown>((from, to) => client
    .from("order_items")
    .select("id, order_id, supplier_product_id, product_name, ordered_quantity, delivered_quantity, unit, base_price, vat_percent, discount_percent, net_amount, vat_amount, gross_amount, created_at, orders(order_number, order_date, invoice_number, suppliers(name, name_en))")
    .order("id", { ascending: false })
    .range(from, to));
  return data.map((r) => mapOrderItem(r as unknown as OrderItemRow));
}

/**
 * Αναζήτηση order_items βάσει product_name (ILIKE) — server-side.
 * Επιστρέφει μοναδικά product_names (το πιο πρόσφατο ανά όνομα).
 */
export async function searchOrderItemsByName(query: string): Promise<OrderItem[]> {
  if (!query.trim()) return [];
  const { data, error } = await requireClient()
    .from("order_items")
    .select("id, order_id, supplier_product_id, product_name, ordered_quantity, delivered_quantity, unit, base_price, vat_percent, discount_percent, net_amount, vat_amount, gross_amount, created_at, orders(order_number, order_date, invoice_number, suppliers(name, name_en))")
    .ilike("product_name", `%${query.trim()}%`)
    .order("id", { ascending: false })
    .limit(100);
  if (error) throw error;
  // Κρατάμε μόνο το τελευταίο (πιο πρόσφατο) ανά product_name
  const seen = new Map<string, OrderItem>();
  for (const r of (data ?? []).map((row) => mapOrderItem(row as unknown as OrderItemRow))) {
    const key = r.productName.trim().toLowerCase();
    if (!seen.has(key)) seen.set(key, r);
  }
  return Array.from(seen.values()).slice(0, 25);
}

export async function fetchOrderItemsForOrder(orderId: number): Promise<OrderItem[]> {
  const { data, error } = await requireClient()
    .from("order_items")
    .select("id, order_id, supplier_product_id, product_name, ordered_quantity, delivered_quantity, unit, base_price, vat_percent, discount_percent, net_amount, vat_amount, gross_amount, created_at")
    .eq("order_id", orderId);
  if (error) throw error;
  return (data ?? []).map((r) =>
    mapOrderItem({ ...(r as Record<string, unknown>), orders: null } as unknown as OrderItemRow)
  );
}

export async function updateOrderItem(id: number, fields: { deliveredQuantity?: number; basePrice?: number; netAmount?: number; vatAmount?: number; grossAmount?: number }): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (fields.deliveredQuantity !== undefined) patch.delivered_quantity = fields.deliveredQuantity;
  if (fields.basePrice !== undefined) patch.base_price = fields.basePrice;
  if (fields.netAmount !== undefined) patch.net_amount = fields.netAmount;
  if (fields.vatAmount !== undefined) patch.vat_amount = fields.vatAmount;
  if (fields.grossAmount !== undefined) patch.gross_amount = fields.grossAmount;
  const { error } = await requireClient().from("order_items").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteOrderItem(id: number): Promise<void> {
  const { error } = await requireClient().from("order_items").delete().eq("id", id);
  if (error) throw error;
}

// ------------------------------------------------------------
// SUPPLIER PAYMENTS
// ------------------------------------------------------------
interface PaymentRow {
  id: number; supplier_id: number; transaction_date: string; amount: number; type: string;
  reference: string | null; notes: string | null; created_at: string; suppliers: { name: string; name_en: string | null } | null;
}

function mapPayment(row: PaymentRow): SupplierPayment {
  return {
    id: row.id, supplierId: row.supplier_id, transactionDate: row.transaction_date, amount: numToStr(row.amount),
    type: row.type, reference: row.reference, notes: row.notes, createdAt: row.created_at,
    supplierName: row.suppliers?.name, supplierNameEn: row.suppliers?.name_en ?? null,
  };
}

export async function fetchPayments(): Promise<SupplierPayment[]> {
  const client = requireClient();
  const data = await fetchAllPages<unknown>((from, to) => client
    .from("supplier_payments")
    .select("id, supplier_id, transaction_date, amount, type, reference, notes, created_at, suppliers(name, name_en)")
    .order("transaction_date", { ascending: false })
    .order("id", { ascending: false })
    .range(from, to));
  return data.map((r) => mapPayment(r as unknown as PaymentRow));
}

// ─── Μαζική εισαγωγή ιστορικού από Excel ─────────────────────────────────────

export interface BulkOrderInput {
  orderNumber: string; supplierId: number; orderDate: string; invoiceNumber: string | null;
  notes: string | null; totalNet: number; totalVat: number; totalGross: number;
}
export interface BulkOrderItemInput {
  orderId: number; productName: string; quantity: number; unit: string; basePrice: number;
  vatPercent: number; netAmount: number; vatAmount: number; grossAmount: number;
}
export interface BulkDebitInput {
  supplierId: number; transactionDate: string; amount: number; reference: string; notes: string | null;
}

/** Εισάγει παραγγελίες ως «Παραδόθηκε». Επιστρέφει order_number → id. */
export async function bulkInsertOrders(rows: BulkOrderInput[]): Promise<Map<string, number>> {
  const client = requireClient();
  const ids = new Map<string, number>();
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const { data, error } = await client.from("orders").insert(chunk.map(o => ({
      order_number: o.orderNumber, supplier_id: o.supplierId, order_date: o.orderDate,
      invoice_number: o.invoiceNumber, delivery_note_number: null, notes: o.notes, status: "delivered" as const,
      total_net: o.totalNet, total_vat: o.totalVat, total_gross: o.totalGross,
    }))).select("id, order_number");
    if (error) throw error;
    for (const r of (data ?? []) as { id: number; order_number: string }[]) ids.set(r.order_number, r.id);
  }
  return ids;
}

/** Πλήθος & καθαρή αξία ειδών ανά παραγγελία (έλεγχοι εισαγωγής/συμφωνίας). */
export async function fetchOrderItemStats(): Promise<Map<number, { count: number; net: number }>> {
  const client = requireClient();
  const rows = await fetchAllPages<{ order_id: number; net_amount: number }>((from, to) =>
    client.from("order_items").select("order_id, net_amount").order("id", { ascending: true }).range(from, to));
  const m = new Map<number, { count: number; net: number }>();
  for (const r of rows) {
    const e = m.get(r.order_id) ?? { count: 0, net: 0 };
    e.count++; e.net += Number(r.net_amount || 0);
    m.set(r.order_id, e);
  }
  return m;
}

/** Σβήνει όλα τα είδη μιας παραγγελίας και ελέγχει ότι πράγματι σβήστηκαν. */
export async function replaceOrderItemsDelete(orderId: number, expected: number): Promise<void> {
  const { data, error } = await requireClient().from("order_items").delete().eq("order_id", orderId).select("id");
  if (error) throw error;
  if (expected > 0 && (data ?? []).length === 0) {
    throw new Error("Η βάση δεν επέτρεψε τη διαγραφή των παλιών ειδών (δικαιώματα RLS)");
  }
}

export async function bulkInsertOrderItems(rows: BulkOrderItemInput[]): Promise<void> {
  const client = requireClient();
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await client.from("order_items").insert(rows.slice(i, i + 500).map(it => ({
      order_id: it.orderId, supplier_product_id: null, product_name: it.productName,
      ordered_quantity: it.quantity, delivered_quantity: it.quantity, unit: it.unit, base_price: it.basePrice,
      vat_percent: it.vatPercent, discount_percent: 0, net_amount: it.netAmount, vat_amount: it.vatAmount,
      gross_amount: it.grossAmount,
    })));
    if (error) throw error;
  }
}

export async function bulkInsertDebits(rows: BulkDebitInput[]): Promise<void> {
  const client = requireClient();
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await client.from("supplier_payments").insert(rows.slice(i, i + 500).map(d => ({
      supplier_id: d.supplierId, transaction_date: d.transactionDate, amount: d.amount, type: "debit" as const,
      reference: d.reference, notes: d.notes,
    })));
    if (error) throw error;
  }
}

export async function createPayment(input: { supplierId: number; transactionDate: string; amount: string; type: "debit" | "payment"; reference?: string | null; notes?: string | null }): Promise<void> {
  const { error } = await requireClient().from("supplier_payments").insert({
    supplier_id: input.supplierId, transaction_date: input.transactionDate, amount: strToNum(input.amount),
    type: input.type, reference: input.reference ?? null, notes: input.notes ?? null,
  });
  if (error) throw error;
}

export async function deletePayment(id: number): Promise<void> {
  const { error } = await requireClient().from("supplier_payments").delete().eq("id", id);
  if (error) throw error;
}

// ------------------------------------------------------------
// STOCK TAKINGS + ITEMS
// ------------------------------------------------------------
function mapStockTakingItem(row: {
  id: number; product_name: string; initial_stock: number; supplier: string | null;
  last_purchase_date: string | null; price: number; unit: string; manual_count: number | null;
  inventory_value: number; variance: number;
}): StockTakingItem {
  return {
    id: row.id, productName: row.product_name, initialStock: numToStr(row.initial_stock), supplier: row.supplier ?? "",
    lastPurchaseDate: row.last_purchase_date ?? "", price: numToStr(row.price), unit: row.unit,
    manualCount: row.manual_count == null ? "" : numToStr(row.manual_count), inventoryValue: numToStr(row.inventory_value),
    variance: numToStr(row.variance),
  };
}

export async function fetchStockTakings(): Promise<StockTaking[]> {
  const client = requireClient();
  const { data: takings, error } = await client.from("stock_takings").select("id, taking_date, notes, total_recorded_value, total_purchase_value, total_quantity_bought, distinct_sku_count, created_at").order("id", { ascending: false });
  if (error) throw error;
  const result: StockTaking[] = [];
  for (const t of takings ?? []) {
    const { data: items, error: itemsError } = await client.from("stock_taking_items").select("id, stock_taking_id, product_name, initial_stock, supplier, last_purchase_date, price, unit, manual_count, inventory_value, variance").eq("stock_taking_id", t.id);
    if (itemsError) throw itemsError;
    result.push({
      id: t.id, takingDate: t.taking_date, notes: t.notes, totalRecordedValue: numToStr(t.total_recorded_value),
      totalPurchaseValue: numToStr(t.total_purchase_value), totalQuantityBought: numToStr(t.total_quantity_bought),
      distinctSkuCount: t.distinct_sku_count, createdAt: t.created_at, items: (items ?? []).map(mapStockTakingItem),
    });
  }
  return result;
}

export async function createStockTaking(
  taking: { takingDate: string; notes?: string | null; totalRecordedValue: string; totalPurchaseValue: string; totalQuantityBought: string; distinctSkuCount: number },
  items: { productName: string; initialStock: string; supplier: string; lastPurchaseDate: string; price: string; unit: string; manualCount: string; inventoryValue: string; variance: string }[]
): Promise<number> {
  const client = requireClient();
  const { data: takingRow, error: takingError } = await client
    .from("stock_takings")
    .insert({
      taking_date: taking.takingDate, notes: taking.notes ?? null, total_recorded_value: strToNum(taking.totalRecordedValue),
      total_purchase_value: strToNum(taking.totalPurchaseValue), total_quantity_bought: strToNum(taking.totalQuantityBought),
      distinct_sku_count: taking.distinctSkuCount,
    })
    .select("id")
    .single();
  if (takingError) throw takingError;
  const takingId = takingRow.id as number;

  if (items.length > 0) {
    const { error: itemsError } = await client.from("stock_taking_items").insert(
      items.map((i) => ({
        stock_taking_id: takingId, product_name: i.productName, initial_stock: strToNum(i.initialStock),
        supplier: i.supplier, last_purchase_date: i.lastPurchaseDate || null, price: strToNum(i.price), unit: i.unit,
        manual_count: i.manualCount ? strToNum(i.manualCount) : null, inventory_value: strToNum(i.inventoryValue),
        variance: strToNum(i.variance),
      }))
    );
    if (itemsError) throw itemsError;
  }
  return takingId;
}

// ------------------------------------------------------------
// INVENTORY SNAPSHOTS
// ------------------------------------------------------------
export async function fetchInventorySnapshots(): Promise<InventorySnapshot[]> {
  const { data, error } = await requireClient().from("inventory_snapshots").select("id, snapshot_date, month_label, recorded_value, previous_value, delta_variance, notes, created_at").order("snapshot_date", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id, snapshotDate: r.snapshot_date, monthLabel: r.month_label, recordedValue: numToStr(r.recorded_value),
    previousValue: numToStr(r.previous_value), deltaVariance: numToStr(r.delta_variance), notes: r.notes, createdAt: r.created_at,
  }));
}

// ------------------------------------------------------------
// INGREDIENTS
// ------------------------------------------------------------
function mapIngredient(row: {
  id: number; sku: string; name: string; name_en: string | null; current_stock: number; unit: string;
  base_price: number; conversion_factor: number; conversion_per_unit: string | null; wastage_factor: number;
  calories: number; is_active: boolean | null; created_at: string;
}): Ingredient {
  return {
    id: row.id, sku: row.sku, name: row.name, nameEn: row.name_en, currentStock: numToStr(row.current_stock),
    unit: row.unit, basePrice: numToStr(row.base_price), conversionFactor: numToStr(row.conversion_factor),
    conversionPerUnit: row.conversion_per_unit, wastageFactor: numToStr(row.wastage_factor), calories: row.calories,
    isActive: row.is_active, createdAt: row.created_at,
  };
}

export async function fetchIngredients(): Promise<Ingredient[]> {
  // σε σελίδες — τα υλικά είναι 2.800+ και το Supabase δίνει έως 1000 ανά αίτημα
  const client = requireClient();
  const data = await fetchAllPages<any>((from, to) => client.from("ingredients")
    .select("id, sku, name, name_en, current_stock, unit, base_price, conversion_factor, conversion_per_unit, mapped_supplier_product_id, wastage_factor, calories, is_active, created_at")
    .order("name", { ascending: true }).order("id", { ascending: true }).range(from, to));
  return data.map(mapIngredient);
}

export interface IngredientCurrentPrice {
  unitCost: number;
  unit: string;
  priceSource: "order_history" | "supplier_offer" | "none";
  sourceDetail: string | null;
  supplierName: string | null;
}

/** Τελευταία τιμή αγοράς υλικού από το ιστορικό παραγγελιών.
 * Ψάχνει στα order_items μέσω mapped_supplier_product_id του υλικού.
 * Αν δεν υπάρχει mapping, ψάχνει με fuzzy match στο product_name.
 * Fallback: τιμή από supplier_products, μετά base_price του ingredient.
 * Επιστρέφει null μόνο αν το αίτημα αποτύχει (π.χ. δίκτυο) --
 * αν το υλικό απλά δεν έχει καμία τιμή ακόμα, επιστρέφει ρητά
 * { unitCost: 0, priceSource: "none", ... }, όχι null. */
export async function getIngredientCurrentPrice(ingredientId: number): Promise<IngredientCurrentPrice | null> {
  const client = requireClient();

  // Βρες το ingredient για να πάρεις mapped_supplier_product_id, base_price και name
  const { data: ingData } = await client
    .from("ingredients")
    .select("base_price, unit, mapped_supplier_product_id, name")
    .eq("id", ingredientId)
    .single();

  const baseUnit = ingData?.unit ?? "kg";
  const basePrice = Number(ingData?.base_price ?? 0);
  const mappedSpId = ingData?.mapped_supplier_product_id ?? null;
  const ingName = (ingData?.name ?? "").toLowerCase();

  if (mappedSpId) {
    // 1. Φέρε το product_name από supplier_products για να ψάξουμε στο order_items
    const { data: spDataFirst } = await client
      .from("supplier_products")
      .select("base_price, unit, supplier_id, product_name")
      .eq("id", mappedSpId)
      .single();

    // 1b. Ψάξε στο ιστορικό παραγγελιών: πρώτα με supplier_product_id, μετά με product_name
    let orderData: Array<{ base_price: number; unit: string; orders: { order_date: string; supplier_id: number | null } }> | null = null;

    // Πρώτη προσπάθεια: exact supplier_product_id match
    const { data: orderById } = await client
      .from("order_items")
      .select("base_price, unit, orders!inner(order_date, supplier_id)")
      .eq("supplier_product_id", mappedSpId)
      .order("orders(order_date)", { ascending: false })
      .limit(1);
    if (orderById && orderById.length > 0) {
      orderData = orderById as unknown as typeof orderData;
    }

    // Δεύτερη προσπάθεια: αν δεν βρήκαμε, ψάξε με product_name
    if (!orderData && spDataFirst?.product_name) {
      const { data: orderByName } = await client
        .from("order_items")
        .select("base_price, unit, orders!inner(order_date, supplier_id)")
        .ilike("product_name", spDataFirst.product_name)
        .order("orders(order_date)", { ascending: false })
        .limit(1);
      if (orderByName && orderByName.length > 0) {
        orderData = orderByName as unknown as typeof orderData;
      }
    }

    if (orderData && (orderData as unknown[]).length > 0) {
      const row = (orderData as unknown as Array<{ base_price: number; unit: string; orders: { order_date: string; supplier_id: number | null } }>)[0];
      // Βρες το όνομα του προμηθευτή
      let supplierName: string | null = null;
      const supplierId = row.orders?.supplier_id;
      if (supplierId) {
        const { data: supData } = await client.from("suppliers").select("name").eq("id", supplierId).single();
        supplierName = supData?.name ?? null;
      }
      return {
        unitCost: Number(row.base_price ?? 0),
        unit: row.unit ?? baseUnit,
        priceSource: "order_history",
        sourceDetail: null,
        supplierName,
      };
    }

    // 2. Fallback: τρέχουσα τιμή από supplier_products (spDataFirst ήδη φορτωμένο)
    if (spDataFirst) {
      let supplierName: string | null = null;
      if (spDataFirst.supplier_id) {
        const { data: supData } = await client.from("suppliers").select("name").eq("id", spDataFirst.supplier_id).single();
        supplierName = supData?.name ?? null;
      }
      return {
        unitCost: Number(spDataFirst.base_price ?? 0),
        unit: spDataFirst.unit ?? baseUnit,
        priceSource: "supplier_offer",
        sourceDetail: null,
        supplierName,
      };
    }
  }

  // 3. Αν δεν υπάρχει mapping, δοκίμασε name-based αναζήτηση
  // Στρατηγική: φέρνουμε 20 candidates με prefix και επιλέγουμε το καλύτερο match
  if (ingName) {
    // Helper: αφαίρεση τόνων + παρενθέσεων + ειδικών χαρακτήρων
    const stripAndClean = (s: string) =>
      s.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
       .replace(/[()[\]{}.,\-_/\\]/g, " ")
       .replace(/\s+/g, " ").trim().toLowerCase();

    const cleanName = stripAndClean(ingName);
    const ingWords = new Set(cleanName.split(" ").filter(w => w.length >= 3));

    // Σκορ ομοιότητας: prefix match μεταξύ λέξεων ingredient και product
    // π.χ. "κρεμμυδι" ταιριάζει "κρεμμυδια", "κρεμμυδιου" κλπ
    const similarityScore = (productName: string): number => {
      const ingWordsList = cleanName.split(" ").filter(w => w.length >= 4);
      const pWords = stripAndClean(productName).split(" ").filter(w => w.length >= 4);
      let score = 0;
      for (const iw of ingWordsList) {
        for (const pw of pWords) {
          const shorter = iw.length < pw.length ? iw : pw;
          const longer  = iw.length < pw.length ? pw  : iw;
          if (longer.startsWith(shorter)) score += shorter.length;
        }
      }
      return score;
    };

    // Ψάξε με ΚΑΘΕ σημαντική λέξη (>=4 γράμματα) — συγκέντρωσε όλα τα candidates
    const sigWords = cleanName.split(" ").filter(w => w.length >= 4);
    // Αν δεν υπάρχουν σημαντικές λέξεις, χρησιμοποίησε τα πρώτα 5 γράμματα
    const searchTerms = sigWords.length > 0 ? sigWords : [cleanName.substring(0, 5)];
    // Επίσης ψάξε με τα πρώτα 5 γράμματα κάθε σημαντικής λέξης (prefix search)
    // π.χ. "κρεμμυδι" → ψάξε και με "κρεμμ" για να βρεις "ΚΡΕΜΜΥΔΙΑ ΒΑΤΙΚΑ"
    const prefixTerms = sigWords.map(w => w.substring(0, 5)).filter(p => p.length >= 4);
    const allSearchTerms = [...new Set([...searchTerms, ...prefixTerms])];

    // 3a. Ψάξε στο order_items — ψάχνουμε με κάθε λέξη, συγκεντρώνουμε candidates
    // Φέρνουμε order_date για να πάρουμε την πιο πρόσφατη τιμή σε περίπτωση ισοπαλίας
    const allOrderRows: unknown[] = [];
    for (const term of allSearchTerms) {
      const { data: d } = await client
        .from("order_items")
        .select("base_price, unit, product_name, orders!inner(order_date, supplier_id)")
        .ilike("product_name", `%${term}%`)
        .gt("base_price", 0)
        .order("orders(order_date)", { ascending: false })
        .limit(30);
      if (d) allOrderRows.push(...d);
    }

    if (allOrderRows.length > 0) {
      type OrderRow = { base_price: number; unit: string; product_name: string; orders: { supplier_id: number | null; order_date: string } };
      const rows = allOrderRows as unknown as OrderRow[];
      // Σκοράρουμε ΟΛΑ τα candidates. Σε ισοπαλία, κερδίζει η πιο πρόσφατη παραγγελία.
      let bestRow = rows[0];
      let bestScore = -1;
      for (const row of rows) {
        const score = similarityScore(row.product_name);
        if (score > bestScore ||
            (score === bestScore && (row.orders?.order_date ?? "") > (bestRow.orders?.order_date ?? ""))) {
          bestScore = score;
          bestRow = row;
        }
      }
      let supplierName: string | null = null;
      const supplierId = bestRow.orders?.supplier_id;
      if (supplierId) {
        const { data: supData } = await client.from("suppliers").select("name").eq("id", supplierId).single();
        supplierName = supData?.name ?? null;
      }
      return {
        unitCost: Number(bestRow.base_price ?? 0),
        unit: bestRow.unit ?? baseUnit,
        priceSource: "order_history",
        sourceDetail: "name_match",
        supplierName,
      };
    }

    // 3b. Ψάξε στο supplier_products — ψάχνουμε με κάθε λέξη
    const allSpRows: unknown[] = [];
    for (const term of allSearchTerms) {
      const { data: d } = await client
        .from("supplier_products")
        .select("base_price, unit, supplier_id, product_name")
        .ilike("product_name", `%${term}%`)
        .gt("base_price", 0)
        .limit(30);
      if (d) allSpRows.push(...d);
    }

    if (allSpRows.length > 0) {
      type SpRow = { base_price: number; unit: string; supplier_id: number | null; product_name: string };
      const spRows = allSpRows as SpRow[];
      let bestSp = spRows[0];
      let bestSpScore = -1;
      for (const row of spRows) {
        const score = similarityScore(row.product_name);
        if (score > bestSpScore) { bestSpScore = score; bestSp = row; }
      }
      let supplierName: string | null = null;
      if (bestSp.supplier_id) {
        const { data: supData } = await client.from("suppliers").select("name").eq("id", bestSp.supplier_id).single();
        supplierName = supData?.name ?? null;
      }
      return {
        unitCost: Number(bestSp.base_price ?? 0),
        unit: bestSp.unit ?? baseUnit,
        priceSource: "supplier_offer",
        sourceDetail: "name_match",
        supplierName,
      };
    }
  }

  // 5. Τελικό fallback: base_price του ingredient

  // 5. Τελικό fallback: base_price του ingredient
  return {
    unitCost: basePrice,
    unit: baseUnit,
    priceSource: "none",
    sourceDetail: null,
    supplierName: null,
  };
}

export async function createIngredient(input: {
  sku: string; name: string; nameEn?: string | null; currentStock: string; unit: string; basePrice: string;
  conversionFactor: string; conversionPerUnit?: string | null; wastageFactor: string; calories: number;
}): Promise<void> {
  const { error } = await requireClient().from("ingredients").insert({
    sku: input.sku, name: input.name, name_en: input.nameEn ?? null, current_stock: strToNum(input.currentStock),
    unit: input.unit, base_price: strToNum(input.basePrice), conversion_factor: strToNum(input.conversionFactor),
    conversion_per_unit: input.conversionPerUnit ?? null, wastage_factor: strToNum(input.wastageFactor),
    calories: input.calories, is_active: true,
  });
  if (error) throw error;
}

export async function createIngredientsBulk(
  rows: { sku: string; name: string; nameEn?: string | null; currentStock: string; unit: string; basePrice: string; wastageFactor: string; calories: number }[]
): Promise<number> {
  if (rows.length === 0) return 0;
  const { error, count } = await requireClient()
    .from("ingredients")
    .insert(
      rows.map((r) => ({
        sku: r.sku, name: r.name, name_en: r.nameEn ?? null, current_stock: strToNum(r.currentStock), unit: r.unit,
        base_price: strToNum(r.basePrice), conversion_factor: 1, wastage_factor: strToNum(r.wastageFactor),
        calories: r.calories, is_active: true,
      })),
      { count: "exact" }
    );
  if (error) throw error;
  return count ?? rows.length;
}

export async function deleteIngredient(id: number): Promise<void> {
  const { error } = await requireClient().from("ingredients").delete().eq("id", id);
  if (error) throw error;
}

// ------------------------------------------------------------
// RECIPES + RECIPE INGREDIENTS
// ------------------------------------------------------------
function mapRecipeIngredient(row: {
  id: number; recipe_id: number; ingredient_id: number | null; ingredient_name: string; quantity: number;
  unit: string; unit_cost: number; total_cost: number; wastage_factor: number; requires_prep: boolean; prep_notes: string | null;
}): RecipeIngredient {
  return {
    id: row.id, recipeId: row.recipe_id, ingredientId: row.ingredient_id ?? 0, ingredientName: row.ingredient_name,
    quantity: row.quantity, unit: row.unit, unitCost: row.unit_cost, totalCost: row.total_cost,
    wastageFactor: row.wastage_factor, requiresPrep: row.requires_prep, prepNotes: row.prep_notes ?? "",
  };
}

let hasMyPriceColumn = false;
export function recipesHaveMyPriceColumn() { return hasMyPriceColumn; }

export interface RecipeCostingSave {
  laborCost: number; overheadCost: number; profitMarginPercent: number; mySellingPrice: number;
  rawMaterial: number; totalCost: number; sellingPrice: number; menuPriceVat: number; menuPriceFinal: number;
}
/** Αποθηκεύει την κοστολόγηση μιας συνταγής (ό,τι έβαλε ο χρήστης + τα σύνολα). */
export async function saveRecipeCosting(id: number, v: RecipeCostingSave): Promise<{ savedMyPrice: boolean }> {
  const client = requireClient();
  const r2 = (n: number) => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
  const base: Record<string, number> = {
    labor_cost: r2(v.laborCost), overhead_cost: r2(v.overheadCost), profit_margin_percent: r2(v.profitMarginPercent),
    total_raw_material_cost: r2(v.rawMaterial), total_cost: r2(v.totalCost), selling_price: r2(v.sellingPrice),
    menu_price_vat: r2(v.menuPriceVat), menu_price_final: r2(v.menuPriceFinal),
  };
  if (hasMyPriceColumn) {
    const { error } = await client.from("recipes").update({ ...base, my_selling_price: r2(v.mySellingPrice) } as never).eq("id", id);
    if (!error) return { savedMyPrice: true };
    hasMyPriceColumn = false;
  }
  const { error } = await client.from("recipes").update(base as never).eq("id", id);
  if (error) throw error;
  return { savedMyPrice: false };
}

export async function fetchRecipes(): Promise<Recipe[]> {
  const client = requireClient();

  // Όλες οι συνταγές (χωρίς τα υλικά τους ακόμα), σε σελίδες
  const RECIPE_COLS = "id, name, name_en, portion_yield, portion_unit, allergens, technical_guide, total_raw_material_cost, labor_cost, overhead_cost, total_cost, profit_margin_percent, selling_price, menu_price_vat, menu_price_final, is_active, created_at";
  const loadRecipes = (cols: string) => fetchAllPages<any>((from, to) => client
    .from("recipes")
    .select(cols)
    .order("name", { ascending: true })
    .order("id", { ascending: true })
    .range(from, to));
  // my_selling_price: νέα στήλη (migration_recipe_my_price.sql). Αν δεν έχει τρέξει ακόμα, φορτώνει χωρίς αυτήν.
  let recipes: any[];
  try {
    recipes = await loadRecipes(RECIPE_COLS + ", my_selling_price");
    hasMyPriceColumn = true;
  } catch {
    recipes = await loadRecipes(RECIPE_COLS);
    hasMyPriceColumn = false;
  }

  // Όλες οι γραμμές recipe_ingredients σε σελίδες των 1000 (όριο Supabase).
  const allIngredients = await fetchAllPages<{
    id: number; recipe_id: number; ingredient_id: number | null;
    ingredient_name: string; quantity: number; unit: string;
    unit_cost: number; total_cost: number; wastage_factor: number;
    requires_prep: boolean; prep_notes: string | null;
  }>((from, to) => client
    .from("recipe_ingredients")
    .select("id, recipe_id, ingredient_id, ingredient_name, quantity, unit, unit_cost, total_cost, wastage_factor, requires_prep, prep_notes")
    .order("id", { ascending: true })
    .range(from, to));

  // Ομαδοποίηση στη μνήμη: recipe_id -> λίστα υλικών του.
  const ingredientsByRecipeId = new Map<number, typeof allIngredients>();
  for (const ing of allIngredients ?? []) {
    const list = ingredientsByRecipeId.get(ing.recipe_id) ?? [];
    list.push(ing);
    ingredientsByRecipeId.set(ing.recipe_id, list);
  }

  const result: Recipe[] = [];
  for (const r of recipes ?? []) {
    const ingredients = ingredientsByRecipeId.get(r.id) ?? [];
    result.push({
      id: r.id, name: r.name, nameEn: r.name_en, portionYield: numToStr(r.portion_yield), portionUnit: r.portion_unit,
      allergens: JSON.stringify(r.allergens ?? []), technicalGuide: r.technical_guide,
      totalRawMaterialCost: numToStr(r.total_raw_material_cost), laborCost: numToStr(r.labor_cost),
      overheadCost: numToStr(r.overhead_cost), totalCost: numToStr(r.total_cost),
      profitMarginPercent: numToStr(r.profit_margin_percent), sellingPrice: numToStr(r.selling_price),
      menuPriceVat: numToStr(r.menu_price_vat), menuPriceFinal: numToStr(r.menu_price_final), isActive: r.is_active,
      mySellingPrice: numToStr(r.my_selling_price ?? 0),
      createdAt: r.created_at, ingredients: ingredients.map(mapRecipeIngredient),
    });
  }
  return result;
}

// Ενημερώνει ΜΟΝΟ τα δικά της πεδία μιας συνταγής (όνομα, μερίδες,
// αλλεργιογόνα, τεχνικός οδηγός, κοστολόγηση) — χωρίς να αγγίζει
// καθόλου το recipe_ingredients. Χρησιμοποιείται από την
// απλοποιημένη σελίδα Συνταγές, αφού η διαχείριση υλικών μετακόμισε
// στη δική της σελίδα (Υλικά Συνταγών) με ανεξάρτητες, άμεσες
// αποθηκεύσεις ανά γραμμή (βλέπε addRecipeIngredient κλπ. πιο κάτω).
export async function updateRecipeDetails(
  id: number,
  recipe: Omit<Recipe, "id" | "createdAt" | "ingredients">
): Promise<void> {
  const payload = {
    name: recipe.name, name_en: recipe.nameEn, portion_yield: strToNum(recipe.portionYield), portion_unit: recipe.portionUnit,
    allergens: typeof recipe.allergens === "string" ? JSON.parse(recipe.allergens || "[]") : recipe.allergens ?? [],
    technical_guide: recipe.technicalGuide, total_raw_material_cost: strToNum(recipe.totalRawMaterialCost),
    labor_cost: strToNum(recipe.laborCost), overhead_cost: strToNum(recipe.overheadCost), total_cost: strToNum(recipe.totalCost),
    profit_margin_percent: strToNum(recipe.profitMarginPercent), selling_price: strToNum(recipe.sellingPrice),
    menu_price_vat: strToNum(recipe.menuPriceVat), menu_price_final: strToNum(recipe.menuPriceFinal), is_active: recipe.isActive ?? true,
  };
  const { error } = await requireClient().from("recipes").update(payload).eq("id", id);
  if (error) throw error;
}

// Δημιουργεί μια νέα, κενή συνταγή (μόνο τα δικά της πεδία, χωρίς
// υλικά ακόμα) — επιστρέφει το νέο id, ώστε ο χρήστης να μπορεί
// αμέσως μετά να πάει στη σελίδα Υλικά Συνταγών και να αρχίσει να
// προσθέτει υλικά σε αυτήν.
export async function createRecipeDetails(
  recipe: Omit<Recipe, "id" | "createdAt" | "ingredients">
): Promise<number> {
  const payload = {
    name: recipe.name, name_en: recipe.nameEn, portion_yield: strToNum(recipe.portionYield), portion_unit: recipe.portionUnit,
    allergens: typeof recipe.allergens === "string" ? JSON.parse(recipe.allergens || "[]") : recipe.allergens ?? [],
    technical_guide: recipe.technicalGuide, total_raw_material_cost: strToNum(recipe.totalRawMaterialCost),
    labor_cost: strToNum(recipe.laborCost), overhead_cost: strToNum(recipe.overheadCost), total_cost: strToNum(recipe.totalCost),
    profit_margin_percent: strToNum(recipe.profitMarginPercent), selling_price: strToNum(recipe.sellingPrice),
    menu_price_vat: strToNum(recipe.menuPriceVat), menu_price_final: strToNum(recipe.menuPriceFinal), is_active: recipe.isActive ?? true,
  };
  const { data, error } = await requireClient().from("recipes").insert(payload).select("id").single();
  if (error) throw error;
  return data.id as number;
}

export async function upsertRecipe(recipe: Omit<Recipe, "id" | "createdAt"> & { id?: number }): Promise<number> {
  const client = requireClient();
  const payload = {
    name: recipe.name, name_en: recipe.nameEn, portion_yield: strToNum(recipe.portionYield), portion_unit: recipe.portionUnit,
    allergens: typeof recipe.allergens === "string" ? JSON.parse(recipe.allergens || "[]") : recipe.allergens ?? [],
    technical_guide: recipe.technicalGuide, total_raw_material_cost: strToNum(recipe.totalRawMaterialCost),
    labor_cost: strToNum(recipe.laborCost), overhead_cost: strToNum(recipe.overheadCost), total_cost: strToNum(recipe.totalCost),
    profit_margin_percent: strToNum(recipe.profitMarginPercent), selling_price: strToNum(recipe.sellingPrice),
    menu_price_vat: strToNum(recipe.menuPriceVat), menu_price_final: strToNum(recipe.menuPriceFinal), is_active: recipe.isActive ?? true,
  };

  let recipeId: number;
  if (recipe.id) {
    const { error } = await client.from("recipes").update(payload).eq("id", recipe.id);
    if (error) throw error;
    recipeId = recipe.id;
    // Replace all recipe_ingredients rows for this recipe — simplest
    // correct approach for an editor that submits the whole ingredient
    // list at once (delete-then-insert, both scoped to this recipe_id).
    const { error: delError } = await client.from("recipe_ingredients").delete().eq("recipe_id", recipeId);
    if (delError) throw delError;
  } else {
    const { data, error } = await client.from("recipes").insert(payload).select("id").single();
    if (error) throw error;
    recipeId = data.id as number;
  }

  if (recipe.ingredients.length > 0) {
    const { error: ingError } = await client.from("recipe_ingredients").insert(
      recipe.ingredients.map((i) => ({
        recipe_id: recipeId, ingredient_id: i.ingredientId || null, ingredient_name: i.ingredientName,
        quantity: i.quantity, unit: i.unit, unit_cost: i.unitCost, total_cost: i.totalCost,
        wastage_factor: i.wastageFactor, requires_prep: i.requiresPrep, prep_notes: i.prepNotes,
      }))
    );
    if (ingError) throw ingError;
  }
  return recipeId;
}

// ------------------------------------------------------------
// ΑΝΕΞΑΡΤΗΤΗ ΔΙΑΧΕΙΡΙΣΗ recipe_ingredients ΓΡΑΜΜΩΝ — για τη
// ξεχωριστή σελίδα "Υλικά Συνταγών". Σε αντίθεση με το upsertRecipe
// παραπάνω (που σβήνει ΟΛΑ τα υλικά μιας συνταγής και τα ξαναγράφει
// όλα μαζί -- σωστό όταν η φόρμα υποβάλλει ολόκληρη τη λίστα
// μονομιάς), αυτές οι τρεις συναρτήσεις επηρεάζουν ΜΟΝΟ τη δική
// τους γραμμή, ώστε προσθήκη/επεξεργασία/διαγραφή ενός υλικού να
// μην αγγίζει καθόλου τα υπόλοιπα υλικά της ίδιας συνταγής.
// ------------------------------------------------------------
// Φέρνει τα υλικά μιας συγκεκριμένης συνταγής απευθείας από τη ΒΔ
// (χωρίς να περνάει από το global context). Χρησιμοποιείται όταν
// ανοίγει η φόρμα μιας συνταγής, για να διασφαλίσουμε ότι τα υλικά
// φορτώνονται πάντα σωστά ανεξάρτητα από το μέγεθος του dataset.
export async function fetchRecipeIngredients(recipeId: number): Promise<RecipeIngredient[]> {
  const { data, error } = await requireClient()
    .from("recipe_ingredients")
    .select("id, recipe_id, ingredient_id, ingredient_name, quantity, unit, unit_cost, total_cost, wastage_factor, requires_prep, prep_notes")
    .eq("recipe_id", recipeId);
  if (error) throw error;
  return (data ?? []).map(mapRecipeIngredient);
}

export async function addRecipeIngredient(recipeId: number, item: RecipeIngredient): Promise<number> {
  const { data, error } = await requireClient()
    .from("recipe_ingredients")
    .insert({
      recipe_id: recipeId, ingredient_id: item.ingredientId || null, ingredient_name: item.ingredientName,
      quantity: item.quantity, unit: item.unit, unit_cost: item.unitCost, total_cost: item.totalCost,
      wastage_factor: item.wastageFactor, requires_prep: item.requiresPrep, prep_notes: item.prepNotes,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as number;
}

export async function updateRecipeIngredient(id: number, item: Partial<RecipeIngredient>): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (item.ingredientId !== undefined) patch.ingredient_id = item.ingredientId || null;
  if (item.ingredientName !== undefined) patch.ingredient_name = item.ingredientName;
  if (item.quantity !== undefined) patch.quantity = item.quantity;
  if (item.unit !== undefined) patch.unit = item.unit;
  if (item.unitCost !== undefined) patch.unit_cost = item.unitCost;
  if (item.totalCost !== undefined) patch.total_cost = item.totalCost;
  if (item.wastageFactor !== undefined) patch.wastage_factor = item.wastageFactor;
  if (item.requiresPrep !== undefined) patch.requires_prep = item.requiresPrep;
  if (item.prepNotes !== undefined) patch.prep_notes = item.prepNotes;
  const { error } = await requireClient().from("recipe_ingredients").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteRecipeIngredient(id: number): Promise<void> {
  const { error } = await requireClient().from("recipe_ingredients").delete().eq("id", id);
  if (error) throw error;
}

// ============================================================
// ingredient_supplier_map — τιμές υλικών από προσφορές
// ============================================================

// Φέρε mapping για λίστα ingredient names (batch)
export async function fetchIngredientSupplierMap(
  ingredientNames: string[]
): Promise<Record<string, { supplierProductId: number; productName: string; basePrice: string; supplierId: number; supplierName: string; unit: string } | null>> {
  if (ingredientNames.length === 0) return {};
  const client = requireClient();
  const { data, error } = await (client.from("ingredient_supplier_map") as any)
    .select("ingredient_name, supplier_product_id, is_manual, match_score, supplier_products(id, product_name, base_price, unit, supplier_id, suppliers(id, name))")
    .in("ingredient_name", ingredientNames);
  if (error) throw error;
  const result: Record<string, { supplierProductId: number; productName: string; basePrice: string; supplierId: number; supplierName: string; unit: string } | null> = {};
  for (const row of (data ?? []) as any[]) {
    const sp = row.supplier_products;
    if (sp) {
      result[row.ingredient_name] = {
        supplierProductId: sp.id,
        productName: sp.product_name,
        basePrice: sp.base_price,
        supplierId: sp.supplier_id,
        supplierName: sp.suppliers?.name ?? "",
        unit: sp.unit,
      };
    } else {
      result[row.ingredient_name] = null;
    }
  }
  return result;
}

// Φέρε όλους τους διαθέσιμους προμηθευτές για ένα ingredient name (για dropdown)
export async function fetchIngredientSupplierOptions(
  ingredientName: string
): Promise<{ supplierProductId: number; productName: string; basePrice: string; supplierId: number; supplierName: string; unit: string }[]> {
  const client = requireClient();
  // fuzzy: ψάχνουμε supplier_products με παρόμοιο όνομα μέσω SQL function
  const { data, error } = await (client as any).rpc("get_supplier_options_for_ingredient", { p_ingredient_name: ingredientName });
  if (error) {
    // fallback: απλό ilike search
    const { data: fb } = await (client.from("supplier_products") as any)
      .select("id, product_name, base_price, unit, supplier_id, suppliers(id, name)")
      .ilike("product_name", `%${ingredientName.slice(0, 6)}%`)
      .limit(10);
    return (fb ?? []).map((sp: any) => ({
      supplierProductId: sp.id,
      productName: sp.product_name,
      basePrice: sp.base_price,
      supplierId: sp.supplier_id,
      supplierName: sp.suppliers?.name ?? "",
      unit: sp.unit,
    }));
  }
  return (data ?? []).map((sp: any) => ({
    supplierProductId: sp.id,
    productName: sp.product_name,
    basePrice: sp.base_price,
    supplierId: sp.supplier_id,
    supplierName: sp.supplier_name ?? "",
    unit: sp.unit,
  }));
}

// Αποθήκευσε manual override προμηθευτή για υλικό
export async function setIngredientSupplierOverride(
  ingredientName: string,
  supplierProductId: number
): Promise<void> {
  const client = requireClient();
  const row = {
    ingredient_name: ingredientName,
    supplier_product_id: supplierProductId,
    is_manual: true,
    updated_at: new Date().toISOString(),
  };
  // Μετά τη μετάβαση «πολλές επιχειρήσεις» η μοναδικότητα είναι ανά επιχείρηση.
  let { error } = await (client.from("ingredient_supplier_map") as any).upsert(row, { onConflict: "business_id,ingredient_name" });
  if (error && (["42P10", "42703", "PGRST204"].includes(error.code) || /no unique|constraint matching|business_id/i.test(error.message ?? ""))) {
    ({ error } = await (client.from("ingredient_supplier_map") as any).upsert(row, { onConflict: "ingredient_name" }));
  }
  if (error) throw error;
}

export async function createRecipesBulk(
  rows: { name: string; nameEn?: string | null; portionYield: string; totalCost: string; sellingPrice: string; profitMarginPercent: string }[]
): Promise<number> {
  if (rows.length === 0) return 0;
  const { error, count } = await requireClient()
    .from("recipes")
    .insert(
      rows.map((r) => ({
        name: r.name, name_en: r.nameEn ?? null, portion_yield: strToNum(r.portionYield), portion_unit: "pcs",
        allergens: [], total_raw_material_cost: strToNum(r.totalCost), labor_cost: 0, overhead_cost: 0,
        total_cost: strToNum(r.totalCost), profit_margin_percent: strToNum(r.profitMarginPercent),
        selling_price: strToNum(r.sellingPrice), menu_price_vat: strToNum(r.sellingPrice) * 1.24,
        menu_price_final: strToNum(r.sellingPrice), is_active: true,
      })),
      { count: "exact" }
    );
  if (error) throw error;
  return count ?? rows.length;
}

export async function deleteRecipe(id: number): Promise<void> {
  const { error } = await requireClient().from("recipes").delete().eq("id", id);
  if (error) throw error;
}

// ------------------------------------------------------------
// BULK RECIPE + INGREDIENT IMPORT
// ------------------------------------------------------------
// Built specifically for large files (hundreds to thousands of rows,
// e.g. a 1,800-recipe catalog). The naive approach — one upsertRecipe()
// call per recipe in a loop — means one sequential network round trip
// per recipe, which for 1,800 recipes would take minutes and risks the
// browser tab stalling or a request timing out partway through.
//
// This does the same work in a FIXED number of round trips (5-6 total),
// regardless of how many rows are in the file:
//   1. Fetch existing ingredients (for name matching)
//   2. Bulk-insert any ingredients not found, in ONE insert
//   3. Bulk-insert all new recipes, in ONE insert
//   4. Bulk-insert all recipe_ingredients links, in ONE insert
export interface RecipeImportRow {
  recipeName: string;
  category?: string | null;
  portions: string;
  ingredientName: string;
  quantity: string;
  unit: string;
  instructions?: string | null;
}

export interface RecipeImportResult {
  recipesCreated: number;
  ingredientsCreated: number;
  ingredientLinesInserted: number;
  recipesSkipped: string[]; // recipe names that had zero valid ingredient rows
}

export async function bulkImportRecipesWithIngredients(rows: RecipeImportRow[]): Promise<RecipeImportResult> {
  const client = requireClient();

  // ---- Group rows by recipe name (case-insensitive), preserving the
  // order recipes first appear in the file. ----
  const recipeGroups = new Map<string, { name: string; category: string | null; portions: string; instructions: string | null; rows: RecipeImportRow[] }>();
  const recipeOrder: string[] = [];
  for (const row of rows) {
    const key = row.recipeName.trim().toLowerCase();
    if (!key) continue;
    if (!recipeGroups.has(key)) {
      recipeGroups.set(key, {
        name: row.recipeName.trim(),
        category: row.category?.trim() || null,
        portions: row.portions || "1",
        instructions: row.instructions?.trim() || null,
        rows: [],
      });
      recipeOrder.push(key);
    }
    const group = recipeGroups.get(key)!;
    // A recipe's category/portions/instructions may legitimately only be
    // filled in on that recipe's first row in the file (common in Excel
    // exports where repeated values are left blank on later rows) — fill
    // them in from any row that has them, not just the first.
    if (!group.category && row.category?.trim()) group.category = row.category.trim();
    if (!group.instructions && row.instructions?.trim()) group.instructions = row.instructions.trim();
    if (row.ingredientName?.trim()) group.rows.push(row);
  }

  // ---- Step 1: fetch existing ingredients once, build a name->row map. ----
  const { data: existingIngredients, error: fetchError } = await client
    .from("ingredients")
    .select("id, name, name_en, unit, base_price, wastage_factor");
  if (fetchError) throw fetchError;
  const ingredientByName = new Map((existingIngredients ?? []).map((i) => [i.name.trim().toLowerCase(), i]));

  // ---- Step 2: find every ingredient name used anywhere in the file
  // that ISN'T already in the register, and bulk-create them all in one
  // insert. New ingredients get a generated SKU and the unit taken from
  // wherever that ingredient name first appears in the file. ----
  const newIngredientNames = new Map<string, string>(); // lowercased key -> original-cased name
  const newIngredientUnits = new Map<string, string>();
  for (const row of rows) {
    const name = row.ingredientName?.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (ingredientByName.has(key) || newIngredientNames.has(key)) continue;
    newIngredientNames.set(key, name);
    newIngredientUnits.set(key, row.unit?.trim() || "kg");
  }

  let skuCounter = (existingIngredients?.length ?? 0) + 1;
  const newIngredientKeys = Array.from(newIngredientNames.keys());
  if (newIngredientKeys.length > 0) {
    const insertPayload = newIngredientKeys.map((key) => ({
      sku: `ING-${String(skuCounter++).padStart(4, "0")}`,
      name: newIngredientNames.get(key) as string,
      name_en: null,
      current_stock: 0,
      unit: newIngredientUnits.get(key) as string,
      base_price: 0,
      conversion_factor: 1,
      wastage_factor: 0,
      calories: 0,
      is_active: true,
    }));
    const { data: createdIngredients, error: createIngError } = await client
      .from("ingredients")
      .insert(insertPayload)
      .select("id, name, name_en, unit, base_price, wastage_factor");
    if (createIngError) throw createIngError;
    for (const ing of createdIngredients ?? []) {
      ingredientByName.set(ing.name.trim().toLowerCase(), ing);
    }
  }

  // ---- Step 3: bulk-create all recipes in one insert. Recipes with zero
  // ingredient rows are skipped entirely (reported back, not silently
  // dropped) — a recipe header with no ingredient lines isn't useful data. ----
  const recipesToCreate = recipeOrder
    .map((key) => recipeGroups.get(key)!)
    .filter((g) => g.rows.length > 0);
  const recipesSkipped = recipeOrder
    .map((key) => recipeGroups.get(key)!)
    .filter((g) => g.rows.length === 0)
    .map((g) => g.name);

  if (recipesToCreate.length === 0) {
    return { recipesCreated: 0, ingredientsCreated: newIngredientKeys.length, ingredientLinesInserted: 0, recipesSkipped };
  }

  const recipeInsertPayload = recipesToCreate.map((g) => ({
    name: g.name,
    name_en: null,
    portion_yield: strToNum(g.portions) || 1,
    portion_unit: "pcs",
    allergens: [],
    technical_guide: g.instructions,
    total_raw_material_cost: 0, // computed below, then patched — see step 4
    labor_cost: 0,
    overhead_cost: 0,
    total_cost: 0,
    profit_margin_percent: 60,
    selling_price: 0,
    menu_price_vat: 0,
    menu_price_final: 0,
    is_active: true,
  }));
  const { data: createdRecipes, error: createRecError } = await client
    .from("recipes")
    .insert(recipeInsertPayload)
    .select("id, name");
  if (createRecError) throw createRecError;

  // Supabase returns created rows in insertion order for a single insert
  // call, so pairing by index with recipesToCreate is safe here.
  const recipeIdByKey = new Map<string, number>();
  (createdRecipes ?? []).forEach((r, idx) => {
    const originalKey = recipesToCreate[idx].name.trim().toLowerCase();
    recipeIdByKey.set(originalKey, r.id as number);
  });

  // ---- Step 4: build every recipe_ingredients row across every recipe,
  // then bulk-insert them ALL in one call. Also accumulate each recipe's
  // total raw-material cost as we go, for a single batched cost update. ----
  const ingredientLinkPayload: {
    recipe_id: number;
    ingredient_id: number | null;
    ingredient_name: string;
    quantity: number;
    unit: string;
    unit_cost: number;
    total_cost: number;
    wastage_factor: number;
    requires_prep: boolean;
    prep_notes: string;
  }[] = [];
  const recipeCostTotals = new Map<string, number>();

  for (const group of recipesToCreate) {
    const key = group.name.trim().toLowerCase();
    const recipeId = recipeIdByKey.get(key);
    if (recipeId == null) continue;
    let recipeCost = 0;
    for (const row of group.rows) {
      const ingKey = row.ingredientName.trim().toLowerCase();
      const matched = ingredientByName.get(ingKey);
      const quantity = strToNum(row.quantity);
      const unitCost = Number(matched?.base_price ?? 0);
      const totalCost = quantity * unitCost;
      recipeCost += totalCost;
      ingredientLinkPayload.push({
        recipe_id: recipeId,
        ingredient_id: matched?.id ?? null,
        ingredient_name: row.ingredientName.trim(),
        quantity,
        unit: row.unit?.trim() || matched?.unit || "kg",
        unit_cost: unitCost,
        total_cost: totalCost,
        wastage_factor: Number(matched?.wastage_factor ?? 0),
        requires_prep: false,
        prep_notes: "",
      });
    }
    recipeCostTotals.set(key, recipeCost);
  }

  if (ingredientLinkPayload.length > 0) {
    const { error: linkError } = await client.from("recipe_ingredients").insert(ingredientLinkPayload);
    if (linkError) throw linkError;
  }

  // ---- Step 5: patch each recipe's computed cost fields. This is one
  // update per recipe rather than a single batched call, since Postgres
  // doesn't support a single UPDATE with per-row differing values without
  // more complex SQL — for typical recipe-catalog sizes this remains fast,
  // and unlike the ingredient-link inserts these are independent writes
  // that can safely run in parallel rather than sequentially. ----
  await Promise.all(
    recipesToCreate.map((group) => {
      const key = group.name.trim().toLowerCase();
      const recipeId = recipeIdByKey.get(key);
      const cost = recipeCostTotals.get(key) ?? 0;
      if (recipeId == null) return Promise.resolve();
      const sellingPrice = cost > 0 ? cost / 0.4 : 0;
      return client
        .from("recipes")
        .update({
          total_raw_material_cost: cost,
          total_cost: cost,
          selling_price: sellingPrice,
          menu_price_vat: sellingPrice * 1.24,
          menu_price_final: sellingPrice,
        })
        .eq("id", recipeId);
    })
  );

  return {
    recipesCreated: recipesToCreate.length,
    ingredientsCreated: newIngredientKeys.length,
    ingredientLinesInserted: ingredientLinkPayload.length,
    recipesSkipped,
  };
}

// ------------------------------------------------------------
// MENUS + MENU RECIPES
// ------------------------------------------------------------
export async function fetchMenus(): Promise<Menu[]> {
  const client = requireClient();
  const { data: menus, error } = await client.from("menus").select("id, title, title_en, status, total_recipes, total_portions, avg_profit_margin, total_food_cost, created_at").order("id", { ascending: false });
  if (error) throw error;
  const result: Menu[] = [];
  for (const m of menus ?? []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: recipes, error: recError } = await (client.from("menu_recipes") as any).select("id, menu_id, recipe_id, recipe_name, portions, portion_type, food_cost, selling_price, profit_margin").eq("menu_id", m.id);
    if (recError) throw recError;
    result.push({
      id: m.id, title: m.title, titleEn: m.title_en, status: m.status, totalRecipes: m.total_recipes,
      totalPortions: m.total_portions, avgProfitMargin: numToStr(m.avg_profit_margin), totalFoodCost: numToStr(m.total_food_cost),
      createdAt: m.created_at,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      recipes: (recipes ?? []).map((r: any): MenuRecipe => ({
        id: r.id, menuId: r.menu_id, recipeId: r.recipe_id ?? 0, recipeName: r.recipe_name, portions: r.portions,
        portionType: (r.portion_type ?? "portion") as "portion" | "kg",
        foodCost: numToStr(r.food_cost), sellingPrice: numToStr(r.selling_price), profitMargin: numToStr(r.profit_margin),
      })),
    });
  }
  return result;
}

export async function upsertMenu(menu: Omit<Menu, "id" | "createdAt"> & { id?: number }): Promise<number> {
  const client = requireClient();
  const status = menu.status as "draft" | "active" | "archived";
  const payload = {
    title: menu.title, title_en: menu.titleEn, status, total_recipes: menu.totalRecipes,
    total_portions: menu.totalPortions, avg_profit_margin: strToNum(menu.avgProfitMargin),
    total_food_cost: strToNum(menu.totalFoodCost),
  };
  let menuId: number;
  if (menu.id) {
    const { error } = await client.from("menus").update(payload).eq("id", menu.id);
    if (error) throw error;
    menuId = menu.id;
    const { error: delError } = await client.from("menu_recipes").delete().eq("menu_id", menuId);
    if (delError) throw delError;
  } else {
    const { data, error } = await client.from("menus").insert(payload).select("id").single();
    if (error) throw error;
    menuId = data.id as number;
  }
  if (menu.recipes.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: recError } = await (client.from("menu_recipes") as any).insert(
      menu.recipes.map((r) => ({
        menu_id: menuId, recipe_id: r.recipeId || null, recipe_name: r.recipeName, portions: r.portions,
        portion_type: r.portionType ?? "portion",
        food_cost: strToNum(r.foodCost), selling_price: strToNum(r.sellingPrice), profit_margin: strToNum(r.profitMargin),
      }))
    );
    if (recError) throw recError;
  }
  return menuId;
}

export async function deleteMenu(id: number): Promise<void> {
  const { error } = await requireClient().from("menus").delete().eq("id", id);
  if (error) throw error;
}

// ------------------------------------------------------------
// PREP LISTS
// ------------------------------------------------------------
export async function fetchPrepLists(): Promise<PrepListItem[]> {
  const { data, error } = await requireClient().from("prep_lists").select("id, menu_id, recipe_name, ingredient_name, quantity_needed, unit, is_prepped, manual_override, portion_calculation, created_at").order("id", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id, menuId: r.menu_id, recipeName: r.recipe_name, ingredientName: r.ingredient_name,
    quantityNeeded: numToStr(r.quantity_needed), unit: r.unit, isPrepped: r.is_prepped,
    manualOverride: r.manual_override == null ? null : numToStr(r.manual_override),
    portionCalculation: r.portion_calculation == null ? null : numToStr(r.portion_calculation), createdAt: r.created_at,
  }));
}

// ------------------------------------------------------------
// UNITS (static reference data — read-only from the app)
// ------------------------------------------------------------
export async function fetchUnits(): Promise<Unit[]> {
  const { data, error } = await requireClient().from("units").select("id, name, name_en, abbreviation, base_unit, conversion_factor, description").order("id", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id, name: r.name, nameEn: r.name_en, abbreviation: r.abbreviation, baseUnit: r.base_unit,
    conversionFactor: numToStr(r.conversion_factor), description: r.description,
  }));
}

// ------------------------------------------------------------
// INGESTION LOGS
// ------------------------------------------------------------
export async function fetchIngestionLogs(): Promise<IngestionLog[]> {
  const { data, error } = await requireClient().from("ingestion_logs").select("id, file_name, file_type, records_parsed, records_inserted, status, errors, created_at").order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id, fileName: r.file_name, fileType: r.file_type, recordsParsed: r.records_parsed,
    recordsInserted: r.records_inserted, status: r.status, errors: r.errors, createdAt: r.created_at,
  }));
}

export async function logIngestion(entry: { fileName: string; fileType: string; recordsParsed: number; recordsInserted: number; status: string; errors?: string | null }): Promise<void> {
  const { error } = await requireClient().from("ingestion_logs").insert({
    file_name: entry.fileName, file_type: entry.fileType, records_parsed: entry.recordsParsed,
    records_inserted: entry.recordsInserted, status: entry.status, errors: entry.errors ?? null,
  });
  if (error) throw error;
}

// ------------------------------------------------------------
// COMPANY SETTINGS
// ------------------------------------------------------------
export interface CompanySettings {
  id: number;
  name: string;
  nameEn?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  taxId?: string | null;
  taxOffice?: string | null;
  logoUrl?: string | null;
}

export async function fetchCompanySettings(): Promise<CompanySettings | null> {
  if (!supabase) return null;
  const { data } = await (supabase as any).from("company_settings").select("*").eq("id", 1).single();
  if (!data) return null;
  return {
    id: data.id,
    name: data.name,
    nameEn: data.name_en,
    address: data.address,
    phone: data.phone,
    email: data.email,
    taxId: data.tax_id,
    taxOffice: data.tax_office,
    logoUrl: data.logo_url,
  };
}

export async function updateCompanySettings(input: Partial<Omit<CompanySettings, "id">>): Promise<void> {
  if (!supabase) throw new Error("Supabase not initialized");
  const { error } = await (supabase as any).from("company_settings").upsert({
    id: 1,
    name: input.name,
    name_en: input.nameEn,
    address: input.address,
    phone: input.phone,
    email: input.email,
    tax_id: input.taxId,
    tax_office: input.taxOffice,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

// ── SKU Mapping ──────────────────────────────────────────────────────────────
export interface ProductSkuMapEntry {
  id: number;
  productName: string;
  sku: string;
  finalGroup: string;
}

export async function fetchProductSkuMap(): Promise<ProductSkuMapEntry[]> {
  if (!supabase) throw new Error("Supabase not initialized");
  const client = supabase;
  // σε σελίδες — οι αντιστοιχίσεις ξεπερνούν το όριο των 1000 γραμμών
  const data = await fetchAllPages<any>((from, to) => (client as any)
    .from("product_sku_map")
    .select("id, product_name, sku, final_group")
    .order("sku")
    .order("id")
    .range(from, to));
  return data.map((r: any) => ({
    id: r.id,
    productName: r.product_name,
    sku: r.sku,
    finalGroup: r.final_group,
  }));
}

export async function createProductSkuMapEntry(input: { productName: string; sku: string; finalGroup: string }): Promise<void> {
  if (!supabase) throw new Error("Supabase not initialized");
  const { error } = await (supabase as any).from("product_sku_map").insert({
    product_name: input.productName,
    sku: input.sku,
    final_group: input.finalGroup,
  });
  if (error) throw error;
}

export async function updateProductSkuMapEntry(id: number, input: { sku?: string; finalGroup?: string }): Promise<void> {
  if (!supabase) throw new Error("Supabase not initialized");
  const update: Record<string, unknown> = {};
  if (input.sku !== undefined) update.sku = input.sku;
  if (input.finalGroup !== undefined) update.final_group = input.finalGroup;
  const { error } = await (supabase as any).from("product_sku_map").update(update).eq("id", id);
  if (error) throw error;
}

export async function bulkCreateProductSkuMapEntries(rows: { productName: string; sku: string; finalGroup: string }[]): Promise<void> {
  if (!supabase) throw new Error("Supabase not initialized");
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await (supabase as any).from("product_sku_map").insert(rows.slice(i, i + 500).map(r => ({
      product_name: r.productName, sku: r.sku, final_group: r.finalGroup,
    })));
    if (error) throw error;
  }
}

/** Αφαιρεί τη σύνδεση ενός ονόματος (π.χ. υλικού συνταγής) από την Ομαδοποίηση SKU της ενεργής επιχείρησης. */
export async function deleteProductSkuMapByName(productName: string): Promise<void> {
  if (!supabase) throw new Error("Supabase not initialized");
  const { error } = await (supabase as any).from("product_sku_map").delete().eq("product_name", productName);
  if (error) throw error;
}

export async function deleteProductSkuMapEntry(id: number): Promise<void> {
  if (!supabase) throw new Error("Supabase not initialized");
  const { error } = await (supabase as any).from("product_sku_map").delete().eq("id", id);
  if (error) throw error;
}

// ── Business Profile ─────────────────────────────────────────────────────────
// Από τη μετάβαση «πολλές επιχειρήσεις» τα στοιχεία βρίσκονται στον πίνακα
// `businesses` (ενεργή επιχείρηση). Αν η μετάβαση δεν έχει τρέξει ακόμα,
// χρησιμοποιείται ο παλιός πίνακας `business_profile` (id=1).
function mapBusinessRow(data: any) {
  return {
    name: data.name ?? "",
    address: data.address ?? "",
    phone: data.phone ?? "",
    email: data.email ?? "",
    taxId: data.tax_id ?? "",
    logoDataUrl: data.logo_data_url ?? null,
  };
}

export async function fetchBusinessProfile(): Promise<{ name: string; address: string; phone: string; email: string; taxId: string; logoDataUrl: string | null } | null> {
  if (!supabase) throw new Error("Supabase not initialized");
  const active = await (supabase as any).from("businesses").select("*").eq("is_active", true).limit(1);
  if (!active.error) return active.data?.[0] ? mapBusinessRow(active.data[0]) : null;
  const { data } = await (supabase as any).from("business_profile").select("*").eq("id", 1).single();
  return data ? mapBusinessRow(data) : null;
}

export async function saveBusinessProfile(input: { name: string; address: string; phone: string; email: string; taxId: string; logoDataUrl?: string | null }): Promise<void> {
  if (!supabase) throw new Error("Supabase not initialized");
  const fields = {
    name: input.name, address: input.address, phone: input.phone, email: input.email,
    tax_id: input.taxId, logo_data_url: input.logoDataUrl ?? null,
  };
  const active = await (supabase as any).from("businesses").select("id").eq("is_active", true).limit(1);
  if (!active.error && active.data?.[0]) {
    const { error } = await (supabase as any).from("businesses").update(fields).eq("id", active.data[0].id);
    if (error) throw error;
    return;
  }
  const { error } = await (supabase as any).from("business_profile").upsert({ id: 1, ...fields, updated_at: new Date().toISOString() });
  if (error) throw error;
}

// ── Επιχειρήσεις (μία ενεργή κάθε φορά) ─────────────────────────────────────
export interface BusinessRow {
  id: number; name: string; isActive: boolean; createdAt: string; deactivatedAt: string | null;
}

/** null = η μετάβαση «πολλές επιχειρήσεις» δεν έχει τρέξει στη βάση. */
export async function fetchBusinesses(): Promise<BusinessRow[] | null> {
  if (!supabase) throw new Error("Supabase not initialized");
  const { data, error } = await (supabase as any).from("businesses")
    .select("id, name, is_active, created_at, deactivated_at").order("id");
  if (error) return null;
  return (data ?? []).map((r: any) => ({
    id: r.id, name: r.name, isActive: r.is_active, createdAt: r.created_at, deactivatedAt: r.deactivated_at,
  }));
}

/** Νέα επιχείρηση (ανενεργή). Επιστρέφει το id της. */
export async function createBusiness(input: { name: string; address?: string; phone?: string; email?: string; taxId?: string }): Promise<number> {
  if (!supabase) throw new Error("Supabase not initialized");
  const { data, error } = await (supabase as any).from("businesses").insert({
    name: input.name, address: input.address ?? "", phone: input.phone ?? "", email: input.email ?? "",
    tax_id: input.taxId ?? "", is_active: false,
  }).select("id").single();
  if (error) throw error;
  return data.id as number;
}

/** Ενεργοποιεί επιχείρηση (η τρέχουσα απενεργοποιείται). Προαιρετικά αντιγράφει ομαδοποίηση SKU. */
export async function activateBusiness(id: number, copySkuFrom?: number | null): Promise<void> {
  if (!supabase) throw new Error("Supabase not initialized");
  const { error } = await (supabase as any).rpc("activate_business", { p_id: id, p_copy_sku_from: copySkuFrom ?? null });
  if (error) throw error;
}

// ── Τιμές συνταγών από αγορές ────────────────────────────────────────────────
export interface SkuConversion { sku: string; unit: string; grams: number }

/** null = δεν έχει τρέξει το migration_recipe_pricing.sql */
export async function fetchSkuConversions(): Promise<SkuConversion[] | null> {
  if (!supabase) throw new Error("Supabase not initialized");
  const client = supabase;
  try {
    const rows = await fetchAllPages<any>((from, to) => (client as any).from("sku_unit_conversions")
      .select("sku, unit, grams").order("id").range(from, to));
    return rows.map((r: any) => ({ sku: r.sku, unit: r.unit, grams: Number(r.grams) }));
  } catch { return null; }
}

export async function upsertSkuConversion(sku: string, unit: string, grams: number): Promise<void> {
  if (!supabase) throw new Error("Supabase not initialized");
  const { error } = await (supabase as any).from("sku_unit_conversions")
    .upsert({ sku, unit, grams, updated_at: new Date().toISOString() }, { onConflict: "business_id,sku,unit" });
  if (error) throw error;
}

export async function upsertSkuConversions(rows: { sku: string; unit: string; grams: number }[]): Promise<void> {
  if (!supabase) throw new Error("Supabase not initialized");
  const now = new Date().toISOString();
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await (supabase as any).from("sku_unit_conversions")
      .upsert(rows.slice(i, i + 500).map(r => ({ ...r, updated_at: now })), { onConflict: "business_id,sku,unit" });
    if (error) throw error;
  }
}

/** Αλλαγή μονάδας σε γραμμές συνταγών (π.χ. ΓΡΑΜΜΑΡΙΑ → ΤΕΜΑΧΙΟ για τεμαχιακά είδη). */
export async function setRecipeIngredientsUnit(ids: number[], unit: string): Promise<void> {
  const client = requireClient();
  for (let i = 0; i < ids.length; i += 300) {
    const { error } = await client.from("recipe_ingredients").update({ unit }).in("id", ids.slice(i, i + 300));
    if (error) throw error;
  }
}

export interface RecipePricePayload {
  ingredients: { id: number; unit_cost: number; total_cost: number }[];
  recipes: { id: number; raw: number; total: number; selling: number; menu_vat: number; menu_final: number }[];
}

/** Μαζική εγγραφή τιμών υλικών + κόστους συνταγών (RPC apply_recipe_prices). */
export async function applyRecipePrices(p: RecipePricePayload): Promise<{ ingredients: number; recipes: number }> {
  if (!supabase) throw new Error("Supabase not initialized");
  let ing = 0, rec = 0;
  const CH = 1500;
  for (let i = 0; i < Math.max(p.ingredients.length, 1); i += CH) {
    const { data, error } = await (supabase as any).rpc("apply_recipe_prices", { p: { ingredients: p.ingredients.slice(i, i + CH), recipes: [] } });
    if (error) throw error;
    ing += Number(data?.ingredients ?? 0);
  }
  for (let i = 0; i < p.recipes.length; i += CH) {
    const { data, error } = await (supabase as any).rpc("apply_recipe_prices", { p: { ingredients: [], recipes: p.recipes.slice(i, i + CH) } });
    if (error) throw error;
    rec += Number(data?.recipes ?? 0);
  }
  return { ingredients: ing, recipes: rec };
}

// ── SKU Group rename ──────────────────────────────────────────────────────────
export async function renameSkuGroup(oldSku: string, newSku: string): Promise<void> {
  if (!supabase) throw new Error("Supabase not initialized");
  const { error } = await (supabase as any)
    .from("product_sku_map")
    .update({ sku: newSku })
    .eq("sku", oldSku);
  if (error) throw error;
}

// ------------------------------------------------------------
// DEPARTMENTS (Τμήματα)
// ------------------------------------------------------------
export async function fetchDepartments(): Promise<Department[]> {
  const client = requireClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (client as any)
    .from("departments")
    .select("id, name, name_en, is_active, created_at")
    .eq("is_active", true)
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row: { id: number; name: string; name_en: string | null; is_active: boolean; created_at: string }) => ({
    id: row.id,
    name: row.name,
    nameEn: row.name_en,
    isActive: row.is_active,
    createdAt: row.created_at,
  }));
}

// ------------------------------------------------------------
// INTERNAL TRANSFERS (Εσωτερική Διακίνηση)
// ------------------------------------------------------------
export async function fetchInternalTransfers(): Promise<InternalTransfer[]> {
  const client = requireClient();
  const { data: transfers, error } = await client
    .from("internal_transfers")
    .select("id, transfer_number, transfer_date, from_department, to_department, delivered_by, received_by, notes, created_at")
    .order("transfer_date", { ascending: false });
  if (error) throw error;

  const { data: items, error: itemsError } = await client
    .from("internal_transfer_items")
    .select("id, transfer_id, ingredient_id, ingredient_name, quantity, unit");
  if (itemsError) throw itemsError;

  return (transfers ?? []).map((t) => ({
    id: t.id,
    transferNumber: t.transfer_number,
    transferDate: t.transfer_date,
    fromDepartment: t.from_department,
    toDepartment: t.to_department,
    deliveredBy: t.delivered_by,
    receivedBy: t.received_by,
    notes: t.notes,
    createdAt: t.created_at,
    items: (items ?? [])
      .filter((i) => i.transfer_id === t.id)
      .map((i) => ({
        id: i.id,
        transferId: i.transfer_id,
        ingredientId: i.ingredient_id,
        ingredientName: i.ingredient_name,
        quantity: i.quantity,
        unit: i.unit,
      })),
  }));
}

export async function createInternalTransfer(
  transfer: Omit<InternalTransfer, "id" | "createdAt">,
): Promise<InternalTransfer> {
  const client = requireClient();
  const { data: row, error } = await client
    .from("internal_transfers")
    .insert({
      transfer_number: transfer.transferNumber,
      transfer_date: transfer.transferDate,
      from_department: transfer.fromDepartment,
      to_department: transfer.toDepartment,
      delivered_by: transfer.deliveredBy,
      received_by: transfer.receivedBy,
      notes: transfer.notes,
    })
    .select("id, transfer_number, transfer_date, from_department, to_department, delivered_by, received_by, notes, created_at")
    .single();
  if (error) throw error;

  const itemRows = transfer.items.map((item) => ({
    transfer_id: row.id,
    ingredient_id: item.ingredientId,
    ingredient_name: item.ingredientName,
    quantity: item.quantity,
    unit: item.unit,
  }));
  const { data: insertedItems, error: itemsError } = await client
    .from("internal_transfer_items")
    .insert(itemRows)
    .select("id, transfer_id, ingredient_id, ingredient_name, quantity, unit");
  if (itemsError) throw itemsError;

  return {
    id: row.id,
    transferNumber: row.transfer_number,
    transferDate: row.transfer_date,
    fromDepartment: row.from_department,
    toDepartment: row.to_department,
    deliveredBy: row.delivered_by,
    receivedBy: row.received_by,
    notes: row.notes,
    createdAt: row.created_at,
    items: (insertedItems ?? []).map((i) => ({
      id: i.id,
      transferId: i.transfer_id,
      ingredientId: i.ingredient_id,
      ingredientName: i.ingredient_name,
      quantity: i.quantity,
      unit: i.unit,
    })),
  };
}

export async function deleteInternalTransfer(id: number): Promise<void> {
  const client = requireClient();
  const { error: itemsError } = await client.from("internal_transfer_items").delete().eq("transfer_id", id);
  if (itemsError) throw itemsError;
  const { error } = await client.from("internal_transfers").delete().eq("id", id);
  if (error) throw error;
}

// ------------------------------------------------------------
// BUFFET MENU CYCLE (Κύκλος Μενού Μπουφέ)
// ------------------------------------------------------------
import type { BuffetCycleEntry, BuffetDish, MealType, DayOfWeek, Reservation, BoardType } from "./types";

export async function fetchBuffetCycleEntries(): Promise<BuffetCycleEntry[]> {
  const client = requireClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: entries, error } = await (client as any)
    .from("buffet_cycle_entries")
    .select("id, week_number, day_of_week, meal_type, notes, created_at")
    .order("week_number", { ascending: true });
  if (error) throw error;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: dishes, error: dishErr } = await (client as any)
    .from("buffet_dishes")
    .select("id, cycle_entry_id, dish_name, dish_category, kg_per_person, unit, recipe_id, sort_order")
    .order("sort_order", { ascending: true });
  if (dishErr) throw dishErr;

  return (entries ?? []).map((e: {
    id: number; week_number: number; day_of_week: number; meal_type: string; notes: string | null; created_at: string;
  }): BuffetCycleEntry => ({
    id: e.id,
    weekNumber: e.week_number as 1 | 2 | 3 | 4,
    dayOfWeek: e.day_of_week as DayOfWeek,
    mealType: e.meal_type as MealType,
    notes: e.notes,
    createdAt: e.created_at,
    dishes: (dishes ?? [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((d: any) => d.cycle_entry_id === e.id)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((d: any): BuffetDish => ({
        id: d.id,
        cycleEntryId: d.cycle_entry_id,
        dishName: d.dish_name,
        dishCategory: d.dish_category,
        kgPerPerson: d.kg_per_person,
        unit: d.unit,
        recipeId: d.recipe_id,
        sortOrder: d.sort_order,
      })),
  }));
}

export async function upsertBuffetCycleEntry(
  entry: Omit<BuffetCycleEntry, "id" | "createdAt" | "dishes"> & { id?: number },
  dishes: Omit<BuffetDish, "id" | "cycleEntryId">[],
): Promise<number> {
  const client = requireClient();
  let entryId: number;

  if (entry.id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (client as any).from("buffet_cycle_entries").update({
      week_number: entry.weekNumber,
      day_of_week: entry.dayOfWeek,
      meal_type: entry.mealType,
      notes: entry.notes ?? null,
    }).eq("id", entry.id);
    if (error) throw error;
    entryId = entry.id;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: delErr } = await (client as any).from("buffet_dishes").delete().eq("cycle_entry_id", entryId);
    if (delErr) throw delErr;
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (client as any).from("buffet_cycle_entries").insert({
      week_number: entry.weekNumber,
      day_of_week: entry.dayOfWeek,
      meal_type: entry.mealType,
      notes: entry.notes ?? null,
    }).select("id").single();
    if (error) throw error;
    entryId = data.id as number;
  }

  if (dishes.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: dishErr } = await (client as any).from("buffet_dishes").insert(
      dishes.map((d, idx) => ({
        cycle_entry_id: entryId,
        dish_name: d.dishName,
        dish_category: d.dishCategory,
        kg_per_person: d.kgPerPerson,
        unit: d.unit,
        recipe_id: d.recipeId ?? null,
        sort_order: d.sortOrder ?? idx,
      }))
    );
    if (dishErr) throw dishErr;
  }
  return entryId;
}

export async function deleteBuffetCycleEntry(id: number): Promise<void> {
  const client = requireClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: dishErr } = await (client as any).from("buffet_dishes").delete().eq("cycle_entry_id", id);
  if (dishErr) throw dishErr;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (client as any).from("buffet_cycle_entries").delete().eq("id", id);
  if (error) throw error;
}

// ------------------------------------------------------------
// RESERVATIONS (Κρατήσεις Μπουφέ)
// ------------------------------------------------------------
export async function fetchReservations(): Promise<Reservation[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (requireClient() as any)
    .from("reservations")
    .select("id, reservation_date, meal_type, board_type, pax, source, week_number, notes, created_at")
    .order("reservation_date", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r: {
    id: number; reservation_date: string; meal_type: string; board_type: string;
    pax: number; source: string; week_number: number | null; notes: string | null; created_at: string;
  }): Reservation => ({
    id: r.id,
    reservationDate: r.reservation_date,
    mealType: r.meal_type as MealType,
    boardType: r.board_type as BoardType,
    pax: r.pax,
    source: r.source as "manual" | "excel_import",
    weekNumber: r.week_number,
    notes: r.notes,
    createdAt: r.created_at,
  }));
}

export async function createReservation(input: Omit<Reservation, "id" | "createdAt">): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (requireClient() as any)
    .from("reservations")
    .insert({
      reservation_date: input.reservationDate,
      meal_type: input.mealType,
      board_type: input.boardType,
      pax: input.pax,
      source: input.source,
      week_number: input.weekNumber ?? null,
      notes: input.notes ?? null,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as number;
}

export async function createReservationsBulk(rows: Omit<Reservation, "id" | "createdAt">[]): Promise<number> {
  if (rows.length === 0) return 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error, count } = await (requireClient() as any)
    .from("reservations")
    .insert(rows.map((r) => ({
      reservation_date: r.reservationDate,
      meal_type: r.mealType,
      board_type: r.boardType,
      pax: r.pax,
      source: r.source,
      week_number: r.weekNumber ?? null,
      notes: r.notes ?? null,
    })), { count: "exact" });
  if (error) throw error;
  return count ?? rows.length;
}

export async function deleteReservation(id: number): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (requireClient() as any).from("reservations").delete().eq("id", id);
  if (error) throw error;
}

export async function deleteReservationsByDate(date: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (requireClient() as any).from("reservations").delete().eq("reservation_date", date);
  if (error) throw error;
}
