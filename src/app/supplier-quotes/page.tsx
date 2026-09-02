"use client";
import { useState, useMemo, useRef } from "react";
import { useApp } from "@/lib/context";
import { PageHeader, FilterBar, Badge, KpiCard, Modal } from "@/components/shared";
import { parseSpreadsheetFile, rowsToObjects, pick, parsePrice } from "@/lib/csv";
import * as db from "@/lib/supabaseData";
import type { SupplierProduct } from "@/lib/types";

interface CartItem extends SupplierProduct { quantity: number; }
const CATEGORY_LABELS: Record<string, { gr: string; en: string }> = {
  Produce: { gr: "Λαχανικά/Φρούτα", en: "Produce" },
  Grocery: { gr: "Παντοπωλείο", en: "Grocery" },
  Seafood: { gr: "Θαλασσινά", en: "Seafood" },
  Cleaning: { gr: "Καθαριότητα", en: "Cleaning" },
  Beverages: { gr: "Ποτά", en: "Beverages" },
  Meat: { gr: "Κρέας", en: "Meat" },
  Dairy: { gr: "Γαλακτοκομικά", en: "Dairy" },
};
const CATEGORY_OPTIONS = Object.keys(CATEGORY_LABELS);

export default function SupplierQuotesPage() {
  const { t, locale, data, refreshAll } = useApp();
  const products = data.supplierProducts;
  const suppliers = data.suppliers;
  const [cart, setCart] = useState<CartItem[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [grade, setGrade] = useState("");
  const [region, setRegion] = useState("");
  const [showBasket, setShowBasket] = useState(false);
  // Import Modal
  const [showImport, setShowImport] = useState(false);
  const [importSupplier, setImportSupplier] = useState(0);
  const [importCategory, setImportCategory] = useState("Produce");
  const [importMsg, setImportMsg] = useState("");
  const [importMode, setImportMode] = useState<"file" | "paste">("file");
  const [importText, setImportText] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Delete Old Quotes Modal
  const [showDeleteQuotes, setShowDeleteQuotes] = useState(false);
  const [delSupplier, setDelSupplier] = useState(0);
  const [delDateFrom, setDelDateFrom] = useState("");
  const [delDateTo, setDelDateTo] = useState("");
  const [deleteMsg, setDeleteMsg] = useState("");
  const [deleting, setDeleting] = useState(false);

  const filtered = useMemo(() => {
    let result = [...products];
    if (search) {
      const s = search.toLowerCase();
      result = result.filter((p) => p.productName.toLowerCase().includes(s) || (p.productNameEn && p.productNameEn.toLowerCase().includes(s)));
    }
    if (category) result = result.filter((p) => p.category === category);
    if (grade) result = result.filter((p) => p.qualityGrade === grade);
    if (region) result = result.filter((p) => p.regionOfOrigin === region);
    return result;
  }, [products, search, category, grade, region]);

  const categories = [...new Set(products.map((p) => p.category))].sort();
  const grades = [...new Set(products.map((p) => p.qualityGrade).filter(Boolean))].sort();
  const regions = [...new Set(products.map((p) => p.regionOfOrigin).filter(Boolean))].sort();
  const totalCartValue = cart.reduce((s, i) => s + Number(i.basePrice) * i.quantity, 0);
  const fmt = (n: number) => "€" + n.toFixed(2);

  function addToCart(product: SupplierProduct) {
    setCart((prev) => {
      const existing = prev.find((c) => c.id === product.id);
      if (existing) return prev.map((c) => (c.id === product.id ? { ...c, quantity: c.quantity + 1 } : c));
      return [...prev, { ...product, quantity: 1 }];
    });
  }

  function removeFromCart(id: number) { setCart((prev) => prev.filter((c) => c.id !== id)); }
  function updateQty(id: number, qty: number) {
    setCart((prev) => prev.map((c) => (c.id === id ? { ...c, quantity: Math.max(0, qty) } : c)).filter((c) => c.quantity > 0));
  }

  function clearFilters() { setSearch(""); setCategory(""); setGrade(""); setRegion(""); }
  async function handleCategoryChange(id: number, newCategory: string) {
  try {
    await db.updateSupplierProductCategory(id, newCategory);
    await refreshAll();
  } catch (err) {
    alert(locale === "gr" ? "⚠️ Αποτυχία ενημέρωσης κατηγορίας: " + String(err) : "⚠️ Failed to update category: " + String(err));
  }
}

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) setPendingFile(file);
  }

  // Import Quote via file: parses a genuine .xlsx/.xls/.csv file (via
  // SheetJS for real Excel binaries, or the built-in delimited-text
  // parser for .csv), mapping columns by header name — Greek or English —
  // and writes the resulting products directly into Supabase.
  async function handleImportFromFile() {
    if (!pendingFile || !importSupplier) return;
    setImporting(true);
    try {
      const table = await parseSpreadsheetFile(pendingFile);
      const objs = rowsToObjects(table);
      if (objs.length === 0) {
        setImportMsg(locale === "gr" ? "⚠️ Το αρχείο είναι κενό ή δεν αναγνωρίστηκε." : "⚠️ File is empty or unrecognized.");
        return;
      }
      const rows: { supplierId: number; productName: string; productNameEn: string | null; category: string; unit: string; basePrice: string; qualityGrade: string | null; regionOfOrigin: string | null }[] = [];
      for (const row of objs) {
        const productName = pick(row, ["name", "product", "productname", "onoma", "όνομα", "είδος", "προϊόν", "προϊον"]);
        if (!productName) continue;
        const productNameEn = pick(row, ["nameen", "englishname", "product_name_en"]);
        const unit = pick(row, ["unit", "monada", "unitofmeasure", "uom", "measure", "measurementunit", "μονάδα", "μονάδαμέτρησης", "μεμ"]) || "kg";
        const basePrice = parsePrice(pick(row, ["price", "baseprice", "timi", "τιμή"]));
        const qualityGrade = pick(row, ["grade", "qualitygrade", "poiotita"]) || null;
        const regionOfOrigin = pick(row, ["region", "regionoforigin", "perioxi"]) || null;
        rows.push({ supplierId: importSupplier, productName, productNameEn: productNameEn || null, category: importCategory, unit, basePrice, qualityGrade, regionOfOrigin });
      }
      if (rows.length === 0) {
        setImportMsg(locale === "gr"
          ? "⚠️ Δεν αναγνωρίστηκε καμία στήλη με το είδος του προϊόντος. Ελέγξτε ότι η επικεφαλίδα λέει π.χ. \"Είδος\", \"Προϊόν\" ή \"Name\"."
          : "⚠️ No product-name column was recognized. Check that the header reads e.g. \"Είδος\", \"Product\", or \"Name\".");
        return;
      }
      const count = await db.createSupplierProductsBulk(rows);
      await refreshAll();
      setImportMsg(locale === "gr" ? `✅ ${count} προϊόντα εισήχθησαν από ${pendingFile.name}!` : `✅ ${count} products imported from ${pendingFile.name}!`);
      setTimeout(() => { setShowImport(false); setImportMsg(""); setPendingFile(null); }, 1800);
    } catch (err) {
      setImportMsg(locale === "gr" ? "⚠️ Αποτυχία εισαγωγής: " + String(err) : "⚠️ Import failed: " + String(err));
    } finally {
      setImporting(false);
    }
  }

  // Import Quote via paste: parse text lines like
  // "Ντομάτα Α Πρέβεζας | Tomato A | kg | 1.85 | Grade A | Preveza"
  async function handleImportFromPaste() {
    if (!importText.trim() || !importSupplier) return;
    setImporting(true);
    try {
      const lines = importText.split("\n").filter((l) => l.trim());
      const rows: { supplierId: number; productName: string; productNameEn: string | null; category: string; unit: string; basePrice: string; qualityGrade: string | null; regionOfOrigin: string | null }[] = [];
      for (const line of lines) {
        const parts = line.split("|").map((p) => p.trim());
        if (parts.length >= 3) {
          rows.push({
            supplierId: importSupplier, productName: parts[0], productNameEn: parts[1] || null,
            category: importCategory, unit: parts[2] || "kg", basePrice: parsePrice(parts[3] || "0"),
            qualityGrade: parts[4] || null, regionOfOrigin: parts[5] || null,
          });
        }
      }
      const count = rows.length > 0 ? await db.createSupplierProductsBulk(rows) : 0;
      await refreshAll();
      setImportMsg(locale === "gr" ? "✅ " + count + " προϊόντα εισήχθησαν!" : "✅ " + count + " products imported!");
      setTimeout(() => { setShowImport(false); setImportMsg(""); setImportText(""); }, 1500);
    } catch (err) {
      setImportMsg(locale === "gr" ? "⚠️ Αποτυχία εισαγωγής: " + String(err) : "⚠️ Import failed: " + String(err));
    } finally {
      setImporting(false);
    }
  }

  async function handleDeleteOldQuotes() {
    if (!delDateFrom || !delDateTo) {
      setDeleteMsg(locale === "gr" ? "⚠️ Επιλέξτε εύρος ημερομηνιών" : "⚠️ Select a date range");
      return;
    }
    setDeleting(true);
    try {
      const count = await db.deleteOldQuotes(delSupplier || null);
      await refreshAll();
      setDeleteMsg(locale === "gr" ? `✅ ${count} παλιές προσφορές διαγράφηκαν!` : `✅ ${count} old quotes deleted!`);
      setTimeout(() => { setShowDeleteQuotes(false); setDeleteMsg(""); }, 1500);
    } catch (err) {
      setDeleteMsg(locale === "gr" ? "⚠️ Αποτυχία διαγραφής: " + String(err) : "⚠️ Failed to delete: " + String(err));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div>
      <PageHeader title={t("headerSupplierQuotes")} subtitle={locale === "gr" ? "Πίνακας Προσφορών & Επιλογή Προϊόντων" : "Supplier Quotes & Product Selection"}>
        <button onClick={() => setShowImport(true)} className="erp-btn-success">📥 {t("importQuote")}</button>
        <button onClick={() => setShowDeleteQuotes(true)} className="erp-btn-danger">🗑️ {t("deleteOldQuotes")}</button>
        <button onClick={() => setShowBasket(!showBasket)} className="erp-btn-primary relative">
          🛒 {locale === "gr" ? "Καλάθι" : "Basket"} ({cart.length})
          {cart.length > 0 && (
            <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center">{cart.reduce((s, c) => s + c.quantity, 0)}</span>
          )}
        </button>
      </PageHeader>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard label={locale === "gr" ? "Σύνολο Ειδών" : "Total Products"} value={filtered.length} color="blue" icon="📦" />
        <KpiCard label={locale === "gr" ? "Κατηγορίες" : "Categories"} value={categories.length} color="green" icon="📂" />
        <KpiCard label={locale === "gr" ? "Προμηθευτές" : "Suppliers"} value={[...new Set(products.map((p) => p.supplierId))].length} color="purple" icon="🏢" />
        <KpiCard label={locale === "gr" ? "Αξία Καλαθιού" : "Basket Total"} value={fmt(totalCartValue)} color="amber" icon="💰" />
      </div>

      <FilterBar onClear={clearFilters} clearLabel={t("btnClearFilters")}>
        <div>
          <label className="erp-label font-semibold text-blue-700">{locale === "gr" ? "Αναζήτηση προϊόντων" : "Product Search"}</label>
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("filterSearch")} className="filter-input border-blue-300" />
        </div>
        <div>
          <label className="erp-label">{t("filterByCategory")}</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="erp-select">
            <option value="">{t("filterAll")}</option>
            {categories.map((c) => (
  <option key={c} value={c}>
    {c ? (locale === "gr" ? (CATEGORY_LABELS[c]?.gr ?? c) : (CATEGORY_LABELS[c]?.en ?? c)) : (locale === "gr" ? "(χωρίς κατηγορία)" : "(no category)")}
  </option>
))}
          </select>
        </div>
        <div>
          <label className="erp-label">{t("filterByGrade")}</label>
          <select value={grade} onChange={(e) => setGrade(e.target.value)} className="erp-select">
            <option value="">{t("filterAll")}</option>
            {grades.map((g) => <option key={g} value={g!}>{g}</option>)}
          </select>
        </div>
        <div>
          <label className="erp-label">{t("filterByRegion")}</label>
          <select value={region} onChange={(e) => setRegion(e.target.value)} className="erp-select">
            <option value="">{t("filterAll")}</option>
            {regions.map((r) => <option key={r} value={r!}>{r}</option>)}
          </select>
        </div>
      </FilterBar>

      <div className="flex gap-6">
        <div className={`flex-1 ${showBasket ? "hidden lg:block lg:w-2/3" : ""}`}>
          <div className="erp-card">
            <div className="erp-card-header flex items-center justify-between">
              <h3 className="font-semibold">{t("supplierProducts")}</h3>
              <Badge color="blue">{filtered.length} {locale === "gr" ? "είδη" : "items"}</Badge>
            </div>
            <div className="overflow-x-auto">
              <table className="erp-table">
                <thead>
                  <tr>
                    <th>{locale === "gr" ? "Κωδ." : "Code"}</th>
                    <th>{t("fieldProduct")}</th>
                    <th>{t("fieldSupplier")}</th>
                    <th>{t("fieldCategory")}</th>
                    <th>{locale === "gr" ? "Τιμή/Μονάδα" : "Price/Unit"}</th>
                    <th>{t("fieldQualityGrade")}</th>
                    <th>{t("fieldRegion")}</th>
                    <th>{locale === "gr" ? "Σύμβαση" : "Contract"}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr><td colSpan={9} className="text-center py-8 text-slate-400">{t("noData")}</td></tr>
                  ) : filtered.map((p) => {
                    const same = filtered.filter((x) => x.productName === p.productName);
                    const minPrice = Math.min(...same.map((x) => Number(x.basePrice)));
                    const isCheapest = same.length > 1 && Number(p.basePrice) === minPrice;
                    return (
                      <tr key={p.id} className={isCheapest ? "bg-emerald-50/50" : ""}>
                        <td className="text-xs text-slate-500">SP-{String(p.id).padStart(4, "0")}</td>
                        <td>
                          <div className="font-medium text-slate-800">{p.productName}</div>
                          {p.productNameEn && <div className="text-xs text-slate-400">{p.productNameEn}</div>}
                        </td>
                        <td className="text-sm">{locale === "gr" ? p.supplierName : (p.supplierNameEn || p.supplierName)}</td>
                       <td>
  <select value={p.category || ""} onChange={(e) => handleCategoryChange(p.id, e.target.value)} className="erp-select text-xs py-1">
    <option value="">— {locale === "gr" ? "Χωρίς κατηγορία" : "No category"} —</option>
    {CATEGORY_OPTIONS.map((c) => (
      <option key={c} value={c}>{locale === "gr" ? CATEGORY_LABELS[c].gr : CATEGORY_LABELS[c].en}</option>
    ))}
  </select>
</td>
                        <td className="font-semibold text-emerald-700">
                          {fmt(Number(p.basePrice))}/{p.unit}
                          {isCheapest && <span className="ml-1 text-xs bg-emerald-100 text-emerald-700 px-1 rounded">{t("lowestPrice")}</span>}
                        </td>
                        <td><Badge color={p.qualityGrade === "Grade A" ? "green" : "amber"}>{p.qualityGrade}</Badge></td>
                        <td className="text-sm">{p.regionOfOrigin}</td>
                        <td>{p.isContractPrice ? <Badge color="blue">🔒</Badge> : <span className="text-slate-300">—</span>}</td>
                        <td>
                          <button onClick={() => addToCart(p)} className="erp-btn-primary text-xs px-3 py-1">+</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {showBasket && (
          <div className="w-full lg:w-1/3">
            <div className="erp-card sticky top-4">
              <div className="erp-card-header flex items-center justify-between">
                <h3 className="font-semibold">🛒 {locale === "gr" ? "Ενεργό Καλάθι" : "Active Basket"}</h3>
                <button onClick={() => setShowBasket(false)} className="lg:hidden erp-btn-ghost text-xs">✕</button>
              </div>
              <div className="p-4 max-h-[500px] overflow-y-auto">
                {cart.length === 0 ? (
                  <p className="text-center text-slate-400 text-sm py-8">{locale === "gr" ? "Το καλάθι είναι άδειο" : "Basket is empty"}</p>
                ) : (
                  <div className="space-y-3">
                    {cart.map((item) => (
                      <div key={item.id} className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                        <div className="flex-1">
                          <div className="text-sm font-medium">{item.productName}</div>
                          <div className="text-xs text-slate-500">{fmt(Number(item.basePrice))}/{item.unit}</div>
                        </div>
                        <div className="flex items-center gap-1">
                          <button onClick={() => updateQty(item.id, item.quantity - 1)} className="w-6 h-6 rounded bg-slate-200 text-xs font-bold">-</button>
                          <input type="number" value={item.quantity} onChange={(e) => updateQty(item.id, Number(e.target.value))} className="w-14 text-center text-sm border rounded py-1" />
                          <button onClick={() => updateQty(item.id, item.quantity + 1)} className="w-6 h-6 rounded bg-slate-200 text-xs font-bold">+</button>
                        </div>
                        <div className="text-sm font-semibold w-16 text-right">{fmt(Number(item.basePrice) * item.quantity)}</div>
                        <button onClick={() => removeFromCart(item.id)} className="text-red-400 hover:text-red-600">✕</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {cart.length > 0 && (
                <div className="p-4 border-t">
                  <div className="flex justify-between font-bold text-lg mb-3">
                    <span>{locale === "gr" ? "Σύνολο" : "Total"}</span>
                    <span className="text-emerald-600">{fmt(totalCartValue)}</span>
                  </div>
                  <a href="/draft-order" className="erp-btn-primary w-full justify-center no-underline">
                    {locale === "gr" ? "Μεταφορά σε Παραγγελία" : "Transfer to Order"}
                  </a>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Import Quote Modal */}
      <Modal isOpen={showImport} onClose={() => { setShowImport(false); setImportMsg(""); setImportText(""); setPendingFile(null); }} title={t("importQuote")} size="lg">
        <div className="space-y-4">
          {importMsg && <div className="p-3 bg-emerald-50 border border-emerald-300 text-emerald-800 rounded-lg text-sm">{importMsg}</div>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="erp-label">{t("fieldSupplier")}</label>
              <select value={importSupplier} onChange={(e) => setImportSupplier(Number(e.target.value))} className="erp-select">
                <option value={0}>— {locale === "gr" ? "Επιλέξτε" : "Select"} —</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{locale === "gr" ? s.name : (s.nameEn || s.name)}</option>)}
              </select>
            </div>
            <div>
              <label className="erp-label">{t("fieldCategory")}</label>
              <select value={importCategory} onChange={(e) => setImportCategory(e.target.value)} className="erp-select">
                {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{locale === "gr" ? CATEGORY_LABELS[c].gr : CATEGORY_LABELS[c].en}</option>)}
              </select>
            </div>
          </div>

          {/* Mode toggle: File picker (primary) vs. paste (fallback) */}
          <div className="flex bg-slate-100 rounded-lg p-1 w-fit">
            <button onClick={() => setImportMode("file")} className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${importMode === "file" ? "bg-white shadow text-blue-700" : "text-slate-500"}`}>
              📁 {locale === "gr" ? "Επιλογή Αρχείου" : "File Picker"}
            </button>
            <button onClick={() => setImportMode("paste")} className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${importMode === "paste" ? "bg-white shadow text-blue-700" : "text-slate-500"}`}>
              📋 {locale === "gr" ? "Επικόλληση Κειμένου" : "Paste Text"}
            </button>
          </div>

          {importMode === "file" ? (
            <div>
              <label className="erp-label">{locale === "gr" ? "Αρχείο Excel/CSV" : "Excel/CSV File"}</label>
              <div
                onClick={openFilePicker}
                className="border-2 border-dashed border-slate-300 rounded-xl p-8 text-center hover:border-blue-400 transition-colors cursor-pointer"
              >
                <div className="text-4xl mb-3">📄</div>
                <div className="font-medium text-slate-700">
                  {pendingFile ? pendingFile.name : (locale === "gr" ? "Κάντε κλικ για επιλογή αρχείου από τον υπολογιστή σας" : "Click to select a file from your computer")}
                </div>
                <div className="text-xs text-slate-400 mt-2">
                  {locale === "gr" ? "Στήλες: Είδος, Όνομα (EN), Μονάδα Μέτρησης, Τιμή, Ποιότητα, Περιοχή" : "Columns: Name, Name (EN), Unit, Price, Grade, Region"}
                </div>
                <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls,.ods,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" onChange={handleFileSelected} className="hidden" />
              </div>
              <p className="text-xs text-slate-400 mt-2">
                {locale === "gr"
                  ? "Υποστηρίζονται απευθείας αρχεία .xlsx, .xls και .csv — δεν χρειάζεται μετατροπή."
                  : "Supports .xlsx, .xls, and .csv files directly — no conversion needed."}
              </p>
              <div className="flex gap-2 mt-3">
                <button onClick={handleImportFromFile} className="erp-btn-success" disabled={!importSupplier || !pendingFile || importing}>
                  {importing ? "…" : "📥"} {t("importQuote")}
                </button>
                <button onClick={() => setShowImport(false)} disabled={importing} className="erp-btn-ghost">{t("btnCancel")}</button>
              </div>
            </div>
          ) : (
            <div>
              <label className="erp-label">{locale === "gr" ? "Επικόλληση δεδομένων (Όνομα | EN | Μονάδα | Τιμή | Ποιότητα | Περιοχή)" : "Paste data (Name | EN | Unit | Price | Grade | Region)"}</label>
              <textarea value={importText} onChange={(e) => setImportText(e.target.value)} className="erp-input min-h-[150px] font-mono text-xs" placeholder={"Ντομάτα Α Πρέβεζας | Tomato A | kg | 1.85 | Grade A | Preveza\nΑγγούρι Εισαγωγής | Cucumber | kg | 1.50 | Grade A | Crete"} />
              <div className="flex gap-2 mt-3">
                <button onClick={handleImportFromPaste} className="erp-btn-success" disabled={!importSupplier || !importText.trim() || importing}>
                  {importing ? "…" : "📥"} {t("importQuote")}
                </button>
                <button onClick={() => setShowImport(false)} disabled={importing} className="erp-btn-ghost">{t("btnCancel")}</button>
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* Delete Old Quotes Modal */}
      <Modal isOpen={showDeleteQuotes} onClose={() => { setShowDeleteQuotes(false); setDeleteMsg(""); }} title={t("deleteOldQuotes")} size="md">
        <div className="space-y-4">
          {deleteMsg && <div className="p-3 bg-amber-50 border border-amber-300 text-amber-800 rounded-lg text-sm">{deleteMsg}</div>}
          <div>
            <label className="erp-label">{t("selectSupplierDateRange")}</label>
            <select value={delSupplier} onChange={(e) => setDelSupplier(Number(e.target.value))} className="erp-select mb-3">
              <option value={0}>— {locale === "gr" ? "Όλοι οι Προμηθευτές" : "All Suppliers"} —</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{locale === "gr" ? s.name : (s.nameEn || s.name)}</option>)}
            </select>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="erp-label">{t("fieldDateFrom")}</label>
                <input type="date" value={delDateFrom} onChange={(e) => setDelDateFrom(e.target.value)} className="erp-input" />
              </div>
              <div>
                <label className="erp-label">{t("fieldDateTo")}</label>
                <input type="date" value={delDateTo} onChange={(e) => setDelDateTo(e.target.value)} className="erp-input" />
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleDeleteOldQuotes} className="erp-btn-danger" disabled={!delDateFrom || !delDateTo || deleting}>
              {deleting ? "…" : "🗑️"} {t("deleteOldQuotes")}
            </button>
            <button onClick={() => setShowDeleteQuotes(false)} disabled={deleting} className="erp-btn-ghost">{t("btnCancel")}</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
