"use client";
import { useState, useRef, useMemo, useEffect } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "@/lib/context";
import { PageHeader, Badge, Modal } from "@/components/shared";
import type { Recipe, OrderItem } from "@/lib/types";
import * as db from "@/lib/supabaseData";

// ─── Excel export — κάρτα συνταγής ίδια δομή με PDF (SheetJS CDN) ───────────
async function exportRecipeIngredients(
  recipe: Recipe | null,
  ingredients: DraftIngredient[],
  locale: string,
  costing: { rawMaterial: number; total: number; selling: number; menuVat: number; menuFinal: number }
) {
  if (!recipe) return;
  if (!(window as unknown as Record<string, unknown>).XLSX) {
    await new Promise<void>((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
      s.onload = () => resolve();
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const XLSX = (window as any).XLSX;

  const isGr     = locale === "gr";
  const portions = Number(recipe.portionYield) || 1;
  const allergens: string[] = Array.isArray(recipe.allergens) ? recipe.allergens as string[] :
    typeof recipe.allergens === "string" ? JSON.parse(recipe.allergens || "[]") : [];
  const totalGrams = ingredients.reduce((s, i) =>
    s + (i.unit === "ΓΡΑΜΜΑΡΙΑ" || i.unit === "GR" ? i.quantity : 0), 0);

  // Κοστολόγηση footer
  const perPortion     = costing.menuFinal;
  const profitPerPortion = perPortion - (costing.total / portions);
  const costPct        = perPortion > 0 ? (costing.total / portions / perPortion * 100) : 0;
  const profitPct      = perPortion > 0 ? (profitPerPortion / perPortion * 100) : 0;
  const today          = new Date().toLocaleDateString("el-GR");

  const wb  = XLSX.utils.book_new();
  const ws: Record<string, unknown> = {};
  let r = 0;

  const C = (col: number) => XLSX.utils.encode_cell({ c: col, r });
  const BLU = "1A5276"; // header blue
  const LBL = "D6EAF8"; // light blue για επικεφαλίδες στηλών
  const GRN = "E9F7EF";
  const YLW = "FEF9E7";

  type CellStyle = { font?: Record<string,unknown>; fill?: Record<string,unknown>; alignment?: Record<string,unknown>; border?: Record<string,unknown> };

  function wc(col: number, val: unknown, style?: CellStyle) {
    const addr = C(col);
    ws[addr] = {
      v: val,
      t: typeof val === "number" ? "n" : "s",
      s: style ?? {},
    };
  }
  const bold   = (sz=11): CellStyle => ({ font: { bold: true, sz, color: { rgb: "000000" } } });
  const hdrBlu = (sz=9): CellStyle => ({ font: { bold: true, sz, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: BLU }, patternType: "solid" } });
  const hdrLbl = (sz=9): CellStyle => ({ font: { bold: true, sz }, fill: { fgColor: { rgb: LBL }, patternType: "solid" } });
  const grn    = (sz=9): CellStyle => ({ font: { bold: true, sz }, fill: { fgColor: { rgb: GRN }, patternType: "solid" } });
  const ylw    = (sz=9): CellStyle => ({ font: { bold: true, sz }, fill: { fgColor: { rgb: YLW }, patternType: "solid" } });
  const right  = (): CellStyle => ({ alignment: { horizontal: "right" } });
  const merge  = (s: {r:number;c:number}, e: {r:number;c:number}) => ({ s, e });

  const merges: {s:{r:number;c:number};e:{r:number;c:number}}[] = [];

  // ── ROW 0: Τίτλος "RECIPE BUILDER" ──
  wc(0, "RECIPE BUILDER", hdrBlu(14));
  wc(1, ""); wc(2, ""); wc(3, ""); wc(4, ""); wc(5, ""); wc(6, "");
  wc(7, isGr ? "ΚΑΡΤΑ ΣΥΝΤΑΓΗΣ" : "RECIPE CARD", hdrBlu(10));
  merges.push(merge({r,c:0},{r,c:6}));
  merges.push(merge({r,c:7},{r,c:9}));
  r++;

  // ── ROW 1: Ετικέτα ονόματος ──
  wc(0, isGr ? "ΟΝΟΜΑ ΣΥΝΤΑΓΗΣ:" : "RECIPE NAME:", bold());
  wc(1, recipe.name.toUpperCase(), { font: { bold: true, sz: 13 } });
  merges.push(merge({r,c:1},{r,c:7}));
  wc(8, isGr ? "ΜΕΡΙΔΕΣ:" : "PORTIONS:", bold(9));
  wc(9, recipe.portionYield, { font: { bold: true, sz: 12 } });
  r++;

  // ── ROW 2: Ονομασία EN + αλλεργίες ──
  wc(0, isGr ? "ΟΝΟΜΑΣΙΑ (EN):" : "NAME (EN):", {});
  wc(1, recipe.nameEn ?? "", {});
  merges.push(merge({r,c:1},{r,c:5}));
  wc(6, isGr ? "ΑΛΛΕΡΓΙΕΣ:" : "ALLERGENS:", bold(9));
  wc(7, allergens.join(", ") || "—", {});
  merges.push(merge({r,c:7},{r,c:9}));
  r++;
  r++; // κενό

  // ── ROW 4+: Επικεφαλίδα πίνακα υλικών ──
  const ING_COLS = [
    isGr ? "ΥΛΙΚΟ" : "INGREDIENT",         // col 0 — wide
    isGr ? "ΜΟΝΑΔΕΣ" : "UNITS",            // col 1
    isGr ? "ΤΙΜΗ/ΜΟΝΑΔΑ €" : "PRICE/UNIT €", // col 2
    isGr ? "ΠΟΣΟΤΗΤΑ/ΜΕΡΙΔΑ" : "QTY/PORTION", // col 3
    isGr ? "ΣΥΝΟΛΙΚΗ ΠΟΣΟΤΗΤΑ" : "TOTAL QTY",  // col 4
    isGr ? "ΚΟΣΤΟΣ ΥΛΙΚΩΝ/ΜΕΡΙΔΑ €" : "COST/PORTION €", // col 5
    isGr ? "ΚΟΣΤΟΣ ΣΥΝΟΛΟ €" : "TOTAL COST €",           // col 6
  ];
  ING_COLS.forEach((h, c) => wc(c, h, hdrLbl(9)));
  r++;

  // ── Γραμμές υλικών (min 20) ──
  const MIN_ROWS = 20;
  ingredients.forEach((ing) => {
    wc(0, ing.productName.toUpperCase(), {});
    wc(1, ing.unit.toUpperCase(), {});
    wc(2, Number(ing.unitCost), right());
    wc(3, Number((ing.quantity / portions).toFixed(6)), right());
    wc(4, Number(ing.quantity), right());
    wc(5, Number((ing.totalCost / portions).toFixed(6)), right());
    wc(6, Number(ing.totalCost), right());
    r++;
  });
  for (let i = ingredients.length; i < MIN_ROWS; i++) {
    wc(0, ""); wc(1, ""); wc(2, ""); wc(3, ""); wc(4, ""); wc(5, ""); wc(6, "");
    r++;
  }

  // ── Γραμμή συνόλων (τύπου "totals bar") ──
  wc(0, isGr ? "ΓΡΑΜΜΑΡΙΑ/ΜΕΡΙΔΑ:" : "GRAMS/PORTION:", grn(9));
  wc(1, Number((totalGrams / portions).toFixed(3)), grn(9));
  wc(2, "");
  wc(3, isGr ? "ΚΟΣΤΟΣ/ΜΕΡΙΔΑ:" : "COST/PORTION:", grn(9));
  wc(4, Number((costing.rawMaterial / portions).toFixed(4)), grn(9));
  wc(5, isGr ? "ΣΥΝΟΛΙΚΑ ΓΡΑΜΜΑΡΙΑ:" : "TOTAL GRAMS:", grn(9));
  wc(6, Number(totalGrams.toFixed(3)), grn(9));
  r++;
  r++;

  // ── ΚΟΣΤΟΛΟΓΗΣΗ — επικεφαλίδα ──
  wc(0, isGr ? "ΚΟΣΤΟΛΟΓΗΣΗ" : "COSTING", hdrBlu(10));
  wc(1, ""); wc(2, ""); wc(3, ""); wc(4, ""); wc(5, ""); wc(6, "");
  merges.push(merge({r,c:0},{r,c:6}));
  r++;

  const costLines: [string, unknown][] = [
    [isGr ? "Κόστος Υλικών (Raw Material)" : "Raw Material Cost",  costing.rawMaterial],
    [isGr ? "Κόστος Εργασίας (Labor)"      : "Labor Cost",         Number(recipe.laborCost)],
    [isGr ? "Γενικά Έξοδα (Overhead)"      : "Overhead",           Number(recipe.overheadCost)],
    [isGr ? "ΣΥΝΟΛΙΚΟ ΚΟΣΤΟΣ"              : "TOTAL COST",         costing.total],
    [isGr ? "Περιθώριο Κέρδους %"          : "Profit Margin %",    Number(recipe.profitMarginPercent)],
    [isGr ? "Τιμή Πώλησης (χωρίς ΦΠΑ)"    : "Selling Price (ex VAT)", costing.selling],
    [isGr ? "Τιμή Μενού (ΦΠΑ 24%)"        : "Menu Price (VAT 24%)", costing.menuVat],
    [isGr ? "ΤΙΜΗ ΠΩΛΗΣΗΣ ΜΕΡΙΔΑΣ"        : "SELLING PRICE/PORTION", perPortion],
    [isGr ? "ΚΕΡΔΟΣ/ΜΕΡΙΔΑ"               : "PROFIT/PORTION",     profitPerPortion],
    [isGr ? "ΚΟΣΤΟΣ %"                     : "COST %",             costPct],
    [isGr ? "ΚΕΡΔΟΣ %"                     : "PROFIT %",           profitPct],
  ];
  costLines.forEach(([label, val]) => {
    const isTotal = (label as string).startsWith(isGr ? "ΣΥΝΟΛ" : "TOTAL") ||
                    (label as string).startsWith(isGr ? "ΤΙΜΗ ΠΩΛΗ" : "SELLING") ||
                    (label as string).startsWith(isGr ? "ΚΕΡΔΟΣ/Μ" : "PROFIT/P");
    const st = isTotal ? bold(10) : {};
    wc(0, label, st);
    merges.push(merge({r,c:0},{r,c:4}));
    wc(5, "");
    wc(6, val, { ...st, ...right() });
    r++;
  });
  r++;

  // ── ΤΕΧΝΙΚΟΣ ΟΔΗΓΟΣ ──
  if (recipe.technicalGuide) {
    wc(0, isGr ? "ΤΕΧΝΙΚΟΣ ΟΔΗΓΟΣ / TECHNICAL GUIDE" : "TECHNICAL GUIDE", ylw(10));
    merges.push(merge({r,c:0},{r,c:6}));
    r++;
    wc(0, recipe.technicalGuide, { alignment: { wrapText: true } });
    merges.push(merge({r,c:0},{r,c:6}));
    r++;
  }
  r++;

  // ── Footer ──
  wc(0, isGr ? "ΗΜΕΡΟΜΗΝΙΑ ΕΚΤΥΠΩΣΕΙΣ:" : "PRINT DATE:", bold(9));
  wc(1, today, bold(9));
  r++;

  // Ορισμός εύρους + πλάτη στηλών
  ws["!ref"]   = XLSX.utils.encode_range({ s: { c: 0, r: 0 }, e: { c: 9, r: r } });
  ws["!cols"]  = [
    { wch: 38 }, // 0 Υλικό
    { wch: 12 }, // 1 Μονάδες
    { wch: 14 }, // 2 Τιμή/μον
    { wch: 14 }, // 3 Ποσ/μερίδα
    { wch: 14 }, // 4 Συνολική ποσ
    { wch: 20 }, // 5 Κόστος/μερίδα
    { wch: 16 }, // 6 Κόστος σύνολο
    { wch: 14 }, // 7
    { wch: 14 }, // 8
    { wch: 10 }, // 9
  ];
  ws["!merges"] = merges;

  XLSX.utils.book_append_sheet(wb, ws, isGr ? "Συνταγή" : "Recipe");

  const safeName = recipe.name.replace(/[^a-zA-Z0-9Ͱ-Ͽ_-]/g, "_").slice(0, 40);
  XLSX.writeFile(wb, `${safeName}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ─── PDF export — κάρτα συνταγής τύπου Recipe Builder ────────────────────────
function printRecipePDF(recipe: Recipe, ingredients: DraftIngredient[], locale: string) {
  const allergens: string[] = Array.isArray(recipe.allergens) ? recipe.allergens as string[] :
    typeof recipe.allergens === "string" ? JSON.parse(recipe.allergens || "[]") : [];

  const totalRaw   = ingredients.reduce((s, i) => s + i.totalCost, 0);
  const labor      = Number(recipe.laborCost);
  const overhead   = Number(recipe.overheadCost);
  const total      = totalRaw + labor + overhead;
  const margin     = Number(recipe.profitMarginPercent);
  const selling    = margin < 100 ? total / (1 - margin / 100) : total;
  const menuVat    = selling * 1.24;
  const portions   = Number(recipe.portionYield) || 1;
  const perPortion = menuVat / portions;
  const profitPerPortion = perPortion - (total / portions);
  const costPct    = perPortion > 0 ? (total / portions / perPortion * 100) : 0;
  const profitPct  = perPortion > 0 ? (profitPerPortion / perPortion * 100) : 0;

  // Εκτιμώμενες θερμίδες/μερίδα (αν θέλουμε placeholder = 0)
  const totalGrams = ingredients.reduce((s, i) => s + (i.unit === "ΓΡΑΜΜΑΡΙΑ" || i.unit === "GR" ? i.quantity : 0), 0);
  const gramsPerPortion = totalGrams / portions;

  // Γραμμές υλικών — 20 γραμμές min (με κενά)
  const MIN_ROWS = 20;
  const ingRows: string[] = ingredients.map((ing) => `
    <tr>
      <td class="td-name">${ing.productName.toUpperCase()}</td>
      <td class="td-unit">${ing.unit.toUpperCase()}</td>
      <td class="td-num">${ing.unitCost.toFixed(2)} €</td>
      <td class="td-num">${(ing.quantity / portions).toFixed(3)}</td>
      <td class="td-num">${ing.quantity.toFixed(3)}</td>
      <td class="td-num">${(ing.totalCost / portions).toFixed(6)} €</td>
    </tr>`);
  for (let i = ingRows.length; i < MIN_ROWS; i++) {
    ingRows.push(`<tr><td class="td-name">&nbsp;</td><td class="td-unit"></td><td class="td-num"></td><td class="td-num"></td><td class="td-num"></td><td class="td-num"></td></tr>`);
  }

  const today = new Date().toLocaleDateString("el-GR");
  const isGr  = locale === "gr";

  const html = `<!DOCTYPE html>
<html lang="el">
<head>
<meta charset="UTF-8">
<title>${recipe.name}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 9px; color: #111; background:#fff; }
  .page { width:210mm; min-height:297mm; margin:0 auto; padding:6mm 8mm; }

  /* HEADER */
  .hdr { background:#1a5276; color:#fff; display:flex; align-items:center;
         justify-content:space-between; padding:5px 10px; margin-bottom:4px; }
  .hdr-left  { font-size:16px; font-weight:900; font-style:italic; letter-spacing:1px; }
  .hdr-right { font-size:10px; font-weight:bold; }

  /* Όνομα συνταγής */
  .recipe-name-row { text-align:center; font-size:13px; font-weight:bold;
    text-transform:uppercase; padding:4px 0; border:1px solid #aaa;
    border-top:none; background:#f4f6f8; }
  .recipe-name-label { font-size:7px; color:#555; text-align:center;
    border:1px solid #aaa; border-top:none; border-bottom:none; padding:1px 0; }

  /* Πίνακας υλικών */
  .ing-table { width:100%; border-collapse:collapse; margin-top:0; }
  .ing-table th { background:#1a5276; color:#fff; font-size:8px; font-weight:bold;
    text-align:center; padding:3px 4px; border:1px solid #1a5276; }
  .ing-table th.th-portions { background:#1a5276; color:#fff; font-size:9px;
    font-weight:bold; text-align:center; border:1px solid #1a5276; padding:3px 4px; }
  .ing-table td { border:1px solid #ccc; padding:2px 4px; font-size:8px; }
  .td-name { text-align:left; }
  .td-unit { text-align:center; background:#f8f8f8; }
  .td-num  { text-align:right; }
  tr:nth-child(even) td { background:#f4f7fb; }

  /* Totals bar */
  .totals-bar { display:flex; border:1px solid #aaa; border-top:2px solid #1a5276;
    margin-top:0; }
  .totals-bar .tbox { flex:1; padding:4px 6px; text-align:center;
    border-right:1px solid #ccc; }
  .totals-bar .tbox:last-child { border-right:none; }
  .tbox .tlabel { font-size:7px; font-weight:bold; text-transform:uppercase; color:#333; }
  .tbox .tvalue { font-size:11px; font-weight:bold; margin-top:1px; }
  .tbox-blue { background:#1a5276; color:#fff; }
  .tbox-blue .tlabel { color:#cde; }

  /* Φωτογραφίες + Τεχνικά βήματα */
  .bottom-section { display:flex; gap:4px; margin-top:4px; border:1px solid #aaa; }
  .photos-col { width:30mm; display:flex; flex-direction:column; gap:2px; padding:4px;
    border-right:1px solid #ccc; }
  .photos-col .photo-label { font-size:7px; font-weight:bold; text-transform:uppercase;
    text-align:center; background:#1a5276; color:#fff; padding:2px; margin-bottom:2px; }
  .photo-box { border:1px solid #ccc; height:22mm; background:#f8f8f8; }
  .steps-col { flex:1; padding:4px; }
  .steps-col .steps-label { font-size:7px; font-weight:bold; text-transform:uppercase;
    text-align:center; background:#1a5276; color:#fff; padding:2px; margin-bottom:4px; }
  .steps-content { font-size:8px; line-height:1.6; white-space:pre-wrap;
    min-height:60mm; }

  /* Footer */
  .footer-bar { display:flex; border:1px solid #aaa; border-top:2px solid #1a5276;
    margin-top:4px; align-items:stretch; }
  .footer-date { width:40mm; padding:4px 6px; font-size:8px; font-weight:bold;
    border-right:1px solid #ccc; display:flex; flex-direction:column;
    justify-content:center; }
  .footer-date .date-label { font-size:7px; color:#555; text-transform:uppercase; }
  .footer-kpis { flex:1; display:flex; }
  .kpi { flex:1; padding:3px 6px; text-align:right; border-right:1px solid #ccc; }
  .kpi:last-child { border-right:none; }
  .kpi .kpi-label { font-size:7px; color:#333; text-transform:uppercase; font-weight:bold; }
  .kpi .kpi-value { font-size:9px; font-weight:bold; }

  /* Allergens */
  .allergen-row { font-size:7px; color:#7b1c1c; background:#fff0f0;
    padding:2px 6px; border:1px solid #ecc; border-top:none; }

  @media print {
    @page { margin:0; size:A4; }
    .page { padding:6mm 8mm; }
    body { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  }
</style>
</head>
<body>
<div class="page">

  <!-- HEADER -->
  <div class="hdr">
    <div class="hdr-left">RECIPE BUILDER</div>
    <div class="hdr-right">WWW.YANNISSTANITSAS.COM</div>
  </div>

  <!-- Ετικέτα ονόματος -->
  <div class="recipe-name-label">${isGr ? "ΟΝΟΜΑ ΣΥΝΤΑΓΗΣ:" : "RECIPE NAME:"}</div>
  <div class="recipe-name-row">${recipe.name.toUpperCase()}${recipe.nameEn ? ` (${recipe.nameEn.toUpperCase()})` : ""}</div>

  <!-- Πίνακας υλικών -->
  <table class="ing-table">
    <thead>
      <tr>
        <th class="th-portions" colspan="1" style="width:35%">&nbsp;</th>
        <th class="th-portions" style="background:#154360;width:9%">${isGr ? "ΜΕΡΙΔΕΣ" : "PORTIONS"}</th>
        <th style="background:#154360;font-size:12px;font-weight:900;width:5%">${recipe.portionYield}</th>
        <th style="width:12%">${isGr ? "ΜΟΝΑΔΕΣ" : "UNITS"}</th>
        <th style="width:13%">${isGr ? "ΤΙΜΗ/ΜΟΝΑΔΑ" : "PRICE/UNIT"}</th>
        <th style="width:13%">${isGr ? "ΠΟΣΟΤΗΤΑ / ΜΕΡΙΔΑ" : "QTY / PORTION"}</th>
        <th style="width:13%">${isGr ? "ΣΥΝΟΛΙΚΗ ΠΟΣΟΤΗΤΑ" : "TOTAL QTY"}</th>
        <th style="width:13%">${isGr ? "ΚΟΣΤΟΣ ΥΛΙΚΩΝ / ΜΕΡΙΔΑ" : "COST / PORTION"}</th>
      </tr>
    </thead>
    <tbody>
      ${ingredients.map((ing) => `
      <tr>
        <td class="td-name" colspan="1">${ing.productName.toUpperCase()}</td>
        <td></td>
        <td></td>
        <td class="td-unit">${ing.unit.toUpperCase()}</td>
        <td class="td-num">${ing.unitCost.toFixed(2)} €</td>
        <td class="td-num">${(ing.quantity / portions).toFixed(3)}</td>
        <td class="td-num">${ing.quantity.toFixed(3)}</td>
        <td class="td-num">${(ing.totalCost / portions).toFixed(6)} €</td>
      </tr>`).join("")}
      ${Array.from({length: Math.max(0, MIN_ROWS - ingredients.length)}).map(() => `
      <tr>
        <td colspan="1">&nbsp;</td><td></td><td></td>
        <td></td><td></td><td></td><td></td><td></td>
      </tr>`).join("")}
    </tbody>
  </table>

  ${allergens.length > 0 ? `<div class="allergen-row">⚠️ ${isGr ? "Αλλεργίες" : "Allergens"}: ${allergens.join(", ")}</div>` : ""}

  <!-- Totals -->
  <div class="totals-bar">
    <div class="tbox tbox-blue">
      <div class="tlabel">${isGr ? "ΘΕΡΜΙΔΕΣ / ΜΕΡΙΔΑ:" : "KCAL / PORTION:"}</div>
      <div class="tvalue">—</div>
    </div>
    <div class="tbox" style="flex:2">
      <div class="tlabel">&nbsp;</div>
    </div>
    <div class="tbox tbox-blue">
      <div class="tlabel">${isGr ? "ΚΟΣΤΟΣ / ΜΕΡΙΔΑ:" : "COST / PORTION:"}</div>
      <div class="tvalue">${(totalRaw / portions).toFixed(2)} €</div>
    </div>
    <div class="tbox">
      <div class="tlabel">${isGr ? "ΓΡΑΜΜΑΡΙΑ / ΜΕΡΙΔΑ:" : "GRAMS / PORTION:"}</div>
      <div class="tvalue">${gramsPerPortion.toFixed(3)}</div>
    </div>
    <div class="tbox" style="flex:2">
      <div class="tlabel">&nbsp;</div>
    </div>
    <div class="tbox tbox-blue">
      <div class="tlabel">${isGr ? "ΣΥΝΟΛΙΚΑ ΓΡΑΜΜΑΡΙΑ:" : "TOTAL GRAMS:"}</div>
      <div class="tvalue">${totalGrams.toFixed(3)}</div>
    </div>
  </div>

  <!-- Φωτογραφίες + Τεχνικά βήματα -->
  <div class="bottom-section">
    <div class="photos-col">
      <div class="photo-label">${isGr ? "ΦΩΤΟΓΡΑΦΙΕΣ" : "PHOTOS"}</div>
      <div class="photo-box"></div>
      <div class="photo-box"></div>
      <div class="photo-box"></div>
    </div>
    <div class="steps-col">
      <div class="steps-label">${isGr ? "ΤΕΧΝΙΚΑ ΒΗΜΑΤΑ ΣΥΝΤΑΓΗΣ" : "RECIPE TECHNICAL STEPS"}</div>
      <div class="steps-content">${(recipe.technicalGuide ?? "").replace(/</g,"&lt;")}</div>
    </div>
  </div>

  <!-- Thumbnails row (κενό placeholder) -->
  <div style="display:flex;gap:2px;margin-top:4px;border:1px solid #aaa;padding:4px;">
    ${Array.from({length:8}).map(() => `<div style="flex:1;height:14mm;border:1px solid #ccc;background:#f8f8f8;"></div>`).join("")}
  </div>

  <!-- Footer -->
  <div class="footer-bar">
    <div class="footer-date">
      <div class="date-label">${isGr ? "ΗΜΕΡΟΜΗΝΙΑ ΕΚΤΥΠΩΣΕΙΣ" : "PRINT DATE"}</div>
      <div style="font-size:10px;font-weight:bold;margin-top:2px;">${today}</div>
    </div>
    <div class="footer-kpis">
      <div class="kpi">
        <div class="kpi-label">${isGr ? "ΤΙΜΗ ΠΩΛΗΣΗΣ ΜΕΡΙΔΑΣ" : "SELLING PRICE/PORTION"}</div>
        <div class="kpi-value">${perPortion.toFixed(2)} €</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">${isGr ? "ΚΕΡΔΟΣ/ΜΕΡΙΔΑ" : "PROFIT/PORTION"}</div>
        <div class="kpi-value">${profitPerPortion.toFixed(2)} €</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">${isGr ? "ΚΟΣΤΟΣ %" : "COST %"}</div>
        <div class="kpi-value">${costPct.toFixed(2)}%</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">${isGr ? "ΚΕΡΔΟΣ %" : "PROFIT %"}</div>
        <div class="kpi-value">${profitPct.toFixed(2)}%</div>
      </div>
    </div>
  </div>

</div>
<script>window.onload = () => window.print();</script>
</body></html>`;

  const win = window.open("", "_blank");
  if (win) { win.document.write(html); win.document.close(); }
}

const ALLERGEN_LIST = [
  "gluten","dairy","eggs","fish","shellfish","nuts",
  "peanuts","soy","sesame","celery","mustard","lupin","molluscs","sulphites",
];

// ─── Τύποι ────────────────────────────────────────────────────────────────────

interface DraftIngredient {
  /** Μοναδικό key μόνο για το UI (δεν αποθηκεύεται) */
  _key: string;
  productName: string;
  unit: string;
  unitCost: number;
  supplierName: string | null;
  quantity: number;
  totalCost: number;
}

interface RecipeFormState {
  name: string;
  nameEn: string;
  portionYield: string;
  portionUnit: string;
  allergens: string[];
  technicalGuide: string;
  laborCost: string;
  overheadCost: string;
  profitMarginPercent: string;
}

// ─── Βοηθητικά ────────────────────────────────────────────────────────────────

function calcCosting(items: DraftIngredient[], laborCost: number, overheadCost: number, margin: number, portions: number) {
  const rawMaterial = items.reduce((s, i) => s + i.totalCost, 0);
  const total = rawMaterial + laborCost + overheadCost;
  const selling = margin < 100 ? total / (1 - margin / 100) : total;
  const menuVat = selling * 1.24;
  const menuFinal = portions > 0 ? menuVat / portions : menuVat;
  return { rawMaterial, total, selling, menuVat, menuFinal };
}

const EMPTY_FORM: RecipeFormState = {
  name: "", nameEn: "", portionYield: "1", portionUnit: "pcs",
  allergens: [], technicalGuide: "",
  laborCost: "0", overheadCost: "0", profitMarginPercent: "60",
};

// ─── Κύριο Component ──────────────────────────────────────────────────────────

export default function RecipePage() {
  const { t, locale, data, refreshAll } = useLanguage();
  const recipes = data.recipes;

  // Views
  const [view, setView] = useState<"list" | "form">("list");
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null);

  // Form state
  const [form, setForm] = useState<RecipeFormState>(EMPTY_FORM);

  // Υλικά: draft λίστα (live στο form, αποθηκεύεται μαζί με τη συνταγή)
  const [draftItems, setDraftItems] = useState<DraftIngredient[]>([]);

  // Αναζήτηση υλικών από order_items
  const [ingSearch, setIngSearch] = useState("");
  const [ingResults, setIngResults] = useState<OrderItem[]>([]);
  const [ingLoading, setIngLoading] = useState(false);
  const [showIngDropdown, setShowIngDropdown] = useState(false);
  const [dropdownRect, setDropdownRect] = useState<DOMRect | null>(null);
  const ingSearchRef = useRef<HTMLDivElement>(null);
  const ingInputRef = useRef<HTMLInputElement>(null);
  const ingDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Saving
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // Search modal
  const [showSearch, setShowSearch] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  // ─── Κλείσιμο dropdown με κλικ έξω ─────────────────────────────────────────

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ingSearchRef.current && !ingSearchRef.current.contains(e.target as Node)) {
        setShowIngDropdown(false);
      }
    }
    // Ανανέωση θέσης dropdown κατά scroll/resize
    function updateRect() {
      if (ingInputRef.current && showIngDropdown) {
        setDropdownRect(ingInputRef.current.getBoundingClientRect());
      }
    }
    document.addEventListener("mousedown", handle);
    window.addEventListener("scroll", updateRect, true);
    window.addEventListener("resize", updateRect);
    return () => {
      document.removeEventListener("mousedown", handle);
      window.removeEventListener("scroll", updateRect, true);
      window.removeEventListener("resize", updateRect);
    };
  }, [showIngDropdown]);

  // ─── Αναζήτηση υλικών από order_items (με debounce) ─────────────────────────

  function openDropdown() {
    if (ingInputRef.current) setDropdownRect(ingInputRef.current.getBoundingClientRect());
    setShowIngDropdown(true);
  }

  function handleIngSearchChange(val: string) {
    setIngSearch(val);
    if (val.trim()) openDropdown();
    else setShowIngDropdown(false);
    if (ingDebounce.current) clearTimeout(ingDebounce.current);
    if (!val.trim()) { setIngResults([]); return; }
    // Server-side ILIKE — δεν φορτώνουμε ολόκληρο τον πίνακα
    ingDebounce.current = setTimeout(async () => {
      setIngLoading(true);
      try {
        const results = await db.searchOrderItemsByName(val);
        setIngResults(results);
      } catch {
        setIngResults([]);
      } finally {
        setIngLoading(false);
      }
    }, 300);
  }

  // ─── Προσθήκη υλικού από order_items στη draft λίστα ────────────────────────

  function addIngredientFromOrderItem(item: OrderItem) {
    const key = crypto.randomUUID();
    const unitCost = Number(item.basePrice ?? 0);
    setDraftItems((prev) => [
      ...prev,
      {
        _key: key,
        productName: item.productName,
        unit: item.unit,
        unitCost,
        supplierName: item.supplierName ?? null,
        quantity: 0,
        totalCost: 0,
      },
    ]);
    setIngSearch("");
    setShowIngDropdown(false);
    setIngResults([]);
  }

  // ─── Ενημέρωση γραμμής υλικού ───────────────────────────────────────────────

  function updateDraftItem(key: string, field: "quantity" | "unitCost", val: number) {
    setDraftItems((prev) =>
      prev.map((item) => {
        if (item._key !== key) return item;
        const q = field === "quantity" ? val : item.quantity;
        const c = field === "unitCost" ? val : item.unitCost;
        return { ...item, [field]: val, totalCost: parseFloat((q * c).toFixed(4)) };
      })
    );
  }

  function removeDraftItem(key: string) {
    setDraftItems((prev) => prev.filter((i) => i._key !== key));
  }

  // ─── Costing (υπολογίζεται live) ────────────────────────────────────────────

  const costing = useMemo(() =>
    calcCosting(
      draftItems,
      Number(form.laborCost),
      Number(form.overheadCost),
      Number(form.profitMarginPercent),
      Number(form.portionYield) || 1,
    ),
    [draftItems, form.laborCost, form.overheadCost, form.profitMarginPercent, form.portionYield]
  );

  // ─── Νέα συνταγή ─────────────────────────────────────────────────────────────

  function newRecipe() {
    setSelectedRecipe(null);
    setForm(EMPTY_FORM);
    setDraftItems([]);
    setView("form");
  }

  // ─── Φόρτωση υπάρχουσας συνταγής ─────────────────────────────────────────────

  function loadRecipe(r: Recipe) {
    setSelectedRecipe(r);
    setForm({
      name: r.name,
      nameEn: r.nameEn || "",
      portionYield: r.portionYield,
      portionUnit: r.portionUnit,
      allergens: typeof r.allergens === "string" ? JSON.parse(r.allergens || "[]") : (r.allergens || []) as string[],
      technicalGuide: r.technicalGuide || "",
      laborCost: r.laborCost,
      overheadCost: r.overheadCost,
      profitMarginPercent: r.profitMarginPercent,
    });
    // Φόρτωσε τα υπάρχοντα υλικά ως draft items
    setDraftItems(
      (r.ingredients || []).map((ing) => ({
        _key: crypto.randomUUID(),
        productName: ing.ingredientName,
        unit: ing.unit,
        unitCost: Number(ing.unitCost),
        supplierName: null,
        quantity: Number(ing.quantity),
        totalCost: Number(ing.totalCost),
      }))
    );
    setView("form");
  }

  // ─── Αποθήκευση συνταγής + υλικών ────────────────────────────────────────────

  async function saveRecipe() {
    if (!form.name.trim()) {
      alert(locale === "gr" ? "Συμπλήρωσε το όνομα συνταγής." : "Please fill in the recipe name.");
      return;
    }
    setSaving(true);
    try {
      const details = {
        name: form.name.trim(),
        nameEn: form.nameEn.trim() || null,
        portionYield: form.portionYield,
        portionUnit: form.portionUnit,
        allergens: JSON.stringify(form.allergens),
        technicalGuide: form.technicalGuide || null,
        totalRawMaterialCost: costing.rawMaterial.toFixed(2),
        laborCost: form.laborCost,
        overheadCost: form.overheadCost,
        totalCost: costing.total.toFixed(2),
        profitMarginPercent: form.profitMarginPercent,
        sellingPrice: costing.selling.toFixed(2),
        menuPriceVat: costing.menuVat.toFixed(2),
        menuPriceFinal: costing.menuFinal.toFixed(2),
        isActive: true,
      };

      let recipeId: number;
      if (selectedRecipe?.id) {
        await db.updateRecipeDetails(selectedRecipe.id, details);
        recipeId = selectedRecipe.id;
        // Διέγραψε παλιά υλικά και ξαναγράψε
        for (const old of selectedRecipe.ingredients || []) {
          if (old.id) await db.deleteRecipeIngredient(old.id).catch(() => {});
        }
      } else {
        recipeId = await db.createRecipeDetails(details);
      }

      // Αποθήκευσε τα draft υλικά ως recipe_ingredients
      for (const item of draftItems) {
        await db.addRecipeIngredient(recipeId, {
          ingredientId: 0, // δεν απαιτείται ingredient_id — χρησιμοποιούμε productName
          ingredientName: item.productName,
          quantity: item.quantity,
          unit: item.unit,
          unitCost: item.unitCost,
          totalCost: item.totalCost,
          wastageFactor: 1,
          requiresPrep: false,
          prepNotes: "",
        });
      }

      await refreshAll();
      setView("list");
      setSelectedRecipe(null);
    } catch (err) {
      alert((locale === "gr" ? "Αποτυχία αποθήκευσης: " : "Failed to save: ") + String(err));
    } finally {
      setSaving(false);
    }
  }

  // ─── Διαγραφή συνταγής ───────────────────────────────────────────────────────

  async function deleteRecipe(id: number) {
    if (!confirm(locale === "gr" ? "Διαγραφή συνταγής;" : "Delete recipe?")) return;
    setDeletingId(id);
    try {
      await db.deleteRecipe(id);
      await refreshAll();
      if (selectedRecipe?.id === id) { setSelectedRecipe(null); setView("list"); }
    } catch (err) {
      alert((locale === "gr" ? "Αποτυχία διαγραφής: " : "Failed to delete: ") + String(err));
    } finally {
      setDeletingId(null);
    }
  }

  // ─── Filtered search ──────────────────────────────────────────────────────────

  const filteredRecipes = useMemo(() => {
    if (!searchTerm.trim()) return recipes;
    const q = searchTerm.trim().toLowerCase();
    return recipes.filter((r) =>
      r?.name?.toLowerCase().includes(q) || (r?.nameEn && r.nameEn.toLowerCase().includes(q))
    );
  }, [recipes, searchTerm]);

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div>
      <PageHeader
        title={locale === "gr" ? "Συνταγές" : "Recipes"}
        subtitle={locale === "gr" ? "Δημιουργία & Διαχείριση Συνταγών" : "Create & Manage Recipes"}
      >
        {view === "list" ? (
          <>
            <button onClick={() => setShowSearch(true)} className="erp-btn-secondary">
              🔍 {locale === "gr" ? "Αναζήτηση" : "Search"}
            </button>
            <button onClick={newRecipe} className="erp-btn-primary">
              ➕ {locale === "gr" ? "Νέα Συνταγή" : "New Recipe"}
            </button>
          </>
        ) : (
          <>
            <button onClick={() => setView("list")} className="erp-btn-ghost">
              ← {locale === "gr" ? "Πίσω" : "Back"}
            </button>
            {selectedRecipe && (
              <>
                <button
                  onClick={() => exportRecipeIngredients(selectedRecipe, draftItems, locale, costing)}
                  className="erp-btn-secondary"
                >
                  📊 Excel
                </button>
                <button
                  onClick={() => printRecipePDF(selectedRecipe, draftItems, locale)}
                  className="erp-btn-secondary"
                >
                  🖨️ PDF
                </button>
              </>
            )}
            <button onClick={saveRecipe} disabled={saving} className="erp-btn-success">
              {saving ? "…" : "💾"} {locale === "gr" ? "Αποθήκευση" : "Save"}
            </button>
          </>
        )}
      </PageHeader>

      {/* ── LIST VIEW ─────────────────────────────────────────────────────── */}
      {view === "list" && (
        <div className="erp-card">
          <div className="erp-card-header">
            <h3 className="font-semibold">
              📋 {locale === "gr" ? "Αρχείο Συνταγών" : "Recipe Archive"} — {recipes.length}
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="erp-table">
              <thead>
                <tr>
                  <th>{locale === "gr" ? "Όνομα" : "Name"}</th>
                  <th>{locale === "gr" ? "Κόστος Υλικών" : "Ingredient Cost"}</th>
                  <th>{locale === "gr" ? "Τιμή Πώλησης" : "Selling Price"}</th>
                  <th>{locale === "gr" ? "Μερίδες" : "Portions"}</th>
                  <th>{locale === "gr" ? "Περιθώριο" : "Margin"}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {recipes.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-10 text-slate-400">
                      {locale === "gr" ? "Δεν υπάρχουν συνταγές" : "No recipes yet"}
                    </td>
                  </tr>
                ) : recipes.map((r, idx) => (
                  <tr key={r?.id ?? idx}>
                    <td
                      className="cursor-pointer hover:text-blue-600 font-medium"
                      onClick={() => loadRecipe(r)}
                    >
                      {r?.name ?? "—"}
                      {r?.nameEn && (
                        <div className="text-xs text-slate-400 font-normal">{r.nameEn}</div>
                      )}
                    </td>
                    <td>€{Number(r?.totalRawMaterialCost ?? 0).toFixed(2)}</td>
                    <td className="font-semibold text-emerald-700">
                      €{Number(r?.sellingPrice ?? 0).toFixed(2)}
                    </td>
                    <td>{r?.portionYield} {r?.portionUnit}</td>
                    <td><Badge color="amber">{r?.profitMarginPercent}%</Badge></td>
                    <td>
                      <button
                        onClick={(e) => { e.stopPropagation(); r?.id && deleteRecipe(r.id); }}
                        disabled={deletingId === r?.id}
                        className="text-red-400 hover:text-red-600 text-xs"
                      >
                        {deletingId === r?.id ? "…" : locale === "gr" ? "Διαγραφή" : "Delete"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── FORM VIEW ─────────────────────────────────────────────────────── */}
      {view === "form" && (
        <div className="space-y-6">

          {/* Στοιχεία Συνταγής */}
          <div className="erp-card">
            <div className="erp-card-header">
              <h3 className="font-semibold">👨‍🍳 {locale === "gr" ? "Στοιχεία Συνταγής" : "Recipe Details"}</h3>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="erp-label">{locale === "gr" ? "Ονομασία (ΕΛ)" : "Name (GR)"}</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="erp-input"
                    placeholder={locale === "gr" ? "π.χ. Κοτόπουλο σχάρας" : "e.g. Grilled chicken"}
                  />
                </div>
                <div>
                  <label className="erp-label">Name (EN)</label>
                  <input
                    type="text"
                    value={form.nameEn}
                    onChange={(e) => setForm({ ...form, nameEn: e.target.value })}
                    className="erp-input"
                    placeholder="e.g. Grilled chicken"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <label className="erp-label">{locale === "gr" ? "Μερίδες" : "Portions"}</label>
                  <input
                    type="number"
                    value={form.portionYield}
                    onChange={(e) => setForm({ ...form, portionYield: e.target.value })}
                    className="erp-input"
                    step="0.1"
                    min="0"
                  />
                </div>
                <div>
                  <label className="erp-label">{locale === "gr" ? "Μονάδα" : "Unit"}</label>
                  <select
                    value={form.portionUnit}
                    onChange={(e) => setForm({ ...form, portionUnit: e.target.value })}
                    className="erp-select"
                  >
                    <option value="pcs">{locale === "gr" ? "Μερίδες" : "Portions"}</option>
                    <option value="kg">kg</option>
                    <option value="L">L</option>
                  </select>
                </div>
                <div>
                  <label className="erp-label">{locale === "gr" ? "Κόστος Εργασίας €" : "Labor Cost €"}</label>
                  <input
                    type="number"
                    value={form.laborCost}
                    onChange={(e) => setForm({ ...form, laborCost: e.target.value })}
                    className="erp-input"
                    step="0.01"
                    min="0"
                  />
                </div>
                <div>
                  <label className="erp-label">{locale === "gr" ? "Γεν. Έξοδα €" : "Overhead €"}</label>
                  <input
                    type="number"
                    value={form.overheadCost}
                    onChange={(e) => setForm({ ...form, overheadCost: e.target.value })}
                    className="erp-input"
                    step="0.01"
                    min="0"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="erp-label">{locale === "gr" ? "Περιθώριο Κέρδους %" : "Profit Margin %"}</label>
                  <input
                    type="number"
                    value={form.profitMarginPercent}
                    onChange={(e) => setForm({ ...form, profitMarginPercent: e.target.value })}
                    className="erp-input"
                    step="1"
                    min="0"
                    max="99"
                  />
                </div>
              </div>

              {/* Αλλεργίες */}
              <div>
                <label className="erp-label">{locale === "gr" ? "Αλλεργίες" : "Allergens"}</label>
                <div className="flex flex-wrap gap-2 mt-1">
                  {ALLERGEN_LIST.map((a) => (
                    <button
                      key={a}
                      type="button"
                      onClick={() =>
                        setForm((prev) => ({
                          ...prev,
                          allergens: prev.allergens.includes(a)
                            ? prev.allergens.filter((x) => x !== a)
                            : [...prev.allergens, a],
                        }))
                      }
                      className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                        form.allergens.includes(a)
                          ? "bg-red-500 text-white"
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      }`}
                    >
                      {a}
                    </button>
                  ))}
                </div>
              </div>

              {/* Τεχνικός Οδηγός */}
              <div>
                <label className="erp-label">{locale === "gr" ? "Τεχνικός Οδηγός" : "Technical Guide"}</label>
                <textarea
                  value={form.technicalGuide}
                  onChange={(e) => setForm({ ...form, technicalGuide: e.target.value })}
                  className="erp-input min-h-[100px] font-mono text-sm"
                  placeholder={locale === "gr" ? "Βήμα 1: …\nΒήμα 2: …" : "Step 1: …\nStep 2: …"}
                />
              </div>
            </div>
          </div>

          {/* Υλικά Συνταγής */}
          <div className="erp-card">
            <div className="erp-card-header flex items-center justify-between">
              <h3 className="font-semibold">
                🧂 {locale === "gr" ? "Υλικά Συνταγής" : "Recipe Ingredients"}
              </h3>
              {/* Search box — αναζήτηση μόνο από Ιστορικό Παραγγελιών */}
              <div ref={ingSearchRef}>
                <input
                  ref={ingInputRef}
                  type="text"
                  value={ingSearch}
                  onChange={(e) => handleIngSearchChange(e.target.value)}
                  onFocus={() => { if (ingSearch.trim()) openDropdown(); }}
                  placeholder={locale === "gr" ? "🔍 Αναζήτηση από παραγγελίες…" : "🔍 Search from orders…"}
                  className="erp-input text-xs py-1.5 w-72"
                  autoComplete="off"
                />
                {/* Portal — βγαίνει έξω από κάθε overflow:hidden container */}
                {showIngDropdown && dropdownRect && typeof document !== "undefined" && createPortal(
                  <div
                    style={{
                      position: "fixed",
                      top: dropdownRect.bottom + 4,
                      right: window.innerWidth - dropdownRect.right,
                      width: Math.max(dropdownRect.width, 420),
                      zIndex: 9999,
                    }}
                    className="max-h-80 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-2xl"
                  >
                    {ingLoading ? (
                      <div className="px-4 py-3 text-xs text-slate-400 text-center">
                        {locale === "gr" ? "Αναζήτηση…" : "Searching…"}
                      </div>
                    ) : ingResults.length === 0 ? (
                      <div className="px-4 py-3 text-xs text-slate-400 text-center">
                        {locale === "gr" ? "Δεν βρέθηκαν αποτελέσματα στο ιστορικό παραγγελιών" : "No results found in order history"}
                      </div>
                    ) : (
                      ingResults.map((item) => (
                        <div
                          key={item.id}
                          onMouseDown={(e) => { e.preventDefault(); addIngredientFromOrderItem(item); }}
                          className="px-4 py-2.5 cursor-pointer hover:bg-blue-50 border-b border-slate-50 last:border-0"
                        >
                          <div className="font-medium text-sm text-slate-800">{item.productName}</div>
                          <div className="text-xs text-slate-400 mt-0.5">
                            €{Number(item.basePrice).toFixed(2)}/{item.unit}
                            {item.supplierName && (
                              <span className="ml-2 text-blue-500 font-medium">{item.supplierName}</span>
                            )}
                            {item.orderDate && (
                              <span className="ml-2 text-slate-300">{item.orderDate.slice(0, 10)}</span>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>,
                  document.body
                )}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="erp-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>{locale === "gr" ? "Προϊόν" : "Product"}</th>
                    <th>{locale === "gr" ? "Προμηθευτής" : "Supplier"}</th>
                    <th>{locale === "gr" ? "Ποσότητα" : "Qty"}</th>
                    <th>{locale === "gr" ? "Μονάδα" : "Unit"}</th>
                    <th>{locale === "gr" ? "Τιμή/μον." : "Unit Cost"}</th>
                    <th>{locale === "gr" ? "Σύνολο" : "Total"}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {draftItems.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="text-center py-8 text-slate-400 text-sm">
                        {locale === "gr"
                          ? "Αναζήτησε υλικά από το ιστορικό παραγγελιών →"
                          : "Search ingredients from order history →"}
                      </td>
                    </tr>
                  ) : (
                    draftItems.map((item, i) => (
                      <tr key={item._key}>
                        <td className="text-xs text-slate-400">{i + 1}</td>
                        <td className="font-medium text-sm">{item.productName}</td>
                        <td className="text-xs text-blue-600">{item.supplierName ?? "—"}</td>
                        <td>
                          <input
                            type="number"
                            value={item.quantity === 0 ? "" : item.quantity}
                            onChange={(e) =>
                              updateDraftItem(item._key, "quantity", parseFloat(e.target.value) || 0)
                            }
                            className="erp-input text-xs py-1 w-20"
                            step="0.001"
                            min="0"
                            placeholder="0"
                          />
                        </td>
                        <td className="text-sm">{item.unit}</td>
                        <td>
                          <input
                            type="number"
                            value={item.unitCost}
                            onChange={(e) =>
                              updateDraftItem(item._key, "unitCost", parseFloat(e.target.value) || 0)
                            }
                            className="erp-input text-xs py-1 w-24"
                            step="0.0001"
                            min="0"
                          />
                        </td>
                        <td className="font-semibold">€{item.totalCost.toFixed(3)}</td>
                        <td>
                          <button
                            onClick={() => removeDraftItem(item._key)}
                            className="text-red-400 hover:text-red-600 text-sm"
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Σύνοψη Κόστους */}
          <div className="erp-card">
            <div className="erp-card-header">
              <h3 className="font-semibold">🧮 {locale === "gr" ? "Κοστολόγηση" : "Costing"}</h3>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
                <div className="bg-slate-50 rounded-lg p-3 text-center">
                  <div className="text-xs text-slate-500 mb-1">{locale === "gr" ? "Κόστος Υλικών" : "Raw Material"}</div>
                  <div className="font-bold text-slate-800">€{costing.rawMaterial.toFixed(2)}</div>
                </div>
                <div className="bg-slate-50 rounded-lg p-3 text-center">
                  <div className="text-xs text-slate-500 mb-1">{locale === "gr" ? "Συνολικό Κόστος" : "Total Cost"}</div>
                  <div className="font-bold text-slate-800">€{costing.total.toFixed(2)}</div>
                </div>
                <div className="bg-emerald-50 rounded-lg p-3 text-center">
                  <div className="text-xs text-emerald-600 mb-1">{locale === "gr" ? "Τιμή Πώλησης" : "Selling Price"}</div>
                  <div className="font-bold text-emerald-700">€{costing.selling.toFixed(2)}</div>
                </div>
                <div className="bg-blue-50 rounded-lg p-3 text-center">
                  <div className="text-xs text-blue-600 mb-1">{locale === "gr" ? "Τιμή Μενού (ΦΠΑ 24%)" : "Menu Price (VAT 24%)"}</div>
                  <div className="font-bold text-blue-700">€{costing.menuVat.toFixed(2)}</div>
                </div>
                <div className="bg-amber-50 rounded-lg p-3 text-center">
                  <div className="text-xs text-amber-600 mb-1">{locale === "gr" ? "Τιμή ανά Μερίδα" : "Price per Portion"}</div>
                  <div className="font-bold text-amber-700">€{costing.menuFinal.toFixed(2)}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Αποθήκευση */}
          <div className="flex justify-between items-center pb-6">
            <div className="flex gap-2">
              <button
                onClick={() => {
                  if (selectedRecipe) exportRecipeIngredients(selectedRecipe, draftItems, locale, costing);
                  else alert(locale === "gr" ? "Αποθήκευσε πρώτα τη συνταγή." : "Save the recipe first.");
                }}
                className="erp-btn-secondary"
              >
                📊 {locale === "gr" ? "Excel" : "Excel"}
              </button>
              <button
                onClick={() => {
                  if (selectedRecipe) printRecipePDF(selectedRecipe, draftItems, locale);
                  else alert(locale === "gr" ? "Αποθήκευσε πρώτα τη συνταγή." : "Save the recipe first.");
                }}
                className="erp-btn-secondary"
              >
                🖨️ {locale === "gr" ? "PDF / Εκτύπωση" : "Print / PDF"}
              </button>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setView("list")} className="erp-btn-ghost">
                {locale === "gr" ? "Ακύρωση" : "Cancel"}
              </button>
              <button onClick={saveRecipe} disabled={saving} className="erp-btn-success px-8">
                {saving ? "…" : "💾"} {locale === "gr" ? "Αποθήκευση Συνταγής" : "Save Recipe"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Search Modal */}
      <Modal
        isOpen={showSearch}
        onClose={() => setShowSearch(false)}
        title={locale === "gr" ? "Αναζήτηση Συνταγής" : "Search Recipe"}
        size="lg"
      >
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder={locale === "gr" ? "Πληκτρολόγησε όνομα…" : "Type name…"}
          className="erp-input mb-4"
          autoFocus
        />
        <div className="space-y-1 max-h-[350px] overflow-y-auto">
          {filteredRecipes.length === 0 ? (
            <div className="py-6 text-center text-slate-400 text-sm">
              {locale === "gr" ? "Δεν βρέθηκαν αποτελέσματα" : "No results found"}
            </div>
          ) : filteredRecipes.map((r, idx) => (
            <div
              key={r?.id ?? idx}
              onClick={() => { loadRecipe(r); setShowSearch(false); setSearchTerm(""); }}
              className="p-3 rounded-lg hover:bg-blue-50 cursor-pointer flex items-center justify-between"
            >
              <div>
                <div className="font-medium">{r?.name ?? "—"}</div>
                {r?.nameEn && <div className="text-xs text-slate-400">{r.nameEn}</div>}
              </div>
              <Badge color="green">€{Number(r?.totalCost ?? 0).toFixed(2)}</Badge>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
}
