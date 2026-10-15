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

    const totalGrams = (ingredients as { unit: string; quantity: number }[]).reduce(
      (s, i) => s + (["ΓΡΑΜΜΑΡΙΑ", "GR", "G", "g", "gr"].includes(i.unit.toUpperCase()) ? Number(i.quantity) : 0),
      0
    );
    const perPortion       = Number(costing.menuFinal) || 0;
    const profitPerPortion = perPortion - (Number(costing.total) || 0) / portions;
    const costPct          = perPortion > 0 ? ((Number(costing.total) || 0) / portions / perPortion * 100) : 0;
    const profitPct        = perPortion > 0 ? (profitPerPortion / perPortion * 100) : 0;
    const today            = new Date().toLocaleDateString("el-GR");

    // ── Χρώματα ──
    const BLU  = "1A5276";  // σκούρο μπλε (headers)
    const LBL  = "D6EAF8";  // ανοιχτό μπλε (label cells)
    const GRN  = "D5F5E3";  // πράσινο (totals)
    const YLW  = "FEF9E7";  // κίτρινο (technical guide)
    const LGRY = "F2F3F4";  // ανοιχτό γκρι (zebra / alternate)
    const WHT  = "FFFFFF";

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(isGr ? "Συνταγή" : "Recipe");

    // ── Πλάτη στηλών A–H (8 στήλες, συνολικά ~110 chars = ~A4 portrait) ──
    ws.columns = [
      { width: 28 }, // A — Υλικό / Labels
      { width:  9 }, // B — Μονάδες
      { width: 11 }, // C — Τιμή/μον
      { width: 12 }, // D — Ποσ/μερίδα
      { width: 12 }, // E — Συνολική ποσ
      { width: 14 }, // F — Κόστος/μερίδα
      { width: 13 }, // G — Κόστος σύνολο
      { width: 12 }, // H — Τιμές κοστολόγησης
    ];

    // ── Βοηθητικές συναρτήσεις ──
    type FS = { type: "pattern"; pattern: "solid"; fgColor: { argb: string } };
    const fill = (hex: string): FS => ({ type: "pattern", pattern: "solid", fgColor: { argb: `FF${hex}` } });
    const bold = (sz: number, col = "000000"): Partial<ExcelJS.Font> => ({ bold: true, size: sz, color: { argb: `FF${col}` } });
    const thin = (): Partial<ExcelJS.Borders> => {
      const s = { style: "thin" as const, color: { argb: "FFBBBBBB" } };
      return { top: s, left: s, bottom: s, right: s };
    };
    const med = (): Partial<ExcelJS.Borders> => {
      const s = { style: "medium" as const, color: { argb: "FF888888" } };
      return { top: s, left: s, bottom: s, right: s };
    };

    let r = 1;

    // ════════════════════════════════════════════════════
    // ROW 1 — RECIPE BUILDER (full-width header)
    // ════════════════════════════════════════════════════
    ws.mergeCells(`A${r}:H${r}`);
    const hdr = ws.getCell(`A${r}`);
    hdr.value     = "RECIPE BUILDER";
    hdr.font      = { bold: true, size: 18, italic: true, color: { argb: `FF${WHT}` } };
    hdr.fill      = fill(BLU);
    hdr.alignment = { horizontal: "center", vertical: "middle" };
    ws.getRow(r).height = 26;
    r++;

    // ════════════════════════════════════════════════════
    // ROW 2 — Όνομα ΕΛ | Μερίδες
    // ════════════════════════════════════════════════════
    ws.getCell(`A${r}`).value     = isGr ? "ΟΝΟΜΑ ΣΥΝΤΑΓΗΣ:" : "RECIPE NAME:";
    ws.getCell(`A${r}`).font      = bold(9, BLU);
    ws.getCell(`A${r}`).fill      = fill(LBL);
    ws.getCell(`A${r}`).alignment = { horizontal: "left", vertical: "middle" };
    ws.getCell(`A${r}`).border    = thin();

    ws.mergeCells(`B${r}:F${r}`);
    ws.getCell(`B${r}`).value     = (recipe.name || "").toUpperCase();
    ws.getCell(`B${r}`).font      = { bold: true, size: 14 };
    ws.getCell(`B${r}`).alignment = { horizontal: "left", vertical: "middle" };
    ws.getCell(`B${r}`).border    = thin();

    ws.getCell(`G${r}`).value     = isGr ? "ΜΕΡΙΔΕΣ:" : "PORTIONS:";
    ws.getCell(`G${r}`).font      = bold(9, BLU);
    ws.getCell(`G${r}`).fill      = fill(LBL);
    ws.getCell(`G${r}`).alignment = { horizontal: "center", vertical: "middle" };
    ws.getCell(`G${r}`).border    = thin();

    ws.getCell(`H${r}`).value     = recipe.portionYield;
    ws.getCell(`H${r}`).font      = { bold: true, size: 14 };
    ws.getCell(`H${r}`).fill      = fill(LBL);
    ws.getCell(`H${r}`).alignment = { horizontal: "center", vertical: "middle" };
    ws.getCell(`H${r}`).border    = thin();
    ws.getRow(r).height = 20;
    r++;

    // ════════════════════════════════════════════════════
    // ROW 3 — Όνομα EN | Αλλεργίες
    // ════════════════════════════════════════════════════
    ws.getCell(`A${r}`).value     = isGr ? "ΟΝΟΜΑΣΙΑ (EN):" : "NAME (EN):";
    ws.getCell(`A${r}`).font      = bold(9, BLU);
    ws.getCell(`A${r}`).fill      = fill(LGRY);
    ws.getCell(`A${r}`).border    = thin();

    ws.mergeCells(`B${r}:C${r}`);
    ws.getCell(`B${r}`).value     = recipe.nameEn ?? "";
    ws.getCell(`B${r}`).border    = thin();

    ws.getCell(`D${r}`).value     = isGr ? "ΑΛΛΕΡΓΙΕΣ:" : "ALLERGENS:";
    ws.getCell(`D${r}`).font      = bold(9, BLU);
    ws.getCell(`D${r}`).fill      = fill(LGRY);
    ws.getCell(`D${r}`).border    = thin();

    ws.mergeCells(`E${r}:H${r}`);
    ws.getCell(`E${r}`).value     = allergens.join(", ") || "—";
    ws.getCell(`E${r}`).font      = { size: 9, italic: true };
    ws.getCell(`E${r}`).border    = thin();
    ws.getRow(r).height = 16;
    r++;

    // κενό διαχωριστικό
    ws.getRow(r).height = 4;
    r++;

    // ════════════════════════════════════════════════════
    // ROW 5 — Επικεφαλίδα πίνακα υλικών
    // ════════════════════════════════════════════════════
    const ingHdrs = [
      isGr ? "ΥΛΙΚΟ" : "INGREDIENT",
      isGr ? "ΜΟΝΑΔΕΣ" : "UNITS",
      isGr ? "ΤΙΜΗ/ΜΟΝΑΔΑ €" : "PRICE/UNIT",
      isGr ? "ΠΟΣΟΤΗΤΑ/ΜΕΡΙΔΑ" : "QTY/PORTION",
      isGr ? "ΣΥΝΟΛΙΚΗ ΠΟΣΟΤΗΤΑ" : "TOTAL QTY",
      isGr ? "ΚΟΣΤΟΣ/ΜΕΡΙΔΑ €" : "COST/PORTION",
      isGr ? "ΚΟΣΤΟΣ ΣΥΝΟΛΟ €" : "TOTAL COST",
      "",  // H κενό
    ];
    const COLS = ["A", "B", "C", "D", "E", "F", "G", "H"] as const;
    ingHdrs.forEach((h, i) => {
      const cell = ws.getCell(`${COLS[i]}${r}`);
      cell.value     = h;
      cell.font      = bold(9, WHT);
      cell.fill      = fill(BLU);
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.border    = med();
    });
    ws.getRow(r).height = 26;
    r++;

    // ════════════════════════════════════════════════════
    // Γραμμές υλικών
    // ════════════════════════════════════════════════════
    const MIN_ROWS = 20;
    type Ing = { productName: string; unit: string; unitCost: number; quantity: number; totalCost: number };
    const ingList = ingredients as Ing[];

    ingList.forEach((ing, idx) => {
      const isEven  = idx % 2 === 1;
      const rowFill = isEven ? fill(LGRY) : fill(WHT);
      const vals: (string | number)[] = [
        (ing.productName || "").toUpperCase(),
        (ing.unit || "").toUpperCase(),
        Number(ing.unitCost),
        Number((ing.quantity / portions).toFixed(6)),
        Number(ing.quantity),
        Number((ing.totalCost / portions).toFixed(6)),
        Number(ing.totalCost),
      ];
      vals.forEach((v, i) => {
        const cell      = ws.getCell(`${COLS[i]}${r}`);
        cell.value      = v;
        cell.fill       = rowFill;
        cell.border     = thin();
        cell.alignment  = i === 0 ? { horizontal: "left", vertical: "middle" } : { horizontal: "right", vertical: "middle" };
        if (i >= 2) cell.numFmt = "#,##0.0000";
      });
      ws.getCell(`H${r}`).border = thin();
      ws.getRow(r).height = 14;
      r++;
    });

    // Κενές γραμμές μέχρι MIN_ROWS
    for (let i = ingList.length; i < MIN_ROWS; i++) {
      COLS.forEach(c => {
        ws.getCell(`${c}${r}`).border = thin();
        ws.getCell(`${c}${r}`).fill   = i % 2 === 1 ? fill(LGRY) : fill(WHT);
      });
      ws.getRow(r).height = 14;
      r++;
    }

    // ════════════════════════════════════════════════════
    // Totals bar
    // ════════════════════════════════════════════════════
    ws.mergeCells(`A${r}:B${r}`);
    ws.getCell(`A${r}`).value     = isGr ? "ΓΡΑΜΜΑΡΙΑ / ΜΕΡΙΔΑ:" : "GRAMS / PORTION:";
    ws.getCell(`A${r}`).font      = bold(9, WHT);
    ws.getCell(`A${r}`).fill      = fill(BLU);
    ws.getCell(`A${r}`).alignment = { horizontal: "center", vertical: "middle" };
    ws.getCell(`A${r}`).border    = med();

    ws.getCell(`C${r}`).value     = Number((totalGrams / portions).toFixed(3));
    ws.getCell(`C${r}`).font      = bold(11);
    ws.getCell(`C${r}`).fill      = fill(GRN);
    ws.getCell(`C${r}`).alignment = { horizontal: "center", vertical: "middle" };
    ws.getCell(`C${r}`).border    = med();
    ws.getCell(`C${r}`).numFmt    = "#,##0.000";

    ws.getCell(`D${r}`).value     = isGr ? "ΚΟΣΤΟΣ / ΜΕΡΙΔΑ:" : "COST / PORTION:";
    ws.getCell(`D${r}`).font      = bold(9, WHT);
    ws.getCell(`D${r}`).fill      = fill(BLU);
    ws.getCell(`D${r}`).alignment = { horizontal: "center", vertical: "middle" };
    ws.getCell(`D${r}`).border    = med();

    ws.getCell(`E${r}`).value     = Number((Number(costing.rawMaterial) / portions).toFixed(4));
    ws.getCell(`E${r}`).font      = bold(11);
    ws.getCell(`E${r}`).fill      = fill(GRN);
    ws.getCell(`E${r}`).alignment = { horizontal: "center", vertical: "middle" };
    ws.getCell(`E${r}`).border    = med();
    ws.getCell(`E${r}`).numFmt    = "€#,##0.0000";

    ws.mergeCells(`F${r}:G${r}`);
    ws.getCell(`F${r}`).value     = isGr ? "ΣΥΝΟΛΙΚΑ ΓΡΑΜΜΑΡΙΑ:" : "TOTAL GRAMS:";
    ws.getCell(`F${r}`).font      = bold(9, WHT);
    ws.getCell(`F${r}`).fill      = fill(BLU);
    ws.getCell(`F${r}`).alignment = { horizontal: "center", vertical: "middle" };
    ws.getCell(`F${r}`).border    = med();

    ws.getCell(`H${r}`).value     = Number(totalGrams.toFixed(3));
    ws.getCell(`H${r}`).font      = bold(11);
    ws.getCell(`H${r}`).fill      = fill(GRN);
    ws.getCell(`H${r}`).alignment = { horizontal: "center", vertical: "middle" };
    ws.getCell(`H${r}`).border    = med();
    ws.getCell(`H${r}`).numFmt    = "#,##0.000";
    ws.getRow(r).height = 18;
    r++;
    r++; // κενό

    // ════════════════════════════════════════════════════
    // ΚΟΣΤΟΛΟΓΗΣΗ header
    // ════════════════════════════════════════════════════
    ws.mergeCells(`A${r}:H${r}`);
    ws.getCell(`A${r}`).value     = isGr ? "ΚΟΣΤΟΛΟΓΗΣΗ" : "COSTING";
    ws.getCell(`A${r}`).font      = bold(13, WHT);
    ws.getCell(`A${r}`).fill      = fill(BLU);
    ws.getCell(`A${r}`).alignment = { horizontal: "center", vertical: "middle" };
    ws.getCell(`A${r}`).border    = med();
    ws.getRow(r).height = 20;
    r++;

    // ════════════════════════════════════════════════════
    // Κοστολόγηση γραμμές
    // ════════════════════════════════════════════════════
    type CostRow = { label: string; value: number | string; highlight: boolean };
    const costLines: CostRow[] = [
      { label: isGr ? "Κόστος Υλικών (Raw Material)" : "Raw Material Cost",      value: Number(costing.rawMaterial),              highlight: false },
      { label: isGr ? "Κόστος Εργασίας (Labor)"      : "Labor Cost",             value: Number(recipe.laborCost) || 0,            highlight: false },
      { label: isGr ? "Γενικά Έξοδα (Overhead)"      : "Overhead",               value: Number(recipe.overheadCost) || 0,         highlight: false },
      { label: isGr ? "ΣΥΝΟΛΙΚΟ ΚΟΣΤΟΣ"              : "TOTAL COST",             value: Number(costing.total),                    highlight: true  },
      { label: isGr ? "Περιθώριο Κέρδους %"          : "Profit Margin %",        value: `${recipe.profitMarginPercent || 0}%`,    highlight: false },
      { label: isGr ? "Τιμή Πώλησης (χωρίς ΦΠΑ)"    : "Selling Price (ex VAT)", value: Number(costing.selling),                  highlight: false },
      { label: isGr ? "Τιμή Μενού (ΦΠΑ 24%)"        : "Menu Price (VAT 24%)",   value: Number(costing.menuVat),                  highlight: false },
      { label: isGr ? "ΤΙΜΗ ΠΩΛΗΣΗΣ ΜΕΡΙΔΑΣ"        : "SELLING PRICE / PORTION",value: perPortion,                               highlight: true  },
      { label: isGr ? "ΚΕΡΔΟΣ / ΜΕΡΙΔΑ"             : "PROFIT / PORTION",       value: profitPerPortion,                         highlight: true  },
      { label: isGr ? "ΚΟΣΤΟΣ %"                     : "COST %",                 value: `${costPct.toFixed(2)}%`,                 highlight: false },
      { label: isGr ? "ΚΕΡΔΟΣ %"                     : "PROFIT %",               value: `${profitPct.toFixed(2)}%`,               highlight: false },
    ];

    costLines.forEach(({ label, value, highlight }, idx) => {
      const rowBg = highlight ? fill(GRN) : (idx % 2 === 0 ? fill(WHT) : fill(LGRY));

      ws.mergeCells(`A${r}:F${r}`);
      const lCell   = ws.getCell(`A${r}`);
      lCell.value   = label;
      lCell.font    = highlight ? bold(10) : { size: 9 };
      lCell.fill    = rowBg;
      lCell.border  = thin();
      lCell.alignment = { horizontal: "left", vertical: "middle", indent: 1 };

      ws.mergeCells(`G${r}:H${r}`);
      const vCell   = ws.getCell(`G${r}`);
      vCell.value   = value;
      vCell.font    = highlight ? bold(11) : { size: 10 };
      vCell.fill    = highlight ? fill(GRN) : rowBg;
      vCell.border  = thin();
      vCell.alignment = { horizontal: "right", vertical: "middle" };
      if (typeof value === "number") vCell.numFmt = "€#,##0.0000";
      ws.getRow(r).height = highlight ? 17 : 14;
      r++;
    });

    r++; // κενό

    // ════════════════════════════════════════════════════
    // ΤΕΧΝΙΚΟΣ ΟΔΗΓΟΣ
    // ════════════════════════════════════════════════════
    if (recipe.technicalGuide) {
      ws.mergeCells(`A${r}:H${r}`);
      ws.getCell(`A${r}`).value     = isGr ? "ΤΕΧΝΙΚΟΣ ΟΔΗΓΟΣ / TECHNICAL GUIDE" : "TECHNICAL GUIDE";
      ws.getCell(`A${r}`).font      = bold(10);
      ws.getCell(`A${r}`).fill      = fill(YLW);
      ws.getCell(`A${r}`).alignment = { horizontal: "center", vertical: "middle" };
      ws.getCell(`A${r}`).border    = med();
      ws.getRow(r).height = 22;
      r++;

      ws.mergeCells(`A${r}:H${r}`);
      ws.getCell(`A${r}`).value     = recipe.technicalGuide;
      ws.getCell(`A${r}`).alignment = { wrapText: true, vertical: "top" };
      ws.getCell(`A${r}`).border    = thin();
      ws.getRow(r).height = 80;
      r++;
    }

    r++; // κενό

    // ════════════════════════════════════════════════════
    // Footer
    // ════════════════════════════════════════════════════
    ws.mergeCells(`A${r}:H${r}`);
    ws.getCell(`A${r}`).value     = `${isGr ? "ΗΜΕΡΟΜΗΝΙΑ ΕΚΤΥΠΩΣΕΙΣ:" : "PRINT DATE:"}  ${today}`;
    ws.getCell(`A${r}`).font      = { size: 8, color: { argb: "FF888888" } };
    ws.getCell(`A${r}`).alignment = { horizontal: "right" };

    // ════════════════════════════════════════════════════
    // Print / Page setup — fit to 1 A4 page
    // ════════════════════════════════════════════════════
    ws.pageSetup = {
      paperSize:       9,          // A4
      orientation:     "portrait",
      fitToPage:       true,
      fitToWidth:      1,          // χώρεσε σε 1 στήλη
      fitToHeight:     0,          // 0 = όσες σελίδες χρειαστεί κατακόρυφα
      horizontalCentered: true,
      margins: {
        left: 0.4, right: 0.4,
        top:  0.5, bottom: 0.5,
        header: 0.2, footer: 0.2,
      },
    };

    // Τύπωσε επικεφαλίδες στηλών σε κάθε σελίδα
    ws.pageSetup.printTitlesRow = `1:5`;

    // ════════════════════════════════════════════════════
    // Buffer + Response
    // ════════════════════════════════════════════════════
    const buffer = await wb.xlsx.writeBuffer();

    const safeName = (recipe.name as string)
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .replace(/_+/g, "_")
      .slice(0, 40) || "recipe";
    const dateStr  = new Date().toISOString().slice(0, 10);
    const filename = `${safeName}_${dateStr}.xlsx`;
    const utf8Name = encodeURIComponent(`${recipe.name as string}_${dateStr}.xlsx`);

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type":        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${utf8Name}`,
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
