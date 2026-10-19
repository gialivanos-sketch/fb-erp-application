// ============================================================
// ΑΝΤΙΓΡΑΦΟ ΑΣΦΑΛΕΙΑΣ: όλοι οι πίνακες σε ένα αρχείο Excel
// ============================================================
// Ένα φύλλο ανά πίνακα. Με το migration_security.sql (συνάρτηση
// backup_rows) παίρνει ΟΛΑ τα δεδομένα, και των ανενεργών επιχειρήσεων.
// Χωρίς αυτό, παίρνει ό,τι βλέπει ο χρήστης (ενεργή επιχείρηση).
import * as XLSX from "xlsx";
import { supabase } from "./supabaseClient";

export const BACKUP_TABLES = [
  "businesses", "business_profile", "company_settings", "users", "departments", "units",
  "suppliers", "supplier_products", "ingredient_supplier_map", "product_sku_map", "sku_unit_conversions",
  "orders", "order_items", "supplier_payments", "purchase_invoices",
  "ingredients", "recipes", "recipe_ingredients", "menus", "menu_recipes", "prep_lists",
  "stock_takings", "stock_taking_items", "inventory_snapshots", "internal_transfers", "internal_transfer_items",
  "buffet_dishes", "buffet_cycle_entries", "reservations",
  "revenue_entries", "payroll_entries", "ingestion_logs",
];

const PAGE = 1000;
// μεγάλα πεδία (λογότυπα, φωτογραφίες) δεν χωράνε σε κελί Excel (όριο 32.767 χαρακτήρες)
const MAX_CELL = 32000;

type Row = Record<string, unknown>;

async function readTable(table: string): Promise<{ rows: Row[]; full: boolean } | null> {
  if (!supabase) throw new Error("Supabase not configured");
  // 1) πλήρες αντίγραφο μέσω backup_rows (μόνο διαχειριστής)
  const rows: Row[] = [];
  let rpcOk = true;
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await supabase.rpc("backup_rows" as never, { p_table: table, p_offset: off, p_limit: PAGE } as never);
    if (error) { rpcOk = false; break; }
    const page = (data ?? []) as unknown as Row[];
    rows.push(...page.map(r => ((r as { row?: Row }).row ?? r)));
    if (page.length < PAGE) break;
  }
  if (rpcOk) return { rows, full: true };
  // 2) ό,τι επιτρέπει το RLS
  const out: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from(table as never).select("*").range(from, from + PAGE - 1);
    if (error) return out.length ? { rows: out, full: false } : null;
    const page = (data ?? []) as Row[];
    out.push(...page);
    if (page.length < PAGE) break;
  }
  return { rows: out, full: false };
}

function cell(v: unknown): unknown {
  if (v == null) return "";
  if (typeof v === "object") v = JSON.stringify(v);
  if (typeof v === "string" && v.length > MAX_CELL) return v.slice(0, MAX_CELL) + "…[κομμένο]";
  return v;
}

export interface BackupResult { fileName: string; tables: { table: string; rows: number }[]; missing: string[]; full: boolean }

export async function downloadFullBackup(onProgress?: (msg: string) => void): Promise<BackupResult> {
  const wb = XLSX.utils.book_new();
  const summary: (string | number)[][] = [["Πίνακας", "Γραμμές"]];
  const tables: { table: string; rows: number }[] = [];
  const missing: string[] = [];
  let full = true;
  for (const [i, table] of BACKUP_TABLES.entries()) {
    onProgress?.(`${i + 1}/${BACKUP_TABLES.length}: ${table}`);
    const res = await readTable(table);
    if (!res) { missing.push(table); continue; }
    if (!res.full) full = false;
    const rows = res.rows.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, cell(v)])));
    const ws = rows.length ? XLSX.utils.json_to_sheet(rows) : XLSX.utils.aoa_to_sheet([["(κενός)"]]);
    XLSX.utils.book_append_sheet(wb, ws, table.slice(0, 31));
    tables.push({ table, rows: rows.length });
    summary.push([table, rows.length]);
  }
  const stamp = new Date();
  summary.unshift([`Αντίγραφο ασφαλείας ${stamp.toLocaleString("el-GR")}`, ""], [full ? "Πλήρες (όλες οι επιχειρήσεις)" : "Μόνο ενεργή επιχείρηση", ""], ["", ""]);
  const info = XLSX.utils.aoa_to_sheet(summary);
  XLSX.utils.book_append_sheet(wb, info, "_ΣΥΝΟΨΗ");
  // η σύνοψη πρώτη
  wb.SheetNames = ["_ΣΥΝΟΨΗ", ...wb.SheetNames.filter(n => n !== "_ΣΥΝΟΨΗ")];
  const fileName = `ERP_backup_${stamp.toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(wb, fileName);
  return { fileName, tables, missing, full };
}
