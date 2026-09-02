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
} from "./types";

function requireClient() {
  if (!supabase) throw new Error("Supabase δεν έχει ρυθμιστεί — δείτε src/lib/supabaseClient.ts");
  return supabase;
}

const numToStr = (n: number | null | undefined): string => (n == null ? "0" : String(n));
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

export async function deleteSupplier(id: number): Promise<void> {
  const { error } = await requireClient().from("suppliers").delete().eq("id", id);
  if (error) throw error;
}

/** Sets one supplier's own category (Καρτέλα Προμηθευτών). After saving,
 * the caller typically follows up with applySupplierCategoryToUncategorizedProducts
 * so that supplier's still-uncategorized products pick it up too. */
export async function updateSupplierCategory(id: number, category: string): Promise<void> {
  const { error } = await requireClient().from("suppliers").update({ category }).eq("id", id);
  if (error) throw error;
}

/** Bulk-fills `category` on every one of this supplier's products that
 * doesn't have one set yet (empty or null) — never overwrites a category
 * a product already has, so a manual per-product override always sticks.
 * Returns how many product rows were updated. */
export async function applySupplierCategoryToUncategorizedProducts(supplierId: number, category: string): Promise<number> {
  const { error, count } = await requireClient()
    .from("supplier_products")
    .update({ category }, { count: "exact" })
    .eq("supplier_id", supplierId)
    .or("category.is.null,category.eq.");
  if (error) throw error;
  return count ?? 0;
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
  category: string; unit: string; base_price: number; quality_grade: string | null;
  region_of_origin: string | null; is_contract_price: boolean | null; is_active: boolean | null;
  created_at: string; suppliers: { name: string; name_en: string | null } | null;
}

function mapSupplierProduct(row: SupplierProductRow): SupplierProduct {
  return {
    id: row.id, supplierId: row.supplier_id, productName: row.product_name, productNameEn: row.product_name_en,
    category: row.category, unit: row.unit, basePrice: numToStr(row.base_price), qualityGrade: row.quality_grade,
    regionOfOrigin: row.region_of_origin, isContractPrice: row.is_contract_price, isActive: row.is_active,
    createdAt: row.created_at, supplierName: row.suppliers?.name, supplierNameEn: row.suppliers?.name_en ?? null,
  };
}

export async function fetchSupplierProducts(): Promise<SupplierProduct[]> {
  const { data, error } = await requireClient()
    .from("supplier_products")
    .select("id, supplier_id, product_name, product_name_en, category, unit, base_price, quality_grade, region_of_origin, is_contract_price, is_active, created_at, suppliers(name, name_en)")
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
    .select("id, supplier_id, product_name, product_name_en, category, unit, base_price, quality_grade, region_of_origin, is_contract_price, is_active, created_at, suppliers(name, name_en)")
    .eq("is_active", true)
    .or(`product_name.ilike.%${q}%,product_name_en.ilike.%${q}%`)
    .order("base_price", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => mapSupplierProduct(r as unknown as SupplierProductRow));
}

