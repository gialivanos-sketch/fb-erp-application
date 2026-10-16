"use client";
import { useState, useMemo, useCallback } from "react";
import { useLanguage } from "@/lib/context";
import { PageHeader, KpiCard, Badge, Modal } from "@/components/shared";
import type { Recipe, Menu, MenuRecipe, Supplier } from "@/lib/types";
import * as db from "@/lib/supabaseData";

export default function MenuPlannerPage() {
  const { t, locale, data, refreshAll } = useLanguage();
  const menus = data.menus;
  const allRecipes = data.recipes;

  const [selectedMenu, setSelectedMenu] = useState<Menu | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [menuTitle, setMenuTitle] = useState("");
  const [menuTitleEn, setMenuTitleEn] = useState("");
  const [menuRecipes, setMenuRecipes] = useState<MenuRecipe[]>([]);
  const [showAddRecipe, setShowAddRecipe] = useState(false);
  const [recipeSearch, setRecipeSearch] = useState("");
  const [showConsumption, setShowConsumption] = useState(false);
  const [coverCount, setCoverCount] = useState(1); // αριθμός ατόμων για αναφορά
  const [loadingIngredients, setLoadingIngredients] = useState(false);
  // recipeIngredients: recipeId -> ingredients φορτωμένα από DB
  const [recipeIngredients, setRecipeIngredients] = useState<Record<number, { name: string; unit: string; qty: number; unitCost: number }[]>>({});
  // supplierPrices: ingredientName -> τρέχουσα τιμή από ingredient_supplier_map
  const [supplierPrices, setSupplierPrices] = useState<Record<string, { supplierProductId: number; productName: string; basePrice: string; supplierId: number; supplierName: string; unit: string } | null>>({});
  // supplierOptions: ingredientName -> διαθέσιμοι προμηθευτές (για dropdown)
  const [supplierOptions, setSupplierOptions] = useState<Record<string, { supplierProductId: number; productName: string; basePrice: string; supplierId: number; supplierName: string; unit: string }[]>>({});
  const [loadingOptions, setLoadingOptions] = useState<string | null>(null); // ingredient name που φορτώνει options
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [excludedItems, setExcludedItems] = useState<Set<string>>(new Set()); // υλικά που εξαιρούνται από παραγγελία

  // Φιλτράρισμα συνταγών βάσει αναζήτησης
  const filteredRecipes = useMemo(() => {
    const q = recipeSearch.trim().toLowerCase();
    if (!q) return allRecipes;
    return allRecipes.filter(r =>
      r.name.toLowerCase().includes(q) ||
      (r.nameEn && r.nameEn.toLowerCase().includes(q))
    );
  }, [allRecipes, recipeSearch]);

  // Άνοιγμα αναφοράς: φόρτωση υλικών + τιμών προμηθευτών από DB
  async function openConsumption() {
    setLoadingIngredients(true);
    setShowConsumption(true);
    setSupplierPrices({});
    setSupplierOptions({});
    setExcludedItems(new Set());
    try {
      // 1. Φόρτωσε υλικά για κάθε συνταγή
      const fetched: Record<number, { name: string; unit: string; qty: number; unitCost: number }[]> = {};
      for (const mr of menuRecipes) {
        if (!fetched[mr.recipeId]) {
          const ings = await db.fetchRecipeIngredients(mr.recipeId);
          fetched[mr.recipeId] = ings.map(i => ({
            name: i.ingredientName,
            unit: i.unit,
            qty: Number(i.quantity),
            unitCost: Number(i.unitCost),
          }));
        }
      }
      setRecipeIngredients(fetched);

      // 2. Συλλογή μοναδικών ονομάτων υλικών
      const allIngNames = [...new Set(Object.values(fetched).flat().map(i => i.name))];

      // 3. Φόρτωσε τιμές από ingredient_supplier_map + suppliers
      const [prices, sups] = await Promise.all([
        allIngNames.length > 0 ? db.fetchIngredientSupplierMap(allIngNames) : Promise.resolve({}),
        db.fetchSuppliers(),
      ]);
      setSupplierPrices(prices);
      setSuppliers(sups);
    } catch {
      // αν αποτύχει, τα υλικά μένουν χωρίς τιμές
    } finally {
      setLoadingIngredients(false);
    }
  }

  // Φόρτωσε τις επιλογές προμηθευτών για ένα υλικό (για dropdown)
  async function loadSupplierOptions(ingredientName: string) {
    if (supplierOptions[ingredientName]) return; // ήδη φορτωμένα
    setLoadingOptions(ingredientName);
    try {
      const opts = await db.fetchIngredientSupplierOptions(ingredientName);
      setSupplierOptions(prev => ({ ...prev, [ingredientName]: opts }));
    } catch {
      setSupplierOptions(prev => ({ ...prev, [ingredientName]: [] }));
    } finally {
      setLoadingOptions(null);
    }
  }

  // Αλλαγή προμηθευτή για υλικό (manual override)
  async function changeIngredientSupplier(ingredientName: string, supplierProductId: number, newPrice: string, newSupplierName: string, newProductName: string, newUnit: string, supplierId: number) {
    try {
      await db.setIngredientSupplierOverride(ingredientName, supplierProductId);
      setSupplierPrices(prev => ({
        ...prev,
        [ingredientName]: { supplierProductId, productName: newProductName, basePrice: newPrice, supplierId, supplierName: newSupplierName, unit: newUnit },
      }));
    } catch {
      // silent fail
    }
  }

  // Υπολογισμός ανάλωσης υλικών για δεδομένο αριθμό ατόμων
  const consumptionItems = useMemo(() => {
    if (!showConsumption) return [];
    const map = new Map<string, { name: string; unit: string; qty: number; cost: number; unitCost: number; supplierName: string; hasPrice: boolean }>();
    for (const mr of menuRecipes) {
      const recipe = allRecipes.find(r => r.id === mr.recipeId);
      const ings = recipeIngredients[mr.recipeId] || [];
      if (ings.length === 0) continue;
      const portionYield = Number(recipe?.portionYield) || 1;
      const multiplier = mr.portionType === "portion"
        ? coverCount / portionYield
        : 1;
      for (const ing of ings) {
        const key = `${ing.name}__${ing.unit}`;
        const existing = map.get(key);
        // Τιμή από supplier map (αν υπάρχει), αλλιώς 0
        const spPrice = supplierPrices[ing.name];
        const unitCost = spPrice ? Number(spPrice.basePrice) : 0;
        const supplierName = spPrice ? spPrice.supplierName : "";
        const qty = ing.qty * multiplier;
        const cost = unitCost * qty;
        if (existing) {
          existing.qty += qty;
          existing.cost += cost;
        } else {
          map.set(key, { name: ing.name, unit: ing.unit, qty, cost, unitCost, supplierName, hasPrice: !!spPrice });
        }
      }
    }
    return Array.from(map.values())
      .filter(item => !excludedItems.has(item.name))
      .sort((a, b) => a.name.localeCompare(b.name, "el"));
  }, [showConsumption, menuRecipes, allRecipes, recipeIngredients, coverCount, supplierPrices, excludedItems]);

  const toggleExclude = useCallback((name: string) => {
    setExcludedItems(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }, []);

  // Excluded items (για εμφάνιση στο κάτω μέρος)
  const excludedList = useMemo(() => {
    if (!showConsumption) return [];
    const map = new Map<string, { name: string; unit: string; qty: number }>();
    for (const mr of menuRecipes) {
      const recipe = allRecipes.find(r => r.id === mr.recipeId);
      const ings = recipeIngredients[mr.recipeId] || [];
      const portionYield = Number(recipe?.portionYield) || 1;
      const multiplier = mr.portionType === "portion" ? coverCount / portionYield : 1;
      for (const ing of ings) {
        if (!excludedItems.has(ing.name)) continue;
        const key = `${ing.name}__${ing.unit}`;
        const existing = map.get(key);
        const qty = ing.qty * multiplier;
        if (existing) existing.qty += qty;
        else map.set(key, { name: ing.name, unit: ing.unit, qty });
      }
    }
    return Array.from(map.values());
  }, [showConsumption, menuRecipes, allRecipes, recipeIngredients, coverCount, excludedItems]);

  // Group by supplier for email / purchase order
  const bySupplier = useMemo(() => {
    const map = new Map<string, typeof consumptionItems>();
    for (const c of consumptionItems) {
      if (!c.supplierName) continue;
      if (!map.has(c.supplierName)) map.set(c.supplierName, []);
      map.get(c.supplierName)!.push(c);
    }
    return map;
  }, [consumptionItems]);

  const sendOrderEmail = useCallback((supplierName: string, items: typeof consumptionItems) => {
    const sup = suppliers.find(s => s.name === supplierName || s.nameEn === supplierName);
    const toEmail = sup?.contactEmail ?? "";
    const today = new Date().toLocaleDateString("el-GR", { day: "2-digit", month: "2-digit", year: "numeric" });
    const menuName = selectedMenu?.title ?? menuTitle;
    const net = items.reduce((s, i) => s + (i.unitCost > 0 ? i.cost / 1.24 : 0), 0);
    const gross = items.reduce((s, i) => s + i.cost, 0);
    const vat = gross - net;

    const SEP = "================================================";
    const tableRows = items.map((item, idx) => {
      const qtyStr = item.qty % 1 === 0 ? item.qty.toFixed(0) : item.qty.toFixed(3);
      const name = item.name.length > 32 ? item.name.substring(0, 31) + "..." : item.name;
      if (item.unitCost > 0) {
        return `${String(idx + 1).padStart(2)}. ${name.padEnd(33)} | ${(qtyStr + " " + item.unit).padEnd(9)} | ${(item.unitCost.toFixed(2) + " EUR").padStart(10)} | ${(item.cost.toFixed(2) + " EUR").padStart(10)}`;
      } else {
        return `${String(idx + 1).padStart(2)}. ${name.padEnd(33)} | ${(qtyStr + " " + item.unit).padEnd(9)} |          - |          -`;
      }
    }).join("\n");

    const subject = `Παραγγελία ${today} – NOE BEACH CLUB – ${supplierName}`;
    const body = [
      `NOE BEACH CLUB — ΠΑΡΑΓΓΕΛΙΑ`,
      SEP,
      `Προμηθευτής   : ${supplierName}`,
      `Email         : ${toEmail}`,
      `Ημερομηνία    : ${today}`,
      `Μενού         : ${menuName}`,
      SEP,
      ``,
      `Αγαπητοί,`,
      `Σας αποστέλλουμε την παραγγελία υλικών μας.`,
      `Παρακαλούμε επιβεβαιώστε διαθεσιμότητα και ημερομηνία παράδοσης.`,
      ``,
      `  #  ${"ΠΡΟΪΟΝ".padEnd(33)} | ${"ΠΟΣΟΤΗΤΑ".padEnd(9)} |   ΤΙΜΗ/ΜΟΝ |     ΣΥΝΟΛΟ`,
      `     ${"-".repeat(33)}-+-${"-".repeat(9)}-+${"-".repeat(11)}-+${"-".repeat(11)}`,
      tableRows,
      `     ${"-".repeat(33)}-+-${"-".repeat(9)}-+${"-".repeat(11)}-+${"-".repeat(11)}`,
      gross > 0 ? `${"".padEnd(48)}  Καθαρή Αξία : ${net.toFixed(2)} EUR` : "",
      gross > 0 ? `${"".padEnd(48)}  ΦΠΑ         : ${vat.toFixed(2)} EUR` : "",
      gross > 0 ? `${"".padEnd(48)}  ΣΥΝΟΛΟ      : ${gross.toFixed(2)} EUR` : "",
      SEP,
      ``,
      `Με εκτίμηση,`,
      `NOE BEACH CLUB`,
    ].filter(l => l !== undefined).join("\n");

    const subject_enc = encodeURIComponent(subject);
    const body_enc = encodeURIComponent(body);
    const fullUrl = `mailto:${toEmail}?subject=${subject_enc}&body=${body_enc}`;
    const shortUrl = `mailto:${toEmail}?subject=${subject_enc}&body=${encodeURIComponent(tableRows)}`;
    const url = fullUrl.length < 2000 ? fullUrl : shortUrl;
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [suppliers, selectedMenu, menuTitle]);

  async function handleExportPDF(supplierName: string, items: typeof consumptionItems) {
    const { jsPDF } = await import("jspdf");
    const sup = suppliers.find(s => s.name === supplierName || s.nameEn === supplierName);
    const toEmail = sup?.contactEmail ?? "—";
    const today = new Date().toLocaleDateString("el-GR", { day: "2-digit", month: "2-digit", year: "numeric" });
    const menuName = selectedMenu?.title ?? menuTitle;
    const net = items.reduce((s, i) => s + (i.unitCost > 0 ? i.cost / 1.24 : 0), 0);
    const gross = items.reduce((s, i) => s + i.cost, 0);
    const vat = gross - net;

    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const W = 210;
    const MAR = 14;
    const COL = W - MAR * 2;
    let y = MAR;

    // Title bar
    doc.setFillColor(30, 64, 175);
    doc.rect(MAR, y, COL, 10, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(13);
    doc.setFont("helvetica", "bold");
    doc.text("NOE BEACH CLUB  -  ORDER FORM", MAR + 4, y + 7);
    y += 14;

    // Header grid
    const hRowH = 8;
    const labelW = 42;
    const col1X = MAR;
    const col2X = MAR + labelW;
    const col3X = MAR + COL / 2 + 2;
    const col4X = col3X + labelW;
    const col2W = COL / 2 - labelW - 2;
    const col4W = COL / 2 - labelW;

    const headerRows = [
      ["Supplier", supplierName, "Date", today],
      ["Contact Email", toEmail, "Menu", menuName],
      ["Covers", String(coverCount), "Total Amount", gross > 0 ? gross.toFixed(2) + " EUR" : "-"],
    ];

    for (const [l1, v1, l2, v2] of headerRows) {
      doc.setFillColor(30, 64, 175);
      doc.rect(col1X, y, labelW, hRowH, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(8);
      doc.setFont("helvetica", "bold");
      doc.text(l1, col1X + 2, y + 5.5);
      doc.setFillColor(248, 250, 252);
      doc.rect(col2X, y, col2W, hRowH, "F");
      doc.setDrawColor(200, 200, 200);
      doc.rect(col2X, y, col2W, hRowH, "S");
      doc.setTextColor(30, 30, 30);
      doc.setFont("helvetica", "normal");
      doc.text(String(v1).substring(0, 38), col2X + 2, y + 5.5);
      if (l2) {
        doc.setFillColor(30, 64, 175);
        doc.rect(col3X, y, labelW, hRowH, "F");
        doc.setTextColor(255, 255, 255);
        doc.setFont("helvetica", "bold");
        doc.text(l2, col3X + 2, y + 5.5);
        doc.setFillColor(248, 250, 252);
        doc.rect(col4X, y, col4W, hRowH, "F");
        doc.setDrawColor(200, 200, 200);
        doc.rect(col4X, y, col4W, hRowH, "S");
        doc.setTextColor(30, 30, 30);
        doc.setFont("helvetica", "normal");
        doc.text(String(v2).substring(0, 30), col4X + 2, y + 5.5);
      }
      y += hRowH;
    }
    y += 6;

    // Items table header
    const colWidths = [86, 22, 26, 18, 30];
    const colX = [MAR, MAR + 86, MAR + 108, MAR + 134, MAR + 152];
    const rowH = 7;
    const aligns: ("left" | "right" | "center")[] = ["left", "center", "right", "center", "right"];

    doc.setFillColor(30, 64, 175);
    doc.rect(MAR, y, COL, rowH, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    const headers = ["Product", "Quantity", "Unit Price", "Unit", "Total"];
    for (let c = 0; c < headers.length; c++) {
      const x = c === 0 ? colX[c] + 2 : c === 4 ? colX[c] + colWidths[c] - 2 : colX[c] + colWidths[c] / 2;
      doc.text(headers[c], x, y + 5, { align: aligns[c] });
    }
    y += rowH;

    // Item rows
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const isEven = i % 2 === 0;
      doc.setFillColor(isEven ? 248 : 255, isEven ? 250 : 255, isEven ? 252 : 255);
      doc.rect(MAR, y, COL, rowH, "F");
      doc.setDrawColor(229, 231, 235);
      doc.line(MAR, y + rowH, MAR + COL, y + rowH);
      doc.setTextColor(30, 30, 30);
      doc.setFontSize(8);
      doc.setFont("helvetica", "normal");
      const qty = item.qty % 1 === 0 ? item.qty.toFixed(0) : item.qty.toFixed(3);
      const vals = [
        item.name.substring(0, 46),
        qty,
        item.unitCost > 0 ? item.unitCost.toFixed(2) + " EUR" : "-",
        item.unit,
        item.cost > 0 ? item.cost.toFixed(2) + " EUR" : "-",
      ];
      for (let c = 0; c < vals.length; c++) {
        const x = c === 0 ? colX[c] + 2 : c === 4 ? colX[c] + colWidths[c] - 2 : colX[c] + colWidths[c] / 2;
        doc.text(vals[c], x, y + 5, { align: aligns[c] });
      }
      y += rowH;
      if (y > 265) { doc.addPage(); y = MAR; }
    }

    // Totals
    y += 2;
    if (gross > 0) {
      const totals: [string, string][] = [
        ["Net Amount:", net.toFixed(2) + " EUR"],
        ["VAT:", vat.toFixed(2) + " EUR"],
      ];
      for (const [label, val] of totals) {
        doc.setFillColor(248, 250, 252);
        doc.rect(MAR, y, COL, 7, "F");
        doc.setDrawColor(203, 213, 225);
        doc.line(MAR, y + 7, MAR + COL, y + 7);
        doc.setTextColor(100, 100, 100);
        doc.setFontSize(8);
        doc.setFont("helvetica", "normal");
        doc.text(label, colX[3] + colWidths[3] - 2, y + 5, { align: "right" });
        doc.text(val, colX[4] + colWidths[4] - 2, y + 5, { align: "right" });
        y += 7;
      }
    }
    doc.setFillColor(30, 58, 138);
    doc.rect(MAR, y, COL, 8, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.text("TOTAL:", colX[3] + colWidths[3] - 2, y + 5.5, { align: "right" });
    doc.text(gross > 0 ? gross.toFixed(2) + " EUR" : "-", colX[4] + colWidths[4] - 2, y + 5.5, { align: "right" });

    // Footer
    doc.setTextColor(148, 163, 184);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.text(`NOE BEACH CLUB  |  ${supplierName}  |  ${today}`, W / 2, 287, { align: "center" });

    const blobUrl = doc.output("bloburl");
    window.open(blobUrl, "_blank");
  }

  function loadMenu(menu: Menu) {
    if (!menu) return;
    setSelectedMenu(menu);
    setEditing(true);
    setMenuTitle(menu.title);
    setMenuTitleEn(menu.titleEn || "");
    setMenuRecipes((menu.recipes || []).map(r => ({
      ...r,
      portionType: (r.portionType ?? "portion") as "portion" | "kg",
    })));
  }

  function newMenu() {
    setSelectedMenu(null);
    setEditing(true);
    setMenuTitle("");
    setMenuTitleEn("");
    setMenuRecipes([]);
  }

  function addRecipe(recipe: Recipe, portionType: "portion" | "kg") {
    const cost = Number(recipe.totalCost);
    const sell = cost > 0 ? cost / (1 - Number(recipe.profitMarginPercent || 60) / 100) : 0;
    const portionYield = Number(recipe.portionYield) || 1;
    const newRow: MenuRecipe = {
      recipeId: recipe.id,
      recipeName: recipe.name,
      portions: portionType === "kg" ? 1 : portionYield,
      portionType,
      foodCost: cost.toFixed(2),
      sellingPrice: sell.toFixed(2),
      profitMargin: recipe.profitMarginPercent || "60",
    };
    setMenuRecipes(prev => [...prev, newRow]);
    setShowAddRecipe(false);
    setRecipeSearch("");
  }

  function removeMenuRecipe(idx: number) {
    setMenuRecipes(prev => prev.filter((_, i) => i !== idx));
  }

  function updateMenuRecipe(idx: number, field: string, value: number | string) {
    setMenuRecipes(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  }

  const totalRecipes = menuRecipes.length;
  const totalPortions = menuRecipes.reduce((s, r) => s + r.portions, 0);
  const totalFoodCost = menuRecipes.reduce((s, r) => s + Number(r.foodCost) * r.portions, 0);
  const avgMargin = menuRecipes.length > 0
    ? menuRecipes.reduce((s, r) => s + Number(r.profitMargin), 0) / menuRecipes.length
    : 0;
  const fmt = (n: number) => `€${n.toFixed(2)}`;

  async function saveMenu() {
    if (!menuTitle) return;
    setSaving(true);
    try {
      await db.upsertMenu({
        id: selectedMenu?.id,
        title: menuTitle,
        titleEn: menuTitleEn || null,
        status: selectedMenu?.status ?? "active",
        totalRecipes,
        totalPortions,
        avgProfitMargin: avgMargin.toFixed(2),
        totalFoodCost: totalFoodCost.toFixed(2),
        recipes: menuRecipes,
      });
      await refreshAll();
      setEditing(false);
    } catch (err) {
      alert(locale === "gr" ? "Αποτυχία αποθήκευσης: " + String(err) : "Failed to save: " + String(err));
    } finally {
      setSaving(false);
    }
  }

  async function deleteMenu(id: number) {
    if (!confirm(t("deleteConfirm"))) return;
    setDeletingId(id);
    try {
      await db.deleteMenu(id);
      await refreshAll();
      if (selectedMenu?.id === id) { setSelectedMenu(null); setEditing(false); }
    } catch (err) {
      alert(locale === "gr" ? "Αποτυχία διαγραφής: " + String(err) : "Failed to delete: " + String(err));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div>
      <PageHeader title={t("headerMenuPlanner")} subtitle="Κοστολόγηση Μενού & Εξαγωγή">
        <button onClick={newMenu} className="erp-btn-primary">➕ {t("btnNewMenu")}</button>
        {editing && <button onClick={saveMenu} disabled={saving} className="erp-btn-success">{saving ? "…" : "💾"} {t("btnSaveMenu")}</button>}
        {editing && menuRecipes.length > 0 && (
          <button onClick={openConsumption} className="erp-btn-secondary">
            📋 {locale === "gr" ? "Αναφορά Ανάλωσης" : "Consumption Report"}
          </button>
        )}
        {editing && <button onClick={() => setEditing(false)} className="erp-btn-secondary">✕ {locale === "gr" ? "Ακύρωση" : "Cancel"}</button>}
        {editing && <button onClick={() => window.print()} className="erp-btn-secondary">🖨️ {t("btnPrint")}</button>}
      </PageHeader>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard label={locale === "gr" ? "Σύνολο Συνταγών" : "Total Recipes"} value={totalRecipes} color="blue" icon="👨‍🍳" />
        <KpiCard label={locale === "gr" ? "Σύνολο Μερίδων" : "Total Portions"} value={totalPortions} color="green" icon="🍽️" />
        <KpiCard label={locale === "gr" ? "Σύνολο Κόστους" : "Total Food Cost"} value={fmt(totalFoodCost)} color="amber" icon="💰" />
        <KpiCard label={t("fieldProfitMargin")} value={`${avgMargin.toFixed(1)}%`} color="purple" icon="📈" />
      </div>

      <div className="flex gap-6">
        {/* Λίστα μενού */}
        <div className={`${editing ? "hidden lg:block lg:w-1/4" : "w-full"}`}>
          <div className="erp-card">
            <div className="erp-card-header"><h3 className="font-semibold">📚 {t("headerMenuArchive")}</h3></div>
            <div className="divide-y max-h-[500px] overflow-y-auto">
              {menus.length === 0
                ? <div className="p-8 text-center text-slate-400">{t("noData")}</div>
                : menus.map((m, idx) => (
                  <div
                    key={m?.id ?? `menu-${idx}`}
                    onClick={() => loadMenu(m)}
                    className={`p-4 cursor-pointer hover:bg-blue-50/50 transition-colors ${selectedMenu?.id === m?.id ? "bg-blue-50 border-l-4 border-blue-500" : ""}`}
                  >
                    <div className="font-medium">{m?.title ?? "—"}</div>
                    {m?.titleEn && <div className="text-xs text-slate-400">{m.titleEn}</div>}
                    <div className="flex gap-2 mt-1">
                      <Badge color="blue">{m?.totalRecipes} {locale === "gr" ? "συντ." : "rec."}</Badge>
                      <Badge color="green">{m?.avgProfitMargin}%</Badge>
                    </div>
                    <button
                      onClick={e => { e.stopPropagation(); m?.id && deleteMenu(m.id); }}
                      disabled={deletingId === m?.id}
                      className="text-red-400 hover:text-red-600 text-xs mt-1"
                    >
                      {deletingId === m?.id ? "…" : t("btnDelete")}
                    </button>
                  </div>
                ))}
            </div>
          </div>
        </div>

        {/* Επεξεργαστής μενού */}
        {editing && (
          <div className="flex-1">
            {/* Τίτλοι */}
            <div className="erp-card mb-6">
              <div className="p-6">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="erp-label">{locale === "gr" ? "Τίτλος Μενού" : "Menu Title"}</label>
                    <input
                      type="text"
                      value={menuTitle}
                      onChange={e => setMenuTitle(e.target.value)}
                      className="erp-input"
                      placeholder="Μενού Χειμώνα 2026"
                    />
                  </div>
                  <div>
                    <label className="erp-label">English Title</label>
                    <input
                      type="text"
                      value={menuTitleEn}
                      onChange={e => setMenuTitleEn(e.target.value)}
                      className="erp-input"
                      placeholder="Winter Menu 2026"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Πίνακας συνταγών */}
            <div className="erp-card mb-6">
              <div className="erp-card-header flex items-center justify-between">
                <h3 className="font-semibold">🍽️ {locale === "gr" ? "Συνταγές Μενού" : "Menu Recipes"}</h3>
                <button onClick={() => { setShowAddRecipe(true); setRecipeSearch(""); }} className="erp-btn-primary text-xs">
                  ➕ {locale === "gr" ? "Προσθήκη Συνταγής" : "Add Recipe"}
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="erp-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>{t("fieldRecipeName")}</th>
                      <th>{locale === "gr" ? "Τύπος" : "Type"}</th>
                      <th>{locale === "gr" ? "Ποσότητα" : "Qty"}</th>
                      <th>{locale === "gr" ? "Κόστος/μον." : "Cost/unit"}</th>
                      <th>{locale === "gr" ? "Τιμή Πώλησης" : "Selling Price"}</th>
                      <th>{t("fieldProfitMargin")}</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {menuRecipes.length === 0
                      ? <tr><td colSpan={8} className="text-center py-6 text-slate-400">{t("noData")}</td></tr>
                      : menuRecipes.map((mr, i) => (
                        <tr key={i}>
                          <td className="text-xs text-slate-400">{i + 1}</td>
                          <td className="font-medium">{mr.recipeName}</td>
                          <td>
                            <select
                              value={mr.portionType ?? "portion"}
                              onChange={e => updateMenuRecipe(i, "portionType", e.target.value)}
                              className="erp-input text-sm py-1 min-w-[9rem]"
                            >
                              <option value="portion">{locale === "gr" ? "Μερίδα" : "Portion"}</option>
                              <option value="kg">{locale === "gr" ? "Κιλό (μπουφές)" : "Kg (buffet)"}</option>
                            </select>
                          </td>
                          <td>
                            <input
                              type="number"
                              value={mr.portions}
                              onChange={e => updateMenuRecipe(i, "portions", Number(e.target.value))}
                              className="erp-input w-20 text-sm py-1"
                              min="0.1"
                              step={mr.portionType === "kg" ? "0.1" : "1"}
                            />
                            <span className="text-xs text-slate-400 ml-1">
                              {mr.portionType === "kg" ? "kg" : (locale === "gr" ? "μερ." : "pcs")}
                            </span>
                          </td>
                          <td className="font-medium">{fmt(Number(mr.foodCost))}</td>
                          <td className="font-semibold text-emerald-700">{fmt(Number(mr.sellingPrice))}</td>
                          <td><Badge color={Number(mr.profitMargin) >= 60 ? "green" : "amber"}>{mr.profitMargin}%</Badge></td>
                          <td><button onClick={() => removeMenuRecipe(i)} className="text-red-400 hover:text-red-600">✕</button></td>
                        </tr>
                      ))}
                  </tbody>
                  {menuRecipes.length > 0 && (
                    <tfoot>
                      <tr className="bg-slate-50 font-bold">
                        <td colSpan={3} className="text-right">{t("total")}:</td>
                        <td>{totalPortions}</td>
                        <td>{fmt(totalFoodCost)}</td>
                        <td className="text-emerald-700">{fmt(menuRecipes.reduce((s, r) => s + Number(r.sellingPrice) * r.portions, 0))}</td>
                        <td><Badge color="green">{avgMargin.toFixed(1)}%</Badge></td>
                        <td></td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Modal προσθήκης συνταγής */}
      <Modal
        isOpen={showAddRecipe}
        onClose={() => { setShowAddRecipe(false); setRecipeSearch(""); }}
        title={locale === "gr" ? "Προσθήκη Συνταγής στο Μενού" : "Add Recipe to Menu"}
        size="lg"
      >
        <div className="space-y-3">
          <input
            type="text"
            autoFocus
            value={recipeSearch}
            onChange={e => setRecipeSearch(e.target.value)}
            className="erp-input"
            placeholder={locale === "gr" ? "🔍 Αναζήτηση συνταγής…" : "🔍 Search recipe…"}
          />
          <div className="text-xs text-slate-400">
            {filteredRecipes.length} {locale === "gr" ? "συνταγές" : "recipes"}
            {recipeSearch && ` (από ${allRecipes.length})`}
          </div>
          <div className="space-y-1 max-h-[380px] overflow-y-auto">
            {filteredRecipes.length === 0
              ? <div className="text-center py-8 text-slate-400">{locale === "gr" ? "Δεν βρέθηκαν συνταγές" : "No recipes found"}</div>
              : filteredRecipes.map((r, idx) => (
                <div key={r?.id ?? `recipe-${idx}`} className="flex items-center justify-between p-3 rounded-lg hover:bg-blue-50 border">
                  <div className="flex-1 min-w-0 mr-3">
                    <div className="font-medium truncate">{r?.name ?? "—"}</div>
                    {r?.nameEn && <div className="text-xs text-slate-400 truncate">{r.nameEn}</div>}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Badge color="blue">{r?.portionYield} {locale === "gr" ? "μερ." : "pcs"}</Badge>
                    <Badge color="green">€{Number(r?.totalCost ?? 0).toFixed(2)}</Badge>
                    <button
                      onClick={() => addRecipe(r, "portion")}
                      className="erp-btn-primary text-xs px-2 py-1"
                      title={locale === "gr" ? "Προσθήκη ως μερίδα" : "Add as portion"}
                    >
                      🍽️ {locale === "gr" ? "Μερίδα" : "Portion"}
                    </button>
                    <button
                      onClick={() => addRecipe(r, "kg")}
                      className="erp-btn-secondary text-xs px-2 py-1"
                      title={locale === "gr" ? "Προσθήκη ως κιλό (μπουφές)" : "Add as kg (buffet)"}
                    >
                      ⚖️ Kg
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </div>
      </Modal>

      {/* Modal Αναφοράς Ανάλωσης */}
      <Modal
        isOpen={showConsumption}
        onClose={() => setShowConsumption(false)}
        title={locale === "gr" ? `📋 Αναφορά Ανάλωσης — ${menuTitle}` : `📋 Consumption Report — ${menuTitle}`}
        size="lg"
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              {Array.from(bySupplier.entries()).map(([supplierName, items]) => (
                <span key={supplierName} className="flex gap-1">
                  <button
                    onClick={() => handleExportPDF(supplierName, items)}
                    className="erp-btn-secondary text-xs"
                    title={`PDF παραγγελίας για ${supplierName}`}
                  >
                    📄 PDF
                  </button>
                  <button
                    onClick={() => sendOrderEmail(supplierName, items)}
                    className="erp-btn-secondary text-xs"
                    title={`Αποστολή παραγγελίας στον ${supplierName}`}
                  >
                    📧 {supplierName} — €{items.reduce((s, i) => s + i.cost, 0).toFixed(2)}
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowConsumption(false)} className="erp-btn-primary text-xs">
                ✓ {locale === "gr" ? "Κλείσιμο" : "Close"}
              </button>
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          {/* Επιλογή αριθμού ατόμων */}
          <div className="flex items-center gap-4 p-4 bg-blue-50 rounded-lg">
            <label className="font-medium text-sm whitespace-nowrap">
              {locale === "gr" ? "👥 Αριθμός Ατόμων:" : "👥 Number of Covers:"}
            </label>
            <input
              type="number"
              value={coverCount}
              onChange={e => setCoverCount(Math.max(1, Number(e.target.value)))}
              className="erp-input w-24 text-center font-bold text-lg"
              min="1"
              step="1"
            />
            <span className="text-xs text-slate-500">
              {locale === "gr"
                ? "Οι ποσότητες υλικών υπολογίζονται για τις συνταγές Μερίδας. Οι συνταγές Κιλό δεν αλλάζουν."
                : "Ingredient quantities are calculated for Portion-type recipes. Kg-type recipes stay fixed."}
            </span>
          </div>

          {/* Σύνοψη */}
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="bg-blue-50 rounded-lg p-3">
              <div className="text-2xl font-bold text-blue-700">{menuRecipes.length}</div>
              <div className="text-xs text-slate-500">{locale === "gr" ? "Συνταγές" : "Recipes"}</div>
            </div>
            <div className="bg-green-50 rounded-lg p-3">
              <div className="text-2xl font-bold text-green-700">{coverCount}</div>
              <div className="text-xs text-slate-500">{locale === "gr" ? "Άτομα" : "Covers"}</div>
            </div>
            <div className="bg-amber-50 rounded-lg p-3">
              <div className="text-2xl font-bold text-amber-700">{consumptionItems.length}</div>
              <div className="text-xs text-slate-500">{locale === "gr" ? "Υλικά" : "Ingredients"}</div>
            </div>
          </div>

          {/* Πίνακας υλικών */}
          {loadingIngredients ? (
            <div className="text-center py-8 text-slate-400">
              <div className="text-3xl mb-2">⏳</div>
              <div>{locale === "gr" ? "Φόρτωση υλικών..." : "Loading ingredients..."}</div>
            </div>
          ) : consumptionItems.length === 0 ? (
            <div className="text-center py-8 text-slate-400">
              {locale === "gr"
                ? "Δεν βρέθηκαν υλικά. Οι συνταγές πρέπει να έχουν καταχωρημένα υλικά."
                : "No ingredients found. Recipes must have ingredients recorded."}
            </div>
          ) : (
            <div className="overflow-y-auto max-h-[400px]">
              <table className="erp-table text-sm">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>{locale === "gr" ? "Υλικό" : "Ingredient"}</th>
                    <th>{locale === "gr" ? "Ποσ." : "Qty"}</th>
                    <th>{locale === "gr" ? "Μον." : "Unit"}</th>
                    <th>{locale === "gr" ? "Τιμή/μον." : "Unit Price"}</th>
                    <th>{locale === "gr" ? "Προμηθευτής" : "Supplier"}</th>
                    <th>{locale === "gr" ? "Σύνολο" : "Total"}</th>
                    <th title={locale === "gr" ? "Εξαίρεση από παραγγελία" : "Exclude from order"}>✕</th>
                  </tr>
                </thead>
                <tbody>
                  {consumptionItems.map((item, i) => {
                    const opts = supplierOptions[item.name] || [];
                    const isLoadingOpts = loadingOptions === item.name;
                    return (
                      <tr key={i} className={!item.hasPrice ? "bg-amber-50" : ""}>
                        <td className="text-xs text-slate-400">{i + 1}</td>
                        <td className="font-medium">{item.name}</td>
                        <td className="font-bold text-blue-700">
                          {item.qty % 1 === 0 ? item.qty.toFixed(0) : item.qty.toFixed(3)}
                        </td>
                        <td className="text-slate-500">{item.unit}</td>
                        <td className="text-slate-600">
                          {item.hasPrice ? `€${item.unitCost.toFixed(2)}` : <span className="text-amber-500 text-xs">—</span>}
                        </td>
                        <td>
                          {/* Dropdown αλλαγής προμηθευτή */}
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-slate-500 truncate max-w-[80px]">{item.supplierName || "—"}</span>
                            <button
                              className="text-xs text-blue-500 hover:text-blue-700 underline whitespace-nowrap"
                              onClick={async () => { await loadSupplierOptions(item.name); }}
                              title={locale === "gr" ? "Αλλαγή προμηθευτή" : "Change supplier"}
                            >
                              {isLoadingOpts ? "⏳" : "✎"}
                            </button>
                          </div>
                          {opts.length > 0 && (
                            <select
                              className="erp-select text-xs mt-1 w-full"
                              value={supplierPrices[item.name]?.supplierProductId ?? ""}
                              onChange={e => {
                                const sel = opts.find(o => o.supplierProductId === Number(e.target.value));
                                if (sel) changeIngredientSupplier(item.name, sel.supplierProductId, sel.basePrice, sel.supplierName, sel.productName, sel.unit, sel.supplierId);
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
                        <td className={item.hasPrice ? "text-emerald-700 font-medium" : "text-slate-300"}>
                          {item.hasPrice ? fmt(item.cost) : "—"}
                        </td>
                        <td className="text-center">
                          <button
                            onClick={() => toggleExclude(item.name)}
                            className="text-red-400 hover:text-red-600 text-sm font-bold"
                            title={locale === "gr" ? "Εξαίρεση από παραγγελία" : "Exclude from order"}
                          >✕</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 font-bold">
                    <td colSpan={7} className="text-right">{t("total")}:</td>
                    <td className="text-emerald-700">{fmt(consumptionItems.reduce((s, i) => s + i.cost, 0))}</td>
                  </tr>
                </tfoot>
              </table>
              {consumptionItems.some(i => !i.hasPrice) && (
                <p className="text-xs text-amber-600 mt-2">
                  ⚠️ {locale === "gr"
                    ? "Τα τονισμένα υλικά δεν βρέθηκαν στις προσφορές — τιμή 0."
                    : "Highlighted items have no supplier price — cost shown as 0."}
                </p>
              )}
              {excludedList.length > 0 && (
                <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-xs font-semibold text-red-700 mb-2">
                    🚫 {locale === "gr" ? "Εξαιρεθέντα από παραγγελία:" : "Excluded from order:"}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {excludedList.map(ex => (
                      <button
                        key={ex.name}
                        onClick={() => toggleExclude(ex.name)}
                        className="inline-flex items-center gap-1 text-xs bg-white border border-red-300 text-red-700 rounded px-2 py-1 hover:bg-red-100"
                        title={locale === "gr" ? "Κλικ για επαναφορά" : "Click to restore"}
                      >
                        <span>{ex.name}</span>
                        <span className="text-slate-400">({ex.qty % 1 === 0 ? ex.qty.toFixed(0) : ex.qty.toFixed(3)} {ex.unit})</span>
                        <span className="text-green-600 font-bold ml-1">↩</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

        </div>
      </Modal>
    </div>
  );
}
