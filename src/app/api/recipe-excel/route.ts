import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";

// POST /api/recipe-excel
// Body: { recipe, ingredients, locale, costing }
export async function POST(req: NextRequest) {
  try {
  const { recipe, ingredients, locale, costing } = await req.json();

  const isGr     = locale === "gr";
  const portions = Number(recipe.portionYield) || 1;
  const allergens: string[] = Array.isArray(recipe.allergens)
    ? recipe.allergens
    : JSON.parse(recipe.allergens || "[]");

  const totalGrams = (ingredients as {unit:string;quantity:number}[]).reduce(
    (s: number, i) => s + (["ΓΡΑΜΜΑΡΙΑ","GR","g","gr"].includes(i.unit.toUpperCase()) ? i.quantity : 0), 0
  );
  const perPortion       = costing.menuFinal;
  const profitPerPortion = perPortion - costing.total / portions;
  const costPct          = perPortion > 0 ? (costing.total / portions / perPortion * 100) : 0;
  const profitPct        = perPortion > 0 ? (profitPerPortion / perPortion * 100) : 0;
  const today            = new Date().toLocaleDateString("el-GR");

  // ── Χρώματα ──
  const BLU = "1A5276";
  const LBL = "D6EAF8";
  const GRN = "E9F7EF";
  const YLW = "FEF9E7";
  const WHT = "FFFFFF";

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(isGr ? "Συνταγή" : "Recipe");

  // Πλάτη στηλών (A–J)
  ws.columns = [
    { width: 38 }, // A — Υλικό
    { width: 12 }, // B — Μονάδες
    { width: 14 }, // C — Τιμή/μον
    { width: 14 }, // D — Ποσ/μερίδα
    { width: 16 }, // E — Συνολική ποσ
    { width: 20 }, // F — Κόστος/μερίδα
    { width: 16 }, // G — Κόστος σύνολο
    { width: 14 }, // H
    { width: 14 }, // I
    { width: 10 }, // J
  ];

  type FillSolid = { type: "pattern"; pattern: "solid"; fgColor: { argb: string } };
  function fillSolid(hex: string): FillSolid {
    return { type: "pattern", pattern: "solid", fgColor: { argb: `FF${hex}` } };
  }
  function fontBold(sz: number, color = "000000"): Partial<ExcelJS.Font> {
    return { bold: true, size: sz, color: { argb: `FF${color}` } };
  }
  function borderThin(): Partial<ExcelJS.Borders> {
    const s = { style: "thin" as const, color: { argb: "FFCCCCCC" } };
    return { top: s, left: s, bottom: s, right: s };
  }

  let r = 1; // γραμμή (1-based για ExcelJS)

  // ── ROW 1: RECIPE BUILDER header ──
  ws.mergeCells(`A${r}:J${r}`);
  const hdrCell = ws.getCell(`A${r}`);
  hdrCell.value        = "RECIPE BUILDER";
  hdrCell.font         = { bold: true, size: 16, italic: true, color: { argb: `FF${WHT}` } };
  hdrCell.fill         = fillSolid(BLU);
  hdrCell.alignment    = { horizontal: "center", vertical: "middle" };
  ws.getRow(r).height  = 28;
  r++;

  // ── ROW 2: Ονομασία label + τιμή + Μερίδες ──
  ws.getCell(`A${r}`).value = isGr ? "ΟΝΟΜΑ ΣΥΝΤΑΓΗΣ:" : "RECIPE NAME:";
  ws.getCell(`A${r}`).font  = fontBold(10);
  ws.mergeCells(`B${r}:H${r}`);
  ws.getCell(`B${r}`).value     = recipe.name.toUpperCase();
  ws.getCell(`B${r}`).font      = { bold: true, size: 13 };
  ws.getCell(`I${r}`).value     = isGr ? "ΜΕΡΙΔΕΣ:" : "PORTIONS:";
  ws.getCell(`I${r}`).font      = fontBold(10, BLU);
  ws.getCell(`I${r}`).fill      = fillSolid("D6EAF8");
  ws.getCell(`I${r}`).alignment = { horizontal: "center" };
  ws.getCell(`J${r}`).value     = recipe.portionYield;
  ws.getCell(`J${r}`).font      = { bold: true, size: 13 };
  ws.getCell(`J${r}`).fill      = fillSolid("D6EAF8");
  ws.getCell(`J${r}`).alignment = { horizontal: "center" };
  ws.getRow(r).height = 22;
  r++;

  // ── ROW 3: EN ονομασία + Αλλεργίες ──
  ws.getCell(`A${r}`).value = isGr ? "ΟΝΟΜΑΣΙΑ (EN):" : "NAME (EN):";
  ws.mergeCells(`B${r}:F${r}`);
  ws.getCell(`B${r}`).value = recipe.nameEn ?? "";
  ws.getCell(`G${r}`).value = isGr ? "ΑΛΛΕΡΓΙΕΣ:" : "ALLERGENS:";
  ws.getCell(`G${r}`).font  = fontBold(9);
  ws.mergeCells(`H${r}:J${r}`);
  ws.getCell(`H${r}`).value = allergens.join(", ") || "—";
  r++;
  r++; // κενό

  // ── ROW 5: Επικεφαλίδα πίνακα υλικών ──
  const ingHdrs = [
    isGr ? "ΥΛΙΚΟ" : "INGREDIENT",
    isGr ? "ΜΟΝΑΔΕΣ" : "UNITS",
    isGr ? "ΤΙΜΗ/ΜΟΝΑΔΑ €" : "PRICE/UNIT €",
    isGr ? "ΠΟΣΟΤΗΤΑ/ΜΕΡΙΔΑ" : "QTY/PORTION",
    isGr ? "ΣΥΝΟΛΙΚΗ ΠΟΣΟΤΗΤΑ" : "TOTAL QTY",
    isGr ? "ΚΟΣΤΟΣ ΥΛΙΚΩΝ/ΜΕΡΙΔΑ €" : "COST/PORTION €",
    isGr ? "ΚΟΣΤΟΣ ΣΥΝΟΛΟ €" : "TOTAL COST €",
  ];
  const cols = ["A","B","C","D","E","F","G"] as const;
  ingHdrs.forEach((h, i) => {
    const cell = ws.getCell(`${cols[i]}${r}`);
    cell.value     = h;
    cell.font      = fontBold(9, WHT);
    cell.fill      = fillSolid(BLU);
    cell.alignment = { horizontal: "center", wrapText: true };
    cell.border    = borderThin();
  });
  ws.getRow(r).height = 30;
  r++;

  // ── Γραμμές υλικών ──
  const MIN_ROWS = 20;
  (ingredients as {productName:string;unit:string;unitCost:number;quantity:number;totalCost:number}[]).forEach((ing) => {
    const row = ws.getRow(r);
    const vals = [
      ing.productName.toUpperCase(),
      ing.unit.toUpperCase(),
      Number(ing.unitCost),
      Number((ing.quantity / portions).toFixed(6)),
      Number(ing.quantity),
      Number((ing.totalCost / portions).toFixed(6)),
      Number(ing.totalCost),
    ];
    vals.forEach((v, i) => {
      const cell = ws.getCell(`${cols[i]}${r}`);
      cell.value     = v;
      cell.border    = borderThin();
      cell.alignment = i === 0 ? { horizontal: "left" } : { horizontal: "right" };
    });
    row.height = 16;
    r++;
  });
  // Κενές γραμμές μέχρι MIN_ROWS
  for (let i = (ingredients as unknown[]).length; i < MIN_ROWS; i++) {
    cols.forEach(c => {
      ws.getCell(`${c}${r}`).border = borderThin();
    });
    ws.getRow(r).height = 16;
    r++;
  }

  // ── Totals bar ──
  ws.mergeCells(`A${r}:B${r}`);
  ws.getCell(`A${r}`).value     = isGr ? "ΓΡΑΜΜΑΡΙΑ/ΜΕΡΙΔΑ:" : "GRAMS/PORTION:";
  ws.getCell(`A${r}`).font      = fontBold(9, WHT);
  ws.getCell(`A${r}`).fill      = fillSolid(BLU);
  ws.getCell(`A${r}`).alignment = { horizontal: "center" };
  // value
  ws.getCell(`C${r}`).value     = Number((totalGrams / portions).toFixed(3));
  ws.getCell(`C${r}`).font      = fontBold(10);
  ws.getCell(`C${r}`).fill      = fillSolid(LBL);
  ws.getCell(`C${r}`).alignment = { horizontal: "center" };

  ws.getCell(`D${r}`).value     = isGr ? "ΚΟΣΤΟΣ/ΜΕΡΙΔΑ:" : "COST/PORTION:";
  ws.getCell(`D${r}`).font      = fontBold(9, WHT);
  ws.getCell(`D${r}`).fill      = fillSolid(BLU);
  ws.getCell(`D${r}`).alignment = { horizontal: "center" };
  ws.getCell(`E${r}`).value     = Number((costing.rawMaterial / portions).toFixed(4));
  ws.getCell(`E${r}`).font      = fontBold(10);
  ws.getCell(`E${r}`).fill      = fillSolid(LBL);
  ws.getCell(`E${r}`).alignment = { horizontal: "center" };

  ws.getCell(`F${r}`).value     = isGr ? "ΣΥΝΟΛΙΚΑ ΓΡΑΜΜΑΡΙΑ:" : "TOTAL GRAMS:";
  ws.getCell(`F${r}`).font      = fontBold(9, WHT);
  ws.getCell(`F${r}`).fill      = fillSolid(BLU);
  ws.getCell(`F${r}`).alignment = { horizontal: "center" };
  ws.getCell(`G${r}`).value     = Number(totalGrams.toFixed(3));
  ws.getCell(`G${r}`).font      = fontBold(10);
  ws.getCell(`G${r}`).fill      = fillSolid(LBL);
  ws.getCell(`G${r}`).alignment = { horizontal: "center" };
  ws.getRow(r).height = 20;
  r++;
  r++; // κενό

  // ── ΚΟΣΤΟΛΟΓΗΣΗ header ──
  ws.mergeCells(`A${r}:G${r}`);
  ws.getCell(`A${r}`).value     = isGr ? "ΚΟΣΤΟΛΟΓΗΣΗ" : "COSTING";
  ws.getCell(`A${r}`).font      = fontBold(12, WHT);
  ws.getCell(`A${r}`).fill      = fillSolid(BLU);
  ws.getCell(`A${r}`).alignment = { horizontal: "center" };
  ws.getRow(r).height = 22;
  r++;

  const costLines: [string, number | string, boolean][] = [
    [isGr ? "Κόστος Υλικών (Raw Material)" : "Raw Material Cost",     costing.rawMaterial,                false],
    [isGr ? "Κόστος Εργασίας (Labor)"      : "Labor Cost",            Number(recipe.laborCost),           false],
    [isGr ? "Γενικά Έξοδα (Overhead)"      : "Overhead",              Number(recipe.overheadCost),        false],
    [isGr ? "ΣΥΝΟΛΙΚΟ ΚΟΣΤΟΣ"              : "TOTAL COST",            costing.total,                      true ],
    [isGr ? "Περιθώριο Κέρδους %"          : "Profit Margin %",       `${recipe.profitMarginPercent}%`,   false],
    [isGr ? "Τιμή Πώλησης (χωρίς ΦΠΑ)"    : "Selling Price (ex VAT)",costing.selling,                    false],
    [isGr ? "Τιμή Μενού (ΦΠΑ 24%)"        : "Menu Price (VAT 24%)",  costing.menuVat,                    false],
    [isGr ? "ΤΙΜΗ ΠΩΛΗΣΗΣ ΜΕΡΙΔΑΣ"        : "SELLING PRICE/PORTION", perPortion,                         true ],
    [isGr ? "ΚΕΡΔΟΣ/ΜΕΡΙΔΑ"               : "PROFIT/PORTION",        profitPerPortion,                   true ],
    [isGr ? "ΚΟΣΤΟΣ %"                     : "COST %",                `${costPct.toFixed(2)}%`,           false],
    [isGr ? "ΚΕΡΔΟΣ %"                     : "PROFIT %",              `${profitPct.toFixed(2)}%`,         false],
  ];

  costLines.forEach(([label, val, isBold]) => {
    // label cell (A:E merged)
    ws.mergeCells(`A${r}:E${r}`);
    const lCell = ws.getCell(`A${r}`);
    lCell.value     = label;
    lCell.font      = isBold ? fontBold(10) : { size: 9 };
    lCell.fill      = isBold ? fillSolid(GRN) : { type: "pattern", pattern: "solid", fgColor: { argb: "FFFAFAFA" } };
    lCell.border    = borderThin();

    // value cell (F:G merged) — merge FIRST, then set value
    ws.mergeCells(`F${r}:G${r}`);
    const vCell = ws.getCell(`F${r}`);
    vCell.value     = val;
    vCell.font      = isBold ? fontBold(11) : { size: 10 };
    vCell.fill      = isBold ? fillSolid(GRN) : { type: "pattern", pattern: "solid", fgColor: { argb: "FFFAFAFA" } };
    vCell.alignment = { horizontal: "right" };
    vCell.border    = borderThin();
    r++;
  });
  r++; // κενό

  // ── ΤΕΧΝΙΚΟΣ ΟΔΗΓΟΣ ──
  if (recipe.technicalGuide) {
    ws.mergeCells(`A${r}:G${r}`);
    ws.getCell(`A${r}`).value     = isGr ? "ΤΕΧΝΙΚΟΣ ΟΔΗΓΟΣ / TECHNICAL GUIDE" : "TECHNICAL GUIDE";
    ws.getCell(`A${r}`).font      = fontBold(10);
    ws.getCell(`A${r}`).fill      = fillSolid(YLW);
    ws.getCell(`A${r}`).alignment = { horizontal: "center" };
    ws.getRow(r).height = 20;
    r++;
    ws.mergeCells(`A${r}:G${r}`);
    ws.getCell(`A${r}`).value     = recipe.technicalGuide;
    ws.getCell(`A${r}`).alignment = { wrapText: true, vertical: "top" };
    ws.getRow(r).height = 60;
    r++;
  }
  r++; // κενό

  // ── Footer ──
  ws.getCell(`A${r}`).value = isGr ? "ΗΜΕΡΟΜΗΝΙΑ ΕΚΤΥΠΩΣΕΙΣ:" : "PRINT DATE:";
  ws.getCell(`A${r}`).font  = fontBold(9);
  ws.getCell(`B${r}`).value = today;
  ws.getCell(`B${r}`).font  = fontBold(10, BLU);

  // ── Παράγω buffer και επιστρέφω ──
  const buffer = await wb.xlsx.writeBuffer();

  const safeName = (recipe.name as string)
    .replace(/[^a-zA-Z0-9Ͱ-Ͽ_-]/g, "_")
    .slice(0, 40);
  const filename = `${safeName}_${new Date().toISOString().slice(0, 10)}.xlsx`;

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type":        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
  } catch (err) {
    console.error("[recipe-excel] ERROR:", err);
    return new NextResponse(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