export async function createSupplierProduct(input: {
  supplierId: number; productName: string; productNameEn?: string | null; category: string; unit: string;
  basePrice: string; qualityGrade?: string | null; regionOfOrigin?: string | null; isContractPrice?: boolean;
}): Promise<void> {
  const { error } = await requireClient().from("supplier_products").insert({
    supplier_id: input.supplierId, product_name: input.productName, product_name_en: input.productNameEn ?? null,
    category: input.category, unit: input.unit, base_price: strToNum(input.basePrice),
    quality_grade: input.qualityGrade ?? null, region_of_origin: input.regionOfOrigin ?? null,
    is_contract_price: input.isContractPrice ?? false, is_active: true,
  });
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

/** Updates a single supplier product's category — used by the inline
 * dropdown in the Supplier Quotes ("Πίνακας Προσφορών") table so the
 * owner can categorize items manually after import. */
export async function updateSupplierProductCategory(id: number, category: string): Promise<void> {
  const { error } = await requireClient().from("supplier_products").update({ category }).eq("id", id);
  if (error) throw error;
}

// ------------------------------------------------------------
// PRODUCT SKU MAP (raw product name -> canonical SKU + group name).
// Lets the owner manage which raw product names, as they appear in
// order/quote history, belong under the same SKU — self-contained
// data access for the new "Ομαδοποίηση Ειδών (SKU)" page.
// ------------------------------------------------------------
export interface ProductSkuMapEntry {
  id: number;
  productName: string;
  sku: string;
  finalGroup: string;
  createdAt?: string;
}

interface ProductSkuMapRow {
  id: number; product_name: string; sku: string; final_group: string; created_at: string;
}

function mapProductSkuMapEntry(row: ProductSkuMapRow): ProductSkuMapEntry {
  return { id: row.id, productName: row.product_name, sku: row.sku, finalGroup: row.final_group, createdAt: row.created_at };
}

export async function fetchProductSkuMap(): Promise<ProductSkuMapEntry[]> {
  const { data, error } = await requireClient()
    .from("product_sku_map")
    .select("id, product_name, sku, final_group, created_at")
    .order("sku", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => mapProductSkuMapEntry(r as unknown as ProductSkuMapRow));
}

/** Adds one raw product name under a SKU (existing or brand new). */
export async function createProductSkuMapEntry(input: { productName: string; sku: string; finalGroup: string }): Promise<void> {
  const { error } = await requireClient().from("product_sku_map").insert({
    product_name: input.productName, sku: input.sku, final_group: input.finalGroup,
  });
  if (error) throw error;
}

/** Moves one existing mapping to a different SKU/group (a single
 * product-name row, not the whole group). */
export async function updateProductSkuMapEntry(id: number, patch: { sku?: string; finalGroup?: string }): Promise<void> {
  const dbPatch: Record<string, string> = {};
  if (patch.sku !== undefined) dbPatch.sku = patch.sku;
  if (patch.finalGroup !== undefined) dbPatch.final_group = patch.finalGroup;
  if (Object.keys(dbPatch).length === 0) return;
  const { error } = await requireClient().from("product_sku_map").update(dbPatch).eq("id", id);
  if (error) throw error;
}

/** Renames a SKU's group label across every product mapped to it
 * (final_group is meant to stay one consistent name per SKU). */
export async function renameSkuGroup(sku: string, finalGroup: string): Promise<void> {
  const { error } = await requireClient().from("product_sku_map").update({ final_group: finalGroup }).eq("sku", sku);
  if (error) throw error;
}

/** Removes one product-name mapping (the product becomes "unmapped" again). */
export async function deleteProductSkuMapEntry(id: number): Promise<void> {
  const { error } = await requireClient().from("product_sku_map").delete().eq("id", id);
  if (error) throw error;
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
  const { data, error } = await requireClient()
    .from("orders")
    .select("id, order_number, supplier_id, order_date, invoice_number, delivery_note_number, notes, status, total_net, total_vat, total_gross, created_at, suppliers(name, name_en)")
    .order("order_date", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => mapOrder(r as unknown as OrderRow));
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
  const { data, error } = await requireClient()
    .from("order_items")
    .select("id, order_id, supplier_product_id, product_name, ordered_quantity, delivered_quantity, unit, base_price, vat_percent, discount_percent, net_amount, vat_amount, gross_amount, created_at, orders(order_number, order_date, invoice_number, suppliers(name, name_en))")
    .order("id", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => mapOrderItem(r as unknown as OrderItemRow));
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

// Adds a brand-new line item to an EXISTING order (used by the
// "Restore & Correction" flow in Orders Archive, so a product missed
// off the original order can be added when correcting it).
export async function addOrderItem(orderId: number, item: {
  productName: string; orderedQuantity: number; deliveredQuantity?: number; unit: string;
  basePrice: number; vatPercent: number; discountPercent: number;
  netAmount: number; vatAmount: number; grossAmount: number; supplierProductId?: number | null;
}): Promise<number> {
  const { data, error } = await requireClient()
    .from("order_items")
    .insert({
      order_id: orderId, supplier_product_id: item.supplierProductId ?? null, product_name: item.productName,
      ordered_quantity: item.orderedQuantity, delivered_quantity: item.deliveredQuantity ?? item.orderedQuantity,
      unit: item.unit, base_price: item.basePrice, vat_percent: item.vatPercent, discount_percent: item.discountPercent,
      net_amount: item.netAmount, vat_amount: item.vatAmount, gross_amount: item.grossAmount,
    })
    .select("id")
    .single();
  if (error) throw error;
  return (data as { id: number }).id;
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
  const { data, error } = await requireClient()
    .from("supplier_payments")
    .select("id, supplier_id, transaction_date, amount, type, reference, notes, created_at, suppliers(name, name_en)")
    .order("transaction_date", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => mapPayment(r as unknown as PaymentRow));
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
  const { data, error } = await requireClient().from("ingredients").select("id, sku, name, name_en, current_stock, unit, base_price, conversion_factor, conversion_per_unit, mapped_supplier_product_id, wastage_factor, calories, is_active, created_at").order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapIngredient);
}

export interface IngredientCurrentPrice {
  unitCost: number;
  unit: string;
  priceSource: "order_history" | "supplier_offer" | "none";
  sourceDetail: string | null;
}

/** Δυναμική τιμή υλικού με αλυσίδα fallback (μέση τιμή ιστορικού
 * παραγγελιών -> φθηνότερη ενεργή προσφορά προμηθευτή -> 0),
 * υπολογισμένη απευθείας στη βάση από τη συνάρτηση
 * get_ingredient_current_price (βλέπε schema_dynamic_pricing.sql).
 * Επιστρέφει null μόνο αν το ίδιο το αίτημα αποτύχει (π.χ. δίκτυο) --
 * αν το υλικό απλά δεν έχει καμία τιμή ακόμα, επιστρέφει ρητά
 * { unitCost: 0, priceSource: "none", ... }, όχι null. */
export async function getIngredientCurrentPrice(ingredientId: number): Promise<IngredientCurrentPrice | null> {
  const { data, error } = await requireClient().rpc("get_ingredient_current_price", { p_ingredient_id: ingredientId });
  if (error) throw error;
  const row = (data ?? [])[0];
  if (!row) return null;
  return {
    unitCost: Number(row.unit_cost ?? 0),
    unit: row.unit ?? "kg",
    priceSource: (row.price_source ?? "none") as IngredientCurrentPrice["priceSource"],
    sourceDetail: row.source_detail ?? null,
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

export async function fetchRecipes(): Promise<Recipe[]> {
  const client = requireClient();

  // 1 αίτημα: όλες οι συνταγές (χωρίς τα υλικά τους ακόμα)
  const { data: recipes, error } = await client
    .from("recipes")
    .select("id, name, name_en, portion_yield, portion_unit, allergens, plating_images, technical_guide, total_raw_material_cost, labor_cost, overhead_cost, total_cost, profit_margin_percent, selling_price, menu_price_vat, menu_price_final, calories_per_portion, grams_per_portion, is_active, created_at")
    .order("name", { ascending: true });
  if (error) throw error;

  // Όλες οι γραμμές recipe_ingredients, για όλες τις συνταγές μαζί —
  // αντί για ένα ξεχωριστό αίτημα ανά συνταγή (το οποίο, με χιλιάδες
  // συνταγές, καθυστερούσε τόσο πολύ ώστε η αρχική φόρτωση δεδομένων
  // της εφαρμογής δεν πρόλαβαινε ποτέ να ολοκληρωθεί εγκαίρως).
  // Η Supabase γυρνάει ΤΟ ΠΟΛΥ 1000 γραμμές ανά αίτημα (default),
  // οπότε με περισσότερες από 1000 recipe_ingredients (π.χ. 14000+)
  // χρειάζεται σελιδοποίηση με .range() — αλλιώς λείπουν υλικά από
  // πολλές συνταγές.
  const PAGE_SIZE = 1000;
  const allIngredients: {
    id: number; recipe_id: number; ingredient_id: number | null; ingredient_name: string; quantity: number;
    unit: string; unit_cost: number; total_cost: number; wastage_factor: number; requires_prep: boolean; prep_notes: string | null;
  }[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data: page, error: ingError } = await client
      .from("recipe_ingredients")
      .select("id, recipe_id, ingredient_id, ingredient_name, quantity, unit, unit_cost, total_cost, wastage_factor, requires_prep, prep_notes")
      .range(from, from + PAGE_SIZE - 1);
    if (ingError) throw ingError;
    if (!page || page.length === 0) break;
    allIngredients.push(...page);
    if (page.length < PAGE_SIZE) break;
  }

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
      allergens: JSON.stringify(r.allergens ?? []), platingImages: JSON.stringify(r.plating_images ?? []), technicalGuide: r.technical_guide,
      totalRawMaterialCost: numToStr(r.total_raw_material_cost), laborCost: numToStr(r.labor_cost),
      overheadCost: numToStr(r.overhead_cost), totalCost: numToStr(r.total_cost),
      profitMarginPercent: numToStr(r.profit_margin_percent), sellingPrice: numToStr(r.selling_price),
      menuPriceVat: numToStr(r.menu_price_vat), menuPriceFinal: numToStr(r.menu_price_final),
      caloriesPerPortion: numToStr(r.calories_per_portion), gramsPerPortion: numToStr(r.grams_per_portion), isActive: r.is_active,
      createdAt: r.created_at, ingredients: ingredients.map(mapRecipeIngredient),
    });
  }
  return result;
}

