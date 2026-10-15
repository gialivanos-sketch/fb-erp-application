"use client";
import { useState, useEffect, useMemo, useCallback } from "react";
import { useLanguage } from "@/lib/context";
import { PageHeader, KpiCard, Badge } from "@/components/shared";
import * as db from "@/lib/supabaseData";
import type { Menu, Recipe, Supplier } from "@/lib/types";

interface ConsumptionLine {
  name: string;
  totalQty: number;
  unit: string;
  unitCost: number;
  totalCost: number;
  supplierName: string;
  hasPrice: boolean;
  supplierProductId?: number;
}

type SupplierPriceMap = Record<string, {
  supplierProductId: number;
  productName: string;
  basePrice: string;
  supplierId: number;
  supplierName: string;
  unit: string;
} | null>;

type SupplierOptionsMap = Record<string, {
  supplierProductId: number;
  productName: string;
  basePrice: string;
  supplierId: number;
  supplierName: string;
  unit: string;
}[]>;

export default function ConsumptionPage() {
  const { t, locale } = useLanguage();

  const [menus, setMenus] = useState<Menu[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [selectedMenuId, setSelectedMenuId] = useState<number>(0);

  // ingredients per recipeId
  const [recipeIngredients, setRecipeIngredients] = useState<Record<number, { name: string; qty: number; unit: string }[]>>({});
  const [loadingIngredients, setLoadingIngredients] = useState(false);

  // supplier prices
  const [supplierPrices, setSupplierPrices] = useState<SupplierPriceMap>({});
  const [supplierOptions, setSupplierOptions] = useState<SupplierOptionsMap>({});
  const [loadingOptions, setLoadingOptions] = useState<string | null>(null);

  // load menus + recipes + suppliers once
  useEffect(() => {
    db.fetchMenus().then(setMenus).catch(console.error);
    db.fetchRecipes().then(setRecipes).catch(console.error);
    db.fetchSuppliers().then(setSuppliers).catch(console.error);
  }, []);

  // load ingredients whenever selected menu changes
  useEffect(() => {
    const menu = menus.find(m => m.id === selectedMenuId);
    if (!menu) { setRecipeIngredients({}); setSupplierPrices({}); return; }

    setLoadingIngredients(true);
    setRecipeIngredients({});
    setSupplierPrices({});

    (async () => {
      try {
        const fetched: Record<number, { name: string; qty: number; unit: string }[]> = {};
        const recipeIds = [...new Set((menu.recipes || []).map(mr => mr.recipeId))];
        for (const rid of recipeIds) {
          const ings = await db.fetchRecipeIngredients(rid);
          fetched[rid] = ings.map(i => ({ name: i.ingredientName, qty: Number(i.quantity), unit: i.unit }));
        }
        setRecipeIngredients(fetched);

        const allNames = [...new Set(Object.values(fetched).flat().map(i => i.name))];
        if (allNames.length > 0) {
          const prices = await db.fetchIngredientSupplierMap(allNames);
          setSupplierPrices(prices);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoadingIngredients(false);
      }
    })();
  }, [selectedMenuId, menus]);

  const menu = menus.find(m => m.id === selectedMenuId);

  const consumptionLines = useMemo((): ConsumptionLine[] => {
    if (!menu) return [];
    const map = new Map<string, ConsumptionLine>();
    for (const mr of menu.recipes || []) {
      const recipe = recipes.find(r => r.id === mr.recipeId);
      const ings = recipeIngredients[mr.recipeId] || [];
      if (ings.length === 0) continue;
      const portionYield = Number(recipe?.portionYield) || 1;
      const multiplier = mr.portionType === "portion" ? mr.portions / portionYield : mr.portions;
      for (const ing of ings) {
        const key = `${ing.name}__${ing.unit}`;
        const sp = supplierPrices[ing.name];
        const unitCost = sp ? Number(sp.basePrice) : 0;
        const qty = ing.qty * multiplier;
        const existing = map.get(key);
        if (existing) {
          existing.totalQty += qty;
          existing.totalCost += unitCost * qty;
        } else {
          map.set(key, {
            name: ing.name,
            totalQty: qty,
            unit: ing.unit,
            unitCost,
            totalCost: unitCost * qty,
            supplierName: sp?.supplierName ?? "—",
            hasPrice: !!sp,
            supplierProductId: sp?.supplierProductId,
          });
        }
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, "el"));
  }, [menu, recipes, recipeIngredients, supplierPrices]);

  const totalCost = consumptionLines.reduce((s, c) => s + c.totalCost, 0);

  const loadSupplierOptions = useCallback(async (ingName: string) => {
    if (supplierOptions[ingName]) return; // already loaded
    setLoadingOptions(ingName);
    try {
      const opts = await db.fetchIngredientSupplierOptions(ingName);
      setSupplierOptions(prev => ({ ...prev, [ingName]: opts }));
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingOptions(null);
    }
  }, [supplierOptions]);

  const changeSupplier = useCallback(async (
    ingName: string, supplierProductId: number, basePrice: string,
    supplierName: string, productName: string, unit: string, supplierId: number
  ) => {
    try {
      await db.setIngredientSupplierOverride(ingName, supplierProductId);
      setSupplierPrices(prev => ({
        ...prev,
        [ingName]: { supplierProductId, productName, basePrice, supplierId, supplierName, unit },
      }));
    } catch (e) {
      console.error(e);
    }
  }, []);

  const fmt = (n: number) => `€${n.toFixed(2)}`;

  const sendOrderEmail = useCallback((supplierName: string, items: ConsumptionLine[]) => {
    const supplier = suppliers.find(s => s.name === supplierName || s.nameEn === supplierName);
    const toEmail = supplier?.contactEmail ?? "";
    const today = new Date().toLocaleDateString("el-GR", { day: "2-digit", month: "2-digit", year: "numeric" });
    const menuTitle = menu?.title ?? "";

    const subject = `Παραγγελία Υλικών – NOE BEACH CLUB – ${today}`;

    const rows = items.map((item, i) =>
      `${i + 1}. ${item.name}  |  Ποσ.: ${item.totalQty % 1 === 0 ? item.totalQty.toFixed(0) : item.totalQty.toFixed(3)} ${item.unit}  |  Τιμή/μον.: €${item.unitCost.toFixed(2)}  |  Σύνολο: €${item.totalCost.toFixed(2)}`
    ).join("\n");

    const total = items.reduce((s, i) => s + i.totalCost, 0);

    const body = [
      `Αγαπητοί,`,
      ``,
      `Σας αποστέλλουμε την παραγγελία υλικών για το μενού "${menuTitle}" ημερομηνίας ${today}.`,
      ``,
      `─────────────────────────────────────`,
      `ΠΑΡΑΓΓΕΛΙΑ ΥΛΙΚΩΝ`,
      `Ημερομηνία: ${today}`,
      `Μενού: ${menuTitle}`,
      `Προμηθευτής: ${supplierName}`,
      `─────────────────────────────────────`,
      ``,
      rows,
      ``,
      `─────────────────────────────────────`,
      `ΣΥΝΟΛΟ ΠΑΡΑΓΓΕΛΙΑΣ: €${total.toFixed(2)}`,
      `─────────────────────────────────────`,
      ``,
      `Παρακαλούμε επιβεβαιώστε τη λήψη και τη διαθεσιμότητα των ειδών.`,
      ``,
      `Με εκτίμηση,`,
      `NOE BEACH CLUB`,
    ].join("\n");

    const mailto = `mailto:${toEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    // Use <a> click trick for better mobile compatibility
    const a = document.createElement("a");
    a.href = mailto;
    a.target = "_blank";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [suppliers, menu]);

  // Group by supplier for purchase order summary
  const bySupplier = useMemo(() => {
    const map = new Map<string, ConsumptionLine[]>();
    for (const c of consumptionLines) {
      if (!c.hasPrice) continue;
      const key = c.supplierName;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    }
    return map;
  }, [consumptionLines]);

  return (
    <div>
      <PageHeader
        title={t("headerConsumption")}
        subtitle="Warehouse Consumption Forecaster / Αναφορά Ανάλωσης"
      >
        <button onClick={() => window.print()} className="erp-btn-secondary">🖨️ {t("btnPrint")}</button>
        <button className="erp-btn-secondary">📄 {t("btnExportPDF")}</button>
      </PageHeader>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <KpiCard
          label={locale === "gr" ? "Σύνολο Αναλώσεων" : "Total Consumption"}
          value={fmt(totalCost)} color="blue" icon="📈"
        />
        <KpiCard
          label={locale === "gr" ? "Μοναδικά Υλικά" : "Unique Ingredients"}
          value={consumptionLines.length} color="green" icon="🥘"
        />
        <KpiCard
          label={locale === "gr" ? "Μενού" : "Menu"}
          value={menu ? menu.title : "—"} color="purple" icon="🍽️"
        />
      </div>

      {/* Menu selector */}
      <div className="erp-card mb-6">
        <div className="p-4">
          <label className="erp-label">{locale === "gr" ? "Επιλογή Μενού" : "Select Menu"}</label>
          <select
            value={selectedMenuId}
            onChange={e => setSelectedMenuId(Number(e.target.value))}
            className="erp-select max-w-md"
          >
            <option value={0}>— {locale === "gr" ? "Επιλέξτε μενού" : "Select a menu"} —</option>
            {menus.map((m, idx) => (
              <option key={m?.id ?? `menu-${idx}`} value={m?.id}>
                {m?.title}{m?.titleEn ? ` (${m.titleEn})` : ""}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Consumption table */}
      {selectedMenuId > 0 && (
        <div className="erp-card mb-6">
          <div className="erp-card-header">
            <h3 className="font-semibold">
              📊 {locale === "gr" ? `Ανάλωση: ${menu?.title ?? ""}` : `Consumption: ${menu?.titleEn || menu?.title || ""}`}
            </h3>
          </div>

          {loadingIngredients ? (
            <div className="text-center py-10 text-slate-400">
              <div className="text-3xl mb-2">⏳</div>
              <div>{locale === "gr" ? "Φόρτωση υλικών…" : "Loading ingredients…"}</div>
            </div>
          ) : consumptionLines.length === 0 ? (
            <div className="text-center py-10 text-slate-400">
              <div className="text-3xl mb-2">📭</div>
              <p>{locale === "gr" ? "Δεν βρέθηκαν υλικά. Βεβαιωθείτε ότι οι συνταγές έχουν υλικά." : "No ingredients found."}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="erp-table text-sm">
                <thead>
                  <tr>
                    <th>A/A</th>
                    <th>{locale === "gr" ? "Προϊόν" : "Product"}</th>
                    <th>{locale === "gr" ? "Ποσότητα" : "Quantity"}</th>
                    <th>{locale === "gr" ? "Μονάδα" : "Unit"}</th>
                    <th>{locale === "gr" ? "Τιμή Μονάδας" : "Unit Price"}</th>
                    <th>{locale === "gr" ? "Προμηθευτής" : "Supplier"}</th>
                    <th>{locale === "gr" ? "Σύνολο Κόστους" : "Total Cost"}</th>
                  </tr>
                </thead>
                <tbody>
                  {consumptionLines.map((c, i) => {
                    const opts = supplierOptions[c.name] || [];
                    const isLoadingOpts = loadingOptions === c.name;
                    return (
                      <tr key={i} className={!c.hasPrice ? "bg-amber-50" : ""}>
                        <td className="text-xs text-slate-400">{i + 1}</td>
                        <td className="font-medium">{c.name}</td>
                        <td>{c.totalQty % 1 === 0 ? c.totalQty.toFixed(0) : c.totalQty.toFixed(3)}</td>
                        <td><Badge color="grey">{c.unit}</Badge></td>
                        <td className="text-slate-600">
                          {c.hasPrice ? `€${c.unitCost.toFixed(2)}` : <span className="text-amber-500 text-xs">—</span>}
                        </td>
                        <td>
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-slate-500 truncate max-w-[90px]">{c.supplierName}</span>
                            <button
                              className="text-xs text-blue-500 hover:text-blue-700 underline whitespace-nowrap"
                              onClick={() => loadSupplierOptions(c.name)}
                              title={locale === "gr" ? "Αλλαγή προμηθευτή" : "Change supplier"}
                            >
                              {isLoadingOpts ? "⏳" : "✎"}
                            </button>
                          </div>
                          {opts.length > 0 && (
                            <select
                              className="erp-select text-xs mt-1 w-full"
                              value={supplierPrices[c.name]?.supplierProductId ?? ""}
                              onChange={e => {
                                const sel = opts.find(o => o.supplierProductId === Number(e.target.value));
                                if (sel) changeSupplier(c.name, sel.supplierProductId, sel.basePrice, sel.supplierName, sel.productName, sel.unit, sel.supplierId);
                              }}
                            >
                              {opts.map(o => (
                                <option key={o.supplierProductId} value={o.supplierProductId}>
                                  {o.supplierName} — {o.productName} €{Number(o.basePrice).toFixed(2)}/{o.unit}
                                </option>
                              ))}
                            </select>
                          )}
                        </td>
                        <td className={c.hasPrice ? "font-semibold text-emerald-700" : "text-slate-300"}>
                          {c.hasPrice ? fmt(c.totalCost) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 font-bold">
                    <td colSpan={6} className="text-right">{t("total")}:</td>
                    <td className="text-lg text-emerald-700">{fmt(totalCost)}</td>
                  </tr>
                </tfoot>
              </table>
              {consumptionLines.some(c => !c.hasPrice) && (
                <p className="text-xs text-amber-600 mt-2 px-4 pb-3">
                  ⚠️ {locale === "gr"
                    ? "Τα κίτρινα υλικά δεν βρέθηκαν στις προσφορές — κόστος 0."
                    : "Highlighted items have no supplier quote — cost shown as 0."}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Purchase order summary by supplier */}
      {bySupplier.size > 0 && (
        <div className="erp-card">
          <div className="erp-card-header">
            <h3 className="font-semibold">🛒 {locale === "gr" ? "Λίστα Αγορών ανά Προμηθευτή" : "Purchase Order by Supplier"}</h3>
          </div>
          <div className="p-4 space-y-4">
            {Array.from(bySupplier.entries()).map(([supplier, items]) => (
              <div key={supplier} className="border border-slate-200 rounded-lg overflow-hidden">
                <div className="bg-slate-100 px-4 py-2 font-semibold text-slate-700 flex justify-between items-center">
                  <span>🏪 {supplier}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-emerald-700">{fmt(items.reduce((s, i) => s + i.totalCost, 0))}</span>
                    <button
                      onClick={() => sendOrderEmail(supplier, items)}
                      className="erp-btn-primary text-xs py-1 px-3"
                      title={locale === "gr" ? "Αποστολή παραγγελίας στον προμηθευτή" : "Send order to supplier"}
                    >
                      📧 {locale === "gr" ? "Αποστολή Παραγγελίας" : "Send Order"}
                    </button>
                  </div>
                </div>
                <table className="erp-table text-sm">
                  <thead>
                    <tr>
                      <th>{locale === "gr" ? "Προϊόν" : "Product"}</th>
                      <th>{locale === "gr" ? "Ποσ." : "Qty"}</th>
                      <th>{locale === "gr" ? "Μον." : "Unit"}</th>
                      <th>{locale === "gr" ? "Τιμή" : "Price"}</th>
                      <th>{locale === "gr" ? "Σύνολο" : "Total"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, j) => (
                      <tr key={j}>
                        <td className="font-medium">{item.name}</td>
                        <td>{item.totalQty % 1 === 0 ? item.totalQty.toFixed(0) : item.totalQty.toFixed(3)}</td>
                        <td className="text-slate-500">{item.unit}</td>
                        <td>€{item.unitCost.toFixed(2)}</td>
                        <td className="text-emerald-700 font-medium">{fmt(item.totalCost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </div>
      )}

      {selectedMenuId === 0 && (
        <div className="erp-card p-12 text-center text-slate-400">
          <div className="text-4xl mb-3">📈</div>
          <p>{locale === "gr" ? "Επιλέξτε ένα μενού για υπολογισμό ανάλωσης" : "Select a menu to calculate consumption forecast"}</p>
        </div>
      )}
    </div>
  );
}