// Ανεβάζει μία φωτογραφία παρουσίασης (πιάτου) μιας συνταγής στο
// Supabase Storage bucket "recipe-images" και επιστρέφει το δημόσιο
// URL της. Ο καλών είναι υπεύθυνος να αποθηκεύσει το URL στο πεδίο
// plating_images της συνταγής (μέσω updateRecipeDetails).
export async function uploadRecipeImage(recipeId: number, file: File): Promise<string> {
  const client = requireClient();
  const ext = file.name.split(".").pop() || "jpg";
  const path = `recipe-${recipeId}/${Date.now()}.${ext}`;
  const { error } = await client.storage.from("recipe-images").upload(path, file, { upsert: true });
  if (error) throw error;
  const { data } = client.storage.from("recipe-images").getPublicUrl(path);
  return data.publicUrl;
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
    plating_images: typeof recipe.platingImages === "string" ? JSON.parse(recipe.platingImages || "[]") : recipe.platingImages ?? [],
    technical_guide: recipe.technicalGuide, total_raw_material_cost: strToNum(recipe.totalRawMaterialCost),
    labor_cost: strToNum(recipe.laborCost), overhead_cost: strToNum(recipe.overheadCost), total_cost: strToNum(recipe.totalCost),
    profit_margin_percent: strToNum(recipe.profitMarginPercent), selling_price: strToNum(recipe.sellingPrice),
    menu_price_vat: strToNum(recipe.menuPriceVat), menu_price_final: strToNum(recipe.menuPriceFinal),
    calories_per_portion: strToNum(recipe.caloriesPerPortion), grams_per_portion: strToNum(recipe.gramsPerPortion), is_active: recipe.isActive ?? true,
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
    plating_images: typeof recipe.platingImages === "string" ? JSON.parse(recipe.platingImages || "[]") : recipe.platingImages ?? [],
    technical_guide: recipe.technicalGuide, total_raw_material_cost: strToNum(recipe.totalRawMaterialCost),
    labor_cost: strToNum(recipe.laborCost), overhead_cost: strToNum(recipe.overheadCost), total_cost: strToNum(recipe.totalCost),
    profit_margin_percent: strToNum(recipe.profitMarginPercent), selling_price: strToNum(recipe.sellingPrice),
    menu_price_vat: strToNum(recipe.menuPriceVat), menu_price_final: strToNum(recipe.menuPriceFinal),
    calories_per_portion: strToNum(recipe.caloriesPerPortion), grams_per_portion: strToNum(recipe.gramsPerPortion), is_active: recipe.isActive ?? true,
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
    plating_images: typeof recipe.platingImages === "string" ? JSON.parse(recipe.platingImages || "[]") : recipe.platingImages ?? [],
    technical_guide: recipe.technicalGuide, total_raw_material_cost: strToNum(recipe.totalRawMaterialCost),
    labor_cost: strToNum(recipe.laborCost), overhead_cost: strToNum(recipe.overheadCost), total_cost: strToNum(recipe.totalCost),
    profit_margin_percent: strToNum(recipe.profitMarginPercent), selling_price: strToNum(recipe.sellingPrice),
    menu_price_vat: strToNum(recipe.menuPriceVat), menu_price_final: strToNum(recipe.menuPriceFinal),
    calories_per_portion: strToNum(recipe.caloriesPerPortion), grams_per_portion: strToNum(recipe.gramsPerPortion), is_active: recipe.isActive ?? true,
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
    const { data: recipes, error: recError } = await client.from("menu_recipes").select("id, menu_id, recipe_id, recipe_name, portions, food_cost, selling_price, profit_margin").eq("menu_id", m.id);
    if (recError) throw recError;
    result.push({
      id: m.id, title: m.title, titleEn: m.title_en, status: m.status, totalRecipes: m.total_recipes,
      totalPortions: m.total_portions, avgProfitMargin: numToStr(m.avg_profit_margin), totalFoodCost: numToStr(m.total_food_cost),
      createdAt: m.created_at,
      recipes: (recipes ?? []).map((r): MenuRecipe => ({
        id: r.id, menuId: r.menu_id, recipeId: r.recipe_id ?? 0, recipeName: r.recipe_name, portions: r.portions,
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
    const { error: recError } = await client.from("menu_recipes").insert(
      menu.recipes.map((r) => ({
        menu_id: menuId, recipe_id: r.recipeId || null, recipe_name: r.recipeName, portions: r.portions,
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
