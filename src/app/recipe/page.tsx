"use client";
import { useState, useRef, useMemo, useEffect } from "react";
import { useLanguage } from "@/lib/context";
import { PageHeader, Badge, Modal } from "@/components/shared";
import type { Recipe, RecipeIngredient } from "@/lib/types";
import * as db from "@/lib/supabaseData";
import { parseSpreadsheetFile, rowsToObjects, pick, exportRowsToExcel, exportRecipeFormsPretty, type PrettyRecipeSheet } from "@/lib/csv";

const ALLERGEN_LIST = ["gluten","dairy","eggs","fish","shellfish","nuts","peanuts","soy","sesame","celery","mustard","lupin","molluscs","sulphites"];

// Αφαιρεί τόνους/διαλυτικά και κάνει κεφαλαία, ώστε η αναζήτηση υλικού
// να ταιριάζει ανεξάρτητα από τόνους (ίδιο helper με τη σελίδα Παραγγελίας
// Πρόχειρου -- βλέπε src/app/draft-order/page.tsx). Χωρίς αυτό, η
// αναζήτηση υλικού εδώ έβρισκε μόνο ακριβές ταίριασμα τόνων.
const GREEK_ACCENT_MAP: Record<string, string> = {
  "Ά": "Α", "Έ": "Ε", "Ή": "Η", "Ί": "Ι", "Ϊ": "Ι", "Ό": "Ο", "Ύ": "Υ", "Ϋ": "Υ", "Ώ": "Ω",
  "ά": "α", "έ": "ε", "ή": "η", "ί": "ι", "ϊ": "ι", "ΐ": "ι", "ό": "ο", "ύ": "υ", "ϋ": "υ", "ΰ": "υ", "ώ": "ω",
};
function normalizeGreek(s: string): string {
  let out = "";
  for (const ch of s) out += GREEK_ACCENT_MAP[ch] ?? ch;
  return out.toUpperCase();
}

interface RecipeFormState {
  name: string;
  nameEn: string;
  portionYield: string;
  portionUnit: string;
  allergens: string[];
  technicalGuide: string;
  totalRawMaterialCost: string;
  laborCost: string;
  overheadCost: string;
  totalCost: string;
  profitMarginPercent: string;
  sellingPrice: string;
  menuPriceVat: string;
  menuPriceFinal: string;
  caloriesPerPortion: string;
  gramsPerPortion: string;
  platingImages: string;
}

export default function RecipePage() {
  const { t, locale, data, refreshAll } = useLanguage();
  const recipes = data.recipes;
  const allIngredients = data.ingredients;
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [form, setForm] = useState<RecipeFormState>({
    name: "", nameEn: "", portionYield: "1", portionUnit: "pcs",
    allergens: [], technicalGuide: "",
    totalRawMaterialCost: "0", laborCost: "0", overheadCost: "0",
    totalCost: "0", profitMarginPercent: "60", sellingPrice: "0",
    menuPriceVat: "0", menuPriceFinal: "0",
    caloriesPerPortion: "0", gramsPerPortion: "0", platingImages: "[]",
  });
  const [recipeItems, setRecipeItems] = useState<RecipeIngredient[]>([]);
  const [uploadingSlot, setUploadingSlot] = useState<number | null>(null);
  // "Αριθμομηχανή" μερίδων — ανεξάρτητο από το portionYield της
  // αποθηκευμένης συνταγής. Αλλάζοντάς το (π.χ. 5, 10, 50) ξαναϋπολογίζει
  // ζωντανά τις ποσότητες/τιμές παρτίδας στον πίνακα υλικών, χωρίς να
  // αλλάζει τίποτα στη βάση — καθαρά για το "πόσο χρειάζομαι για τη
  // δουλειά που κάνω τώρα".
  const [targetPortions, setTargetPortions] = useState<string>("1");
  // Ανά-γραμμή επιλογή εμφάνισης kg/g (μόνο για υλικά με βασική μονάδα
  // kg ή g) — καθαρά οπτικό, η πραγματική ποσότητα αποθηκεύεται πάντα
  // στη βασική μονάδα του υλικού (item.unit).
  const [rowUnitDisplay, setRowUnitDisplay] = useState<Record<number, "kg" | "g">>({});
  const [showSearch, setShowSearch] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  // Αναζήτηση υλικού με πληκτρολόγηση + dropdown, για προσθήκη υλικού
  // απευθείας μέσα στη φόρμα συνταγής (ενοποιημένη ξανά, κατόπιν
  // ρητού αιτήματος του χρήστη να ακυρωθεί ο χωρισμός σε σελίδες).
  const [ingredientSearchTerm, setIngredientSearchTerm] = useState("");
  const [showIngredientSearch, setShowIngredientSearch] = useState(false);
  // Φίλτρο μονάδας δίπλα στην αναζήτηση υλικού -- χρήσιμο για να
  // περιορίσεις γρήγορα ανάμεσα σε >2800 υλικά χωρίς να χρειάζεται να
  // πληκτρολογήσεις ολόκληρο το όνομα.
  const [ingredientUnitFilter, setIngredientUnitFilter] = useState("");
  const [savingIngredientRowId, setSavingIngredientRowId] = useState<number | "new" | null>(null);
  const [refreshingPrices, setRefreshingPrices] = useState(false);
  const [priceRefreshMsg, setPriceRefreshMsg] = useState("");
  const ingredientSearchRef = useRef<HTMLDivElement>(null);
  // Πόσα υλικά είχε η συνταγή την τελευταία φορά που φορτώθηκε/αποθηκεύτηκε
  // -- baseline για το παρακάτω useEffect, ώστε να ξέρει πότε ΠΡΑΓΜΑΤΙΚΑ
  // προστέθηκε ή αφαιρέθηκε υλικό (και να ενημερώσει αυτόματα τα
  // "Γραμμάρια / Μερίδα"), αντί να το κάνει και όταν απλά ανοίγεις μια
  // ήδη αποθηκευμένη συνταγή (όπου η χειροκίνητη τιμή μπορεί σκόπιμα να
  // διαφέρει από το άθροισμα -- π.χ. λόγω απώλειας βάρους στο μαγείρεμα).
  const lastIngredientCountRef = useRef<number | null>(null);

  const ingredientUnits = useMemo(() => {
    const set = new Set<string>();
    for (const ing of allIngredients) if (ing.unit) set.add(ing.unit);
    return Array.from(set).sort();
  }, [allIngredients]);

  // Αναζήτηση ανεξάρτητη τόνων (βλέπε normalizeGreek) -- έτσι
  // "ΝΤΟΜΑΤΑ" βρίσκει και "ντομάτα" και το αντίστροφο, χωρίς να
  // χρειάζεται να πληκτρολογηθούν ακριβώς οι ίδιοι τόνοι.
  const ingredientSearchResults = useMemo(() => {
    const q = normalizeGreek(ingredientSearchTerm.trim());
    if (!q && !ingredientUnitFilter) return [];
    return allIngredients
      .filter((ing) => {
        if (ingredientUnitFilter && ing.unit !== ingredientUnitFilter) return false;
        if (!q) return true;
        const name = normalizeGreek(locale === "gr" ? ing.name : (ing.nameEn || ing.name));
        return name.includes(q) || normalizeGreek(ing.sku).includes(q);
      })
      .slice(0, 30);
  }, [ingredientSearchTerm, ingredientUnitFilter, allIngredients, locale]);

  // Πραγματική τιμή (όχι η στατική "Τιμή Μονάδας") για κάθε υλικό που
  // εμφανίζεται ΤΩΡΑ στα αποτελέσματα αναζήτησης -- χωρίς αυτό, δύο
  // σχεδόν-ίδια υλικά (π.χ. πολλά "ΚΡΕΜΑ ΓΑΛΑΚΤΟΣ 35%" από παλιά μαζική
  // εισαγωγή) φαίνονται πανομοιότυπα στη λίστα, και δεν υπάρχει τρόπος
  // να ξέρεις ΠΡΙΝ το προσθέσεις ποιο από όλα έχει πραγματικά τιμή.
  // Με μικρή καθυστέρηση (debounce) ώστε να μη γίνεται ένα αίτημα ανά
  // πάτημα πλήκτρου, και με "reqId" ώστε μια παλιά/αργή απάντηση να μην
  // αντικαταστήσει αποτελέσματα μιας νεότερης αναζήτησης.
  const [resultPrices, setResultPrices] = useState<Record<number, db.IngredientCurrentPrice | "loading" | "error">>({});
  const searchPriceReqIdRef = useRef(0);
  useEffect(() => {
    if (ingredientSearchResults.length === 0) return;
    const reqId = ++searchPriceReqIdRef.current;
    const ids = ingredientSearchResults.map((r) => r.id);
    setResultPrices((prev) => {
      const next: typeof prev = {};
      for (const id of ids) next[id] = prev[id] ?? "loading";
      return next;
    });
    const timer = setTimeout(() => {
      Promise.all(
        ids.map((id) =>
          db.getIngredientCurrentPrice(id)
            .then((p) => [id, p] as const)
            .catch(() => [id, null] as const)
        )
      ).then((entries) => {
        if (searchPriceReqIdRef.current !== reqId) return; // ξεπεράστηκε από νεότερη αναζήτηση
        setResultPrices((prev) => {
          const next = { ...prev };
          for (const [id, p] of entries) next[id] = p ?? "error";
          return next;
        });
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [ingredientSearchResults]);

  // Γραμμάρια/μερίδα υπολογισμένα ΑΠΟ τα ίδια τα υλικά της συνταγής
  // (άθροισμα των kg/g υλικών, διά τις μερίδες) — ενημερωτικά, δίπλα
  // στο χειροκίνητο πεδίο "Γραμμάρια / Μερίδα".
  const computedGramsPerPortion = useMemo(() => {
    const totalGrams = recipeItems.reduce((sum, item) => {
      const u = (item.unit || "").toLowerCase();
      if (u === "kg") return sum + Number(item.quantity || 0) * 1000;
      if (u === "g") return sum + Number(item.quantity || 0);
      return sum;
    }, 0);
    const portions = Number(form.portionYield || 1) || 1;
    return totalGrams / portions;
  }, [recipeItems, form.portionYield]);

  // Αυτόματη ενημέρωση "Γραμμάρια / Μερίδα" ΜΟΝΟ όταν πραγματικά
  // προστέθηκε ή αφαιρέθηκε υλικό (ο αριθμός γραμμών άλλαξε σε σχέση
  // με το baseline) -- ΟΧΙ όταν απλά άνοιξε μια ήδη αποθηκευμένη
  // συνταγή (loadRecipe/newRecipe ορίζουν το baseline ίσο με το τρέχον
  // πλήθος ΠΡΙΝ αυτό το effect προλάβει να τρέξει), ώστε να μην
  // σβήνεται μια χειροκίνητη τιμή που σκόπιμα διαφέρει (π.χ. λόγω
  // απώλειας βάρους στο μαγείρεμα). Το χειροκίνητο πεδίο παραμένει
  // πάντα επεξεργάσιμο μετά — απλά δεν χρειάζεται πια το κλικ σε
  // "Χρήση αυτού" κάθε φορά που προστίθεται/αφαιρείται μια γραμμή.
  useEffect(() => {
    if (lastIngredientCountRef.current === null) return;
    if (recipeItems.length !== lastIngredientCountRef.current) {
      lastIngredientCountRef.current = recipeItems.length;
      setForm((prev) => ({ ...prev, gramsPerPortion: computedGramsPerPortion.toFixed(0) }));
    }
  }, [recipeItems.length, computedGramsPerPortion]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ingredientSearchRef.current && !ingredientSearchRef.current.contains(e.target as Node)) {
        setShowIngredientSearch(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);
  // Πλατιά προβολή λίστας: πίνακας με όλες τις συνταγές, checkboxes
  // για πολλαπλή επιλογή (θεμέλιο για μαζικές ενέργειες όπως export
  // ή μαζική διαγραφή). Ξεχωριστό state από το selectedRecipe/editing
  // — η λίστα-πίνακας και η φόρμα επεξεργασίας δεν είναι ποτέ ορατές
  // ταυτόχρονα.
  const [listView, setListView] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const RECIPE_PAGE_SIZE = 100;
  const [recipePage, setRecipePage] = useState(1);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  // Bulk import (1000+ recipes from a single .xlsx/.csv)
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [bulkFile, setBulkFile] = useState<File | null>(null);
  const [bulkImporting, setBulkImporting] = useState(false);
  const [bulkMsg, setBulkMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const bulkFileInputRef = useRef<HTMLInputElement>(null);

  function newRecipe() {
    setEditing(true);
    setSelectedRecipe(null);
    setForm({ name: "", nameEn: "", portionYield: "1", portionUnit: "pcs", allergens: [], technicalGuide: "", totalRawMaterialCost: "0", laborCost: "0", overheadCost: "0", totalCost: "0", profitMarginPercent: "60", sellingPrice: "0", menuPriceVat: "0", menuPriceFinal: "0", caloriesPerPortion: "0", gramsPerPortion: "0", platingImages: "[]" });
    setRecipeItems([]);
    setTargetPortions("1");
    setRowUnitDisplay({});
    lastIngredientCountRef.current = 0;
  }

  function loadRecipe(r: Recipe) {
    if (!r) return;
    setSelectedRecipe(r);
    setEditing(true);
    setForm({
      name: r.name, nameEn: r.nameEn || "", portionYield: r.portionYield, portionUnit: r.portionUnit,
      allergens: typeof r.allergens === "string" ? JSON.parse(r.allergens || "[]") : (r.allergens || []) as string[],
      technicalGuide: r.technicalGuide || "",
      totalRawMaterialCost: r.totalRawMaterialCost, laborCost: r.laborCost, overheadCost: r.overheadCost,
      totalCost: r.totalCost, profitMarginPercent: r.profitMarginPercent, sellingPrice: r.sellingPrice,
      menuPriceVat: r.menuPriceVat, menuPriceFinal: r.menuPriceFinal,
      caloriesPerPortion: r.caloriesPerPortion ?? "0", gramsPerPortion: r.gramsPerPortion ?? "0",
      platingImages: r.platingImages ?? "[]",
    });
    setRecipeItems(r.ingredients || []);
    setTargetPortions(r.portionYield || "1");
    setRowUnitDisplay({});
    lastIngredientCountRef.current = (r.ingredients || []).length;
  }

  function calculateCosting() {
    const rawMaterial = recipeItems.reduce((s, i) => s + Number(i.totalCost || 0), 0);
    const labor = Number(form.laborCost);
    const overhead = Number(form.overheadCost);
    const total = rawMaterial + labor + overhead;
    const margin = Number(form.profitMarginPercent);
    const selling = total / (1 - margin / 100);
    const menuVat = selling * 1.24;
    setForm(prev => ({
      ...prev,
      totalRawMaterialCost: rawMaterial.toFixed(2),
      totalCost: total.toFixed(2),
      sellingPrice: selling.toFixed(2),
      menuPriceVat: menuVat.toFixed(2),
      menuPriceFinal: (menuVat / Number(prev.portionYield || 1)).toFixed(2),
    }));
  }

  // --- Μερίδες & ζύγιση: βοηθητικές συναρτήσεις για τον πίνακα υλικών ---
  // Μετατρέπει μια ποσότητα ανάμεσα σε kg/g. Για κάθε άλλη μονάδα
  // (τεμ, lt κ.λπ.) επιστρέφει την τιμή αμετάβλητη.
  function convertQty(baseQty: number, fromUnit: string, toUnit: string): number {
    const from = (fromUnit || "").toLowerCase();
    const to = (toUnit || "").toLowerCase();
    if (from === to) return baseQty;
    if (from === "kg" && to === "g") return baseQty * 1000;
    if (from === "g" && to === "kg") return baseQty / 1000;
    return baseQty;
  }
  function isWeightUnit(u: string): boolean {
    const x = (u || "").toLowerCase();
    return x === "kg" || x === "g";
  }
  // Ποσότητα ΑΝΑ ΜΙΑ ΜΕΡΙΔΑ (στη βασική μονάδα του υλικού), με βάση τις
  // αποθηκευμένες μερίδες της συνταγής (form.portionYield).
  function qtyPerPortionBase(item: RecipeIngredient): number {
    const portions = Number(form.portionYield || 1) || 1;
    return Number(item.quantity || 0) / portions;
  }
  // Ποσότητα για τον ΣΤΟΧΟ μερίδων (targetPortions) — π.χ. πόσα
  // γραμμάρια χρειάζονται για 50 μερίδες αντί για τη 1 που έχει η
  // αποθηκευμένη συνταγή.
  function batchQtyBase(item: RecipeIngredient): number {
    const target = Number(targetPortions || 0);
    return qtyPerPortionBase(item) * target;
  }
  // Τιμή Μερίδας: πόσο κοστίζει αυτό το υλικό ΑΝΑ ΜΙΑ μερίδα της
  // συνταγής (αντί για τιμή ανά μονάδα/κιλό).
  function pricePerPortion(item: RecipeIngredient): number {
    const portions = Number(form.portionYield || 1) || 1;
    return Number(item.totalCost || 0) / portions;
  }
  // Κόστος αυτού του υλικού για τον στόχο μερίδων.
  function batchPrice(item: RecipeIngredient): number {
    const target = Number(targetPortions || 0);
    return pricePerPortion(item) * target;
  }

  // Εξάγει ΜΙΑ συνταγή (αυτή που είναι ανοιχτή στο popup) σε .xlsx —
  // μία γραμμή ανά υλικό, με τα στοιχεία της συνταγής επαναλαμβανόμενα
  // σε κάθε γραμμή, και μια τελευταία γραμμή ΣΥΝΟΛΟ με τα κόστη.
  function exportRecipeToExcel() {
    if (recipeItems.length === 0) return;
    const rows: Record<string, string | number>[] = recipeItems.map((item) => ({
      [locale === "gr" ? "Συνταγή" : "Recipe"]: form.name,
      [locale === "gr" ? "Μερίδες Συνταγής" : "Recipe Portions"]: Number(form.portionYield),
      [locale === "gr" ? "Υλικό" : "Ingredient"]: item.ingredientName,
      [locale === "gr" ? "Ποσότητα" : "Quantity"]: item.quantity,
      [locale === "gr" ? "Μονάδα" : "Unit"]: item.unit,
      [locale === "gr" ? "Τιμή Μερίδας" : "Portion Price"]: Number(pricePerPortion(item).toFixed(3)),
      [locale === "gr" ? `Ποσότητα (${targetPortions || 0} μερ.)` : `Quantity (${targetPortions || 0} ptn)`]: Number(batchQtyBase(item).toFixed(4)),
      [locale === "gr" ? `Κόστος (${targetPortions || 0} μερ.)` : `Cost (${targetPortions || 0} ptn)`]: Number(batchPrice(item).toFixed(2)),
      [locale === "gr" ? "Σύνολο" : "Total"]: Number(item.totalCost),
    }));
    rows.push({
      [locale === "gr" ? "Συνταγή" : "Recipe"]: form.name,
      [locale === "gr" ? "Μερίδες Συνταγής" : "Recipe Portions"]: Number(form.portionYield),
      [locale === "gr" ? "Υλικό" : "Ingredient"]: locale === "gr" ? "ΣΥΝΟΛΟ" : "TOTAL",
      [locale === "gr" ? "Ποσότητα" : "Quantity"]: "",
      [locale === "gr" ? "Μονάδα" : "Unit"]: "",
      [locale === "gr" ? "Τιμή Μερίδας" : "Portion Price"]: "",
      [locale === "gr" ? `Ποσότητα (${targetPortions || 0} μερ.)` : `Quantity (${targetPortions || 0} ptn)`]: "",
      [locale === "gr" ? `Κόστος (${targetPortions || 0} μερ.)` : `Cost (${targetPortions || 0} ptn)`]: locale === "gr" ? "Κόστος Υλικών:" : "Raw Cost:",
      [locale === "gr" ? "Σύνολο" : "Total"]: Number(form.totalRawMaterialCost),
    });
    const safeName = (form.name || (locale === "gr" ? "συνταγή" : "recipe")).replace(/[\\/:*?"<>|]/g, "").trim() || "recipe";
    exportRowsToExcel(rows, safeName, locale === "gr" ? "Συνταγή" : "Recipe");
  }

  // Χτίζει το ίδιο payload με το saveRecipe, χρησιμοποιείται για να
  // αποθηκεύσει ΑΜΕΣΩΣ τις φωτογραφίες παρουσίασης, χωρίς να χρειάζεται
  // ξεχωριστό πάτημα του κουμπιού "Αποθήκευση Συνταγής".
  function buildRecipeDetailsPayload(platingImagesOverride: string) {
    return {
      name: form.name, nameEn: form.nameEn || null, portionYield: form.portionYield, portionUnit: form.portionUnit,
      allergens: JSON.stringify(form.allergens), technicalGuide: form.technicalGuide || null,
      totalRawMaterialCost: form.totalRawMaterialCost, laborCost: form.laborCost, overheadCost: form.overheadCost,
      totalCost: form.totalCost, profitMarginPercent: form.profitMarginPercent, sellingPrice: form.sellingPrice,
      menuPriceVat: form.menuPriceVat, menuPriceFinal: form.menuPriceFinal,
      caloriesPerPortion: form.caloriesPerPortion, gramsPerPortion: form.gramsPerPortion,
      platingImages: platingImagesOverride, isActive: true,
    };
  }

  // Ανεβάζει μια φωτογραφία στο slot (0, 1 ή 2) της Φωτογαλερίας —
  // απαιτεί ήδη αποθηκευμένη συνταγή (selectedRecipe.id), γράφει
  // ΑΜΕΣΩΣ στη βάση ώστε να μη χαθεί αν ο χρήστης κλείσει το popup.
  async function uploadPlatingImage(slot: number, file: File) {
    if (!selectedRecipe?.id) return;
    setUploadingSlot(slot);
    try {
      const url = await db.uploadRecipeImage(selectedRecipe.id, file);
      const images: string[] = JSON.parse(form.platingImages || "[]");
      while (images.length < 3) images.push("");
      images[slot] = url;
      const newPlatingImages = JSON.stringify(images);
      setForm((prev) => ({ ...prev, platingImages: newPlatingImages }));
      await db.updateRecipeDetails(selectedRecipe.id, buildRecipeDetailsPayload(newPlatingImages));
    } catch (err) {
      alert(locale === "gr" ? "Αποτυχία μεταφόρτωσης: " + String(err) : "Upload failed: " + String(err));
    } finally {
      setUploadingSlot(null);
    }
  }

  function removePlatingImage(slot: number) {
    if (!selectedRecipe?.id) return;
    const images: string[] = JSON.parse(form.platingImages || "[]");
    while (images.length < 3) images.push("");
    images[slot] = "";
    const newPlatingImages = JSON.stringify(images);
    setForm((prev) => ({ ...prev, platingImages: newPlatingImages }));
    db.updateRecipeDetails(selectedRecipe.id, buildRecipeDetailsPayload(newPlatingImages)).catch((err) =>
      alert(locale === "gr" ? "Αποτυχία διαγραφής: " + String(err) : "Delete failed: " + String(err))
    );
  }

  // Καλείται όταν ο χρήστης διαλέγει ένα υλικό από το αποτέλεσμα
  // αναζήτησης. Γράφει ΑΜΕΣΩΣ στη βάση (addRecipeIngredient) --
  // απαιτεί ότι η συνταγή ήδη υπάρχει (έχει selectedRecipe.id), αφού
  // recipe_ingredients χρειάζεται πραγματικό recipe_id.
  async function addIngredientToRecipe(ing: (typeof allIngredients)[number]) {
    if (!selectedRecipe?.id) return;
    setSavingIngredientRowId("new");
    try {
      let unitCost = Number(ing.basePrice);
      try {
        const price = await db.getIngredientCurrentPrice(ing.id);
        // Μόνο αν βρέθηκε ΠΡΑΓΜΑΤΙΚΗ τιμή αντικαθιστούμε τη χειροκίνητη --
        // αν το υλικό δεν έχει καθόλου ιστορικό παραγγελιών (π.χ. είναι
        // σπιτικό παρασκεύασμα που δεν αγοράζεται ποτέ έτοιμο, όχι κάτι
        // που λείπει από λάθος), κρατάμε τη χειροκίνητη «Τιμή Μονάδας»
        // από τη Σελίδα Με Υλικά αντί να τη μηδενίζουμε.
        if (price && price.priceSource !== "none") unitCost = price.unitCost;
      } catch {
        // εφεδρικά η στατική τιμή, αν αποτύχει το αίτημα δυναμικής τιμής
      }
      const newRowName = locale === "gr" ? ing.name : (ing.nameEn || ing.name);
      const newId = await db.addRecipeIngredient(selectedRecipe.id, {
        ingredientId: ing.id, ingredientName: newRowName,
        quantity: 0, unit: ing.unit, unitCost, totalCost: 0,
        wastageFactor: Number(ing.wastageFactor), requiresPrep: false, prepNotes: "",
      });
      setRecipeItems((prev) => [
        ...prev,
        {
          id: newId, ingredientId: ing.id, ingredientName: newRowName,
          quantity: 0, unit: ing.unit, unitCost, totalCost: 0,
          wastageFactor: Number(ing.wastageFactor), requiresPrep: false, prepNotes: "",
        },
      ]);
      await refreshAll();
      setIngredientSearchTerm("");
      setShowIngredientSearch(false);
    } catch (err) {
      alert(locale === "gr" ? "Αποτυχία προσθήκης: " + String(err) : "Failed to add: " + String(err));
    } finally {
      setSavingIngredientRowId(null);
    }
  }

  async function updateIngredientRow(rowId: number, field: string, value: string | number | boolean) {
    const row = recipeItems.find((i) => i.id === rowId);
    if (!row) return;
    const patch: Record<string, unknown> = { [field]: value };
    if (field === "quantity" || field === "unitCost") {
      const newQuantity = field === "quantity" ? Number(value) : Number(row.quantity);
      const newUnitCost = field === "unitCost" ? Number(value) : Number(row.unitCost);
      patch.totalCost = Number((newQuantity * newUnitCost).toFixed(2));
    }
    setSavingIngredientRowId(rowId);
    try {
      await db.updateRecipeIngredient(rowId, patch);
      setRecipeItems((prev) => prev.map((i) => (i.id === rowId ? { ...i, ...patch } : i)));
      await refreshAll();
    } catch (err) {
      alert(locale === "gr" ? "Αποτυχία ενημέρωσης: " + String(err) : "Failed to update: " + String(err));
    } finally {
      setSavingIngredientRowId(null);
    }
  }

  // Ξαναφέρνει την πραγματική τιμή (get_ingredient_current_price) για ΚΑΘΕ
  // υλικό ήδη προστεθειμένο σε αυτή τη συνταγή -- χρήσιμο για συνταγές
  // που έγιναν πριν λειτουργήσει η δυναμική τιμοδότηση (τότε είχαν
  // αποθηκευτεί με €0,00), ή απλά για να ξαναπάρεις τις πιο πρόσφατες
  // τιμές χωρίς να ξαναπροσθέσεις κάθε υλικό ένα-ένα.
  //
  // Ενημερώνει ΜΟΝΟ όσα υλικά βρήκαν πραγματική τιμή (order_history ή
  // supplier_offer) -- αν ένα υλικό δεν έχει ΚΑΘΟΛΟΥ ιστορικό παραγγελιών
  // (π.χ. σπιτικό παρασκεύασμα, δεν αγοράζεται ποτέ έτοιμο), η ήδη
  // αποθηκευμένη τιμή του (χειροκίνητη ή προηγούμενη) ΔΕΝ πειράζεται --
  // πριν μηδενιζόταν αυτόματα, πράγμα που κατέστρεφε τη μοναδική έγκυρη
  // τιμή που θα μπορούσε ποτέ να έχει ένα τέτοιο υλικό.
  async function refreshAllPrices() {
    if (recipeItems.length === 0) return;
    setRefreshingPrices(true);
    let updated = 0;
    let skipped = 0;
    let failed = 0;
    try {
      for (const item of recipeItems) {
        if (item.id == null || item.ingredientId == null) continue;
        try {
          const price = await db.getIngredientCurrentPrice(item.ingredientId);
          if (price && price.priceSource !== "none") {
            const newTotal = Number((Number(item.quantity) * price.unitCost).toFixed(2));
            await db.updateRecipeIngredient(item.id, { unitCost: price.unitCost, totalCost: newTotal });
            const rowId = item.id;
            setRecipeItems((prev) => prev.map((i) => (i.id === rowId ? { ...i, unitCost: price.unitCost, totalCost: newTotal } : i)));
            updated++;
          } else {
            skipped++;
          }
        } catch {
          failed++;
        }
      }
      await refreshAll();
      setPriceRefreshMsg(
        locale === "gr"
          ? `✅ Ενημερώθηκαν ${updated} τιμές${skipped > 0 ? ` (${skipped} χωρίς ιστορικό — δεν πειράχτηκαν)` : ""}${failed > 0 ? ` (${failed} απέτυχαν)` : ""}`
          : `✅ ${updated} prices refreshed${skipped > 0 ? ` (${skipped} had no history — left untouched)` : ""}${failed > 0 ? ` (${failed} failed)` : ""}`
      );
      setTimeout(() => setPriceRefreshMsg(""), 4000);
    } finally {
      setRefreshingPrices(false);
    }
  }

  async function deleteIngredientRow(rowId: number) {
    setSavingIngredientRowId(rowId);
    try {
      await db.deleteRecipeIngredient(rowId);
      // Το refreshAll() πιο κάτω ενημερώνει μόνο το καθολικό cache
      // (data.recipes) -- ΔΕΝ ξαναγράφει μόνο του το τοπικό recipeItems
      // που δείχνει αυτός ο πίνακας, οπότε χωρίς αυτή τη γραμμή η
      // γραμμή υλικού έμενε ορατή μέχρι να κλείσεις/ξανανοίξεις τη
      // συνταγή, παρόλο που η διαγραφή είχε ήδη γίνει στη βάση.
      setRecipeItems((prev) => prev.filter((i) => i.id !== rowId));
      await refreshAll();
    } catch (err) {
      alert(locale === "gr" ? "Αποτυχία διαγραφής: " + String(err) : "Failed to delete: " + String(err));
    } finally {
      setSavingIngredientRowId(null);
    }
  }

  async function saveRecipe() {
    if (!form.name) return;
    setSaving(true);
    try {
      const details = {
        name: form.name,
        nameEn: form.nameEn || null,
        portionYield: form.portionYield,
        portionUnit: form.portionUnit,
        allergens: JSON.stringify(form.allergens),
        technicalGuide: form.technicalGuide || null,
        totalRawMaterialCost: form.totalRawMaterialCost,
        laborCost: form.laborCost,
        overheadCost: form.overheadCost,
        totalCost: form.totalCost,
        profitMarginPercent: form.profitMarginPercent,
        sellingPrice: form.sellingPrice,
        menuPriceVat: form.menuPriceVat,
        menuPriceFinal: form.menuPriceFinal,
        caloriesPerPortion: form.caloriesPerPortion,
        gramsPerPortion: form.gramsPerPortion,
        platingImages: form.platingImages,
        isActive: true,
      };
      if (selectedRecipe?.id) {
        await db.updateRecipeDetails(selectedRecipe.id, details);
        await refreshAll();
        setEditing(false);
      } else {
        // Νέα συνταγή: αποθηκεύουμε, αλλά ΔΕΝ κλείνουμε το popup —
        // μένει ανοιχτό, φορτωμένο σαν "υπάρχουσα" συνταγή (με το νέο
        // id), ώστε να εμφανιστεί αμέσως ο πίνακας υλικών και ο χρήστης
        // να μπορεί να αρχίσει να προσθέτει υλικά χωρίς να κλείσει και
        // να ξανανοίξει τη συνταγή.
        const newId = await db.createRecipeDetails(details);
        await refreshAll();
        loadRecipe({ id: newId, ...details, ingredients: [] } as Recipe);
      }
    } catch (err) {
      alert(locale === "gr" ? "Αποτυχία αποθήκευσης: " + String(err) : "Failed to save: " + String(err));
    } finally {
      setSaving(false);
    }
  }

  async function deleteRecipe(id: number) {
    if (!confirm(t("deleteConfirm"))) return;
    setDeletingId(id);
    try {
      await db.deleteRecipe(id);
      await refreshAll();
      if (selectedRecipe?.id === id) { setSelectedRecipe(null); setEditing(false); }
    } catch (err) {
      alert(locale === "gr" ? "Αποτυχία διαγραφής: " + String(err) : "Failed to delete: " + String(err));
    } finally {
      setDeletingId(null);
    }
  }

  function toggleSelect(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds((prev) =>
      prev.size === recipes.length ? new Set() : new Set(recipes.map((r) => r.id))
    );
  }

  // Μαζική διαγραφή: τα deletes τρέχουν παράλληλα (Promise.all) αφού
  // είναι ανεξάρτητες εγγραφές — δεν υπάρχει λόγος να περιμένει η μία
  // την άλλη διαδοχικά, όπως ήδη κάνουμε στο bulk recipe import.
  async function deleteSelected() {
    if (selectedIds.size === 0) return;
    const label = locale === "gr" ? `Διαγραφή ${selectedIds.size} επιλεγμένων συνταγών;` : `Delete ${selectedIds.size} selected recipes?`;
    if (!confirm(label)) return;
    setBulkDeleting(true);
    try {
      await Promise.all(Array.from(selectedIds).map((id) => db.deleteRecipe(id)));
      await refreshAll();
      setSelectedIds(new Set());
    } catch (err) {
      alert(locale === "gr" ? "Αποτυχία μαζικής διαγραφής: " + String(err) : "Bulk delete failed: " + String(err));
    } finally {
      setBulkDeleting(false);
    }
  }

  // Εξάγει τις επιλεγμένες συνταγές σε .xlsx (ή ΟΛΕΣ, αν καμία δεν
  // είναι επιλεγμένη) -- ίδια στήλες με τον πίνακα που ήδη βλέπει
  // ο χρήστης, ώστε το αρχείο να αντιστοιχεί ακριβώς σε αυτό που
  // περίμενε να κατεβάσει.
  function exportRecipesExcel() {
    const toExport = selectedIds.size > 0 ? recipes.filter((r) => selectedIds.has(r.id)) : recipes;
    if (toExport.length === 0) return;
    const rows = toExport.map((r) => ({
      [locale === "gr" ? "Όνομα" : "Name"]: r.name,
      [locale === "gr" ? "Αγγλικό Όνομα" : "English Name"]: r.nameEn ?? "",
      [locale === "gr" ? "Μερίδες" : "Portions"]: Number(r.portionYield),
      [locale === "gr" ? "Μονάδα" : "Unit"]: r.portionUnit,
      [locale === "gr" ? "Κόστος Υλικών" : "Ingredient Cost"]: Number(r.totalRawMaterialCost),
      [locale === "gr" ? "Συνολικό Κόστος" : "Total Cost"]: Number(r.totalCost),
      [locale === "gr" ? "Τιμή Πώλησης" : "Selling Price"]: Number(r.sellingPrice),
      [locale === "gr" ? "Τιμή Μενού (ΦΠΑ)" : "Menu Price (VAT)"]: Number(r.menuPriceVat),
      [locale === "gr" ? "Περιθώριο %" : "Margin %"]: Number(r.profitMarginPercent),
    }));
    const filename = locale === "gr" ? "συνταγές" : "recipes";
    exportRowsToExcel(rows, filename, locale === "gr" ? "Συνταγές" : "Recipes");
  }

  // Χτίζει το "όμορφο" φύλλο ΜΙΑΣ συνταγής (τίτλος, κουτί στοιχείων,
  // πίνακας υλικών, κοστολόγηση, τεχνικός οδηγός) για τη μαζική εξαγωγή
  // "Εξαγωγή Φορμών" -- έτοιμο να τυπωθεί και να δοθεί σε μάγειρα.
  function buildPrettyRecipeSheet(r: Recipe, idx: number): PrettyRecipeSheet {
    const gr = locale === "gr";
    const portions = Number(r.portionYield || 1) || 1;
    let allergens: string[] = [];
    try {
      allergens = typeof r.allergens === "string" ? JSON.parse(r.allergens || "[]") : ((r.allergens as unknown as string[]) || []);
    } catch {
      allergens = [];
    }
    return {
      sheetName: r.name || (gr ? `Συνταγή ${idx + 1}` : `Recipe ${idx + 1}`),
      title: r.name || (gr ? `Συνταγή ${idx + 1}` : `Recipe ${idx + 1}`),
      subtitle: r.nameEn || undefined,
      infoPairs: [
        { label: gr ? "Μερίδες" : "Portions", value: `${Number(r.portionYield || 0)} ${r.portionUnit}` },
        { label: gr ? "Θερμίδες / Μερίδα" : "Calories / Portion", value: Number(r.caloriesPerPortion || 0) },
        { label: gr ? "Γραμμάρια / Μερίδα" : "Grams / Portion", value: `${Number(r.gramsPerPortion || 0)} g` },
        { label: gr ? "Κόστος Εργασίας" : "Labor Cost", value: `€${Number(r.laborCost || 0).toFixed(2)}` },
        { label: gr ? "Γενικά Έξοδα" : "Overhead Cost", value: `€${Number(r.overheadCost || 0).toFixed(2)}` },
        { label: gr ? "Περιθώριο Κέρδους %" : "Profit Margin %", value: `${Number(r.profitMarginPercent || 0)}%` },
      ],
      allergensLine: allergens.length ? `${gr ? "Αλλεργιογόνα" : "Allergens"}: ${allergens.join(", ")}` : undefined,
      ingredientRows: (r.ingredients || []).map((item) => ({
        name: item.ingredientName,
        quantity: Number(item.quantity || 0),
        unit: item.unit,
        portionPrice: `€${(Number(item.totalCost || 0) / portions).toFixed(3)}`,
        total: `€${Number(item.totalCost || 0).toFixed(2)}`,
      })),
      costingPairs: [
        { label: gr ? "Κόστος Υλικών" : "Raw Material Cost", value: `€${Number(r.totalRawMaterialCost || 0).toFixed(2)}` },
        { label: gr ? "Συνολικό Κόστος" : "Total Cost", value: `€${Number(r.totalCost || 0).toFixed(2)}` },
        { label: gr ? "Τιμή Πώλησης" : "Selling Price", value: `€${Number(r.sellingPrice || 0).toFixed(2)}` },
        { label: gr ? "Τιμή Μενού (ΦΠΑ)" : "Menu Price (VAT)", value: `€${Number(r.menuPriceVat || 0).toFixed(2)}` },
      ],
      technicalGuide: r.technicalGuide || undefined,
    };
  }

  // Μαζική εξαγωγή -- μία ΠΛΗΡΗΣ, όμορφη φόρμα συνταγής ανά φύλλο Excel
  // (έτοιμη για εκτύπωση), για τις επιλεγμένες συνταγές (ή όλες, αν
  // καμία δεν είναι επιλεγμένη).
  async function exportRecipesFormsToExcel() {
    const toExport = selectedIds.size > 0 ? recipes.filter((r) => selectedIds.has(r.id)) : recipes;
    if (toExport.length === 0) return;
    const sheets = toExport.map((r, idx) => buildPrettyRecipeSheet(r, idx));
    const filename = locale === "gr" ? "συνταγές-φόρμες" : "recipe-forms";
    try {
      await exportRecipeFormsPretty(sheets, filename, {
        num: "#",
        ingredient: locale === "gr" ? "Υλικό" : "Ingredient",
        quantity: locale === "gr" ? "Ποσότητα" : "Quantity",
        unit: locale === "gr" ? "Μονάδα" : "Unit",
        portionPrice: locale === "gr" ? "Τιμή Μερίδας" : "Portion Price",
        total: locale === "gr" ? "Σύνολο" : "Total",
        technicalGuideTitle: locale === "gr" ? "Τεχνικός Οδηγός" : "Technical Guide",
      });
    } catch (err) {
      alert(locale === "gr" ? "Αποτυχία εξαγωγής: " + String(err) : "Export failed: " + String(err));
    }
  }

  function openForEdit(r: Recipe) {
    loadRecipe(r);
  }

  // Bulk import: reads a flat .xlsx/.csv where each row is one
  // (recipe, ingredient) pair — exactly the shape of a real recipe
  // catalog export, where a 5-ingredient recipe appears as 5 rows
  // sharing the same recipe name. Handles files with hundreds or
  // thousands of rows in a small, fixed number of network calls
  // (see bulkImportRecipesWithIngredients in supabaseData.ts) rather
  // than one call per recipe, which would be impractically slow for
  // a genuinely large catalog.
  async function handleBulkImport() {
    if (!bulkFile) return;
    setBulkImporting(true);
    setBulkMsg(null);
    try {
      const table = await parseSpreadsheetFile(bulkFile);
      const objs = rowsToObjects(table);
      if (objs.length === 0) {
        setBulkMsg({ kind: "err", text: locale === "gr" ? "Το αρχείο είναι κενό ή μη αναγνώσιμο." : "File is empty or unreadable." });
        return;
      }

      const rows: db.RecipeImportRow[] = [];
      for (const row of objs) {
        const recipeName = pick(row, ["recipename", "όνομασυνταγής", "ονομασυνταγης", "recipe", "συνταγή", "συνταγη"]);
        const ingredientName = pick(row, ["ingredient", "υλικό", "υλικο", "είδος", "ειδος"]);
        if (!recipeName || !ingredientName) continue;
        rows.push({
          recipeName,
          category: pick(row, ["category", "κατηγορία", "κατηγορια"]) || null,
          portions: pick(row, ["portions", "μερίδες", "μεριδες"]) || "1",
          ingredientName,
          quantity: pick(row, ["quantity", "ποσότητα", "ποσοτητα"]) || "0",
          unit: pick(row, ["unit", "μονάδαμέτρησης", "μονάδα", "μεμ"]) || "kg",
          instructions: pick(row, ["instructions", "οδηγίες", "οδηγιες"]) || null,
        });
      }

      if (rows.length === 0) {
        setBulkMsg({
          kind: "err",
          text: locale === "gr"
            ? "⚠️ Δεν αναγνωρίστηκαν στήλες συνταγής/υλικού. Ελέγξτε ότι οι επικεφαλίδες λένε \"Όνομα Συνταγής\" και \"Υλικό\"."
            : "⚠️ No recipe/ingredient columns were recognized. Check that the headers read \"Όνομα Συνταγής\" and \"Υλικό\".",
        });
        return;
      }

      const result = await db.bulkImportRecipesWithIngredients(rows);
      await refreshAll();

      const skippedNote = result.recipesSkipped.length > 0
        ? (locale === "gr"
            ? ` (${result.recipesSkipped.length} συνταγές παραλείφθηκαν λόγω μηδενικών υλικών: ${result.recipesSkipped.slice(0, 5).join(", ")}${result.recipesSkipped.length > 5 ? "…" : ""})`
            : ` (${result.recipesSkipped.length} recipes skipped for having no ingredient rows: ${result.recipesSkipped.slice(0, 5).join(", ")}${result.recipesSkipped.length > 5 ? "…" : ""})`)
        : "";

      setBulkMsg({
        kind: "ok",
        text: locale === "gr"
          ? `✅ ${result.recipesCreated} συνταγές δημιουργήθηκαν, ${result.ingredientLinesInserted} γραμμές υλικών, ${result.ingredientsCreated} νέα υλικά προστέθηκαν στο μητρώο.${skippedNote}`
          : `✅ ${result.recipesCreated} recipes created, ${result.ingredientLinesInserted} ingredient lines, ${result.ingredientsCreated} new ingredients added to the register.${skippedNote}`,
      });
      setTimeout(() => { setShowBulkImport(false); setBulkMsg(null); setBulkFile(null); }, 3500);
    } catch (err) {
      setBulkMsg({ kind: "err", text: locale === "gr" ? "Αποτυχία εισαγωγής: " + String(err) : "Import failed: " + String(err) });
    } finally {
      setBulkImporting(false);
    }
  }

  const recipeTotalPages = Math.max(1, Math.ceil(recipes.length / RECIPE_PAGE_SIZE));
  const recipeSafePage = Math.min(recipePage, recipeTotalPages);
  const paginatedRecipes = recipes.slice((recipeSafePage - 1) * RECIPE_PAGE_SIZE, recipeSafePage * RECIPE_PAGE_SIZE);

  return (
    <div>
      {/* Όλο το περιεχόμενο εκτός popup — κρύβεται ΤΕΛΕΙΩΣ (display:none)
          στην εκτύπωση, ώστε η κρυμμένη λίστα συνταγών να μην πιάνει χώρο
          και να μη δημιουργεί άδειες σελίδες. */}
      <div className="print:hidden">
      <PageHeader title={t("headerRecipe")} subtitle="Interactive Recipe Composition / Φόρμα Συνταγής">
        <button onClick={() => setListView((v) => !v)} className={listView ? "erp-btn-primary" : "erp-btn-secondary"}>
          📊 {listView ? (locale === "gr" ? "Κανονική Προβολή" : "Normal View") : (locale === "gr" ? "Προβολή Λίστας" : "List View")}
        </button>
        <button onClick={newRecipe} className="erp-btn-primary">➕ {t("btnNewRecipe")}</button>
        <button onClick={() => setShowBulkImport(true)} className="erp-btn-success">📥 {locale === "gr" ? "Μαζική Εισαγωγή Excel" : "Bulk Import Excel"}</button>
      </PageHeader>

      {listView ? (
        <div className="erp-card">
          <div className="erp-card-header flex items-center justify-between">
            <h3 className="font-semibold">📋 {locale === "gr" ? "Αρχείο Συνταγών" : "Recipe Archive"} — {recipes.length} {locale === "gr" ? "συνταγές" : "recipes"}</h3>
            <div className="flex items-center gap-3">
              {selectedIds.size > 0 && (
                <>
                  <Badge color="blue">{selectedIds.size} {locale === "gr" ? "επιλεγμένες" : "selected"}</Badge>
                  <button onClick={deleteSelected} disabled={bulkDeleting} className="erp-btn-danger text-xs px-3 py-1.5">
                    {bulkDeleting ? "…" : "🗑️"} {locale === "gr" ? "Διαγραφή Επιλεγμένων" : "Delete Selected"}
                  </button>
                </>
              )}
              <button onClick={exportRecipesExcel} className="erp-btn-secondary text-xs px-3 py-1.5">
                📊 {selectedIds.size > 0
                  ? (locale === "gr" ? `Εξαγωγή Επιλεγμένων (${selectedIds.size})` : `Export Selected (${selectedIds.size})`)
                  : (locale === "gr" ? "Εξαγωγή Excel (Λίστα)" : "Export Excel (List)")}
              </button>
              <button onClick={exportRecipesFormsToExcel} className="erp-btn-secondary text-xs px-3 py-1.5" title={locale === "gr" ? "Μία πλήρης φόρμα συνταγής ανά φύλλο Excel" : "One full recipe form per Excel sheet"}>
                📑 {locale === "gr" ? "Εξαγωγή Φορμών (ανά φύλλο)" : "Export Forms (per sheet)"}
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="erp-table">
              <thead>
                <tr>
                  <th className="w-10">
                    <input
                      type="checkbox"
                      checked={recipes.length > 0 && selectedIds.size === recipes.length}
                      onChange={toggleSelectAll}
                      className="w-4 h-4"
                    />
                  </th>
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
                  <tr><td colSpan={7} className="text-center py-8 text-slate-400">{t("noData")}</td></tr>
                ) : paginatedRecipes.map((r, idx) => (
                  <tr key={r?.id ?? `recipe-row-${idx}`} className={selectedIds.has(r.id) ? "bg-blue-50/50" : ""}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(r.id)}
                        onChange={() => toggleSelect(r.id)}
                        className="w-4 h-4"
                      />
                    </td>
                    <td className="cursor-pointer hover:text-blue-600 font-medium" onClick={() => openForEdit(r)}>
                      {r?.name ?? "—"}
                      {r?.nameEn && <div className="text-xs text-slate-400 font-normal">{r.nameEn}</div>}
                    </td>
                    <td>€{Number(r?.totalRawMaterialCost ?? 0).toFixed(2)}</td>
                    <td className="font-semibold text-emerald-700">€{Number(r?.sellingPrice ?? 0).toFixed(2)}</td>
                    <td>{r?.portionYield} {r?.portionUnit}</td>
                    <td><Badge color="amber">{r?.profitMarginPercent}%</Badge></td>
                    <td>
                      <button onClick={(e) => { e.stopPropagation(); r?.id && deleteRecipe(r.id); }} disabled={deletingId === r?.id} className="text-red-400 hover:text-red-600 text-xs">
                        {deletingId === r?.id ? "…" : t("btnDelete")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {recipes.length > RECIPE_PAGE_SIZE && (
            <div className="flex items-center justify-between px-4 py-3 border-t text-sm">
              <div className="text-slate-500">
                {locale === "gr" ? `Σελίδα ${recipeSafePage} από ${recipeTotalPages}` : `Page ${recipeSafePage} of ${recipeTotalPages}`}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setRecipePage((p) => Math.max(1, p - 1))}
                  disabled={recipeSafePage <= 1}
                  className="erp-btn-secondary text-xs px-3 py-1.5 disabled:opacity-40"
                >
                  ← {locale === "gr" ? "Προηγούμενη" : "Previous"}
                </button>
                <button
                  onClick={() => setRecipePage((p) => Math.min(recipeTotalPages, p + 1))}
                  disabled={recipeSafePage >= recipeTotalPages}
                  className="erp-btn-secondary text-xs px-3 py-1.5 disabled:opacity-40"
                >
                  {locale === "gr" ? "Επόμενη" : "Next"} →
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
      <div className="flex gap-6">
        {/* Recipe List */}
        <div className="w-full">
          <div className="erp-card">
            <div className="erp-card-header"><h3 className="font-semibold">📋 {locale === "gr" ? "Αρχείο Συνταγών" : "Recipe Archive"}</h3></div>
            <div className="divide-y max-h-[600px] overflow-y-auto">
              {recipes.length === 0 ? <div className="p-8 text-center text-slate-400">{t("noData")}</div> :
                recipes.map((r, idx) => (
                  <div key={r?.id ?? `recipe-${idx}`} className={`p-4 cursor-pointer hover:bg-blue-50/50 transition-colors ${selectedRecipe?.id === r?.id ? "bg-blue-50 border-l-4 border-blue-500" : ""}`} onClick={() => openForEdit(r)}>
                    <div className="font-medium">{r?.name ?? "—"}</div>
                    {r?.nameEn && <div className="text-xs text-slate-400">{r.nameEn}</div>}
                    <div className="flex items-center gap-2 mt-1">
                      <Badge color="blue">{r?.portionYield} {r?.portionUnit}</Badge>
                      <Badge color="green">€{Number(r?.totalCost ?? 0).toFixed(2)}</Badge>
                      <Badge color="amber">{r?.profitMarginPercent}%</Badge>
                    </div>
                    <button onClick={e => { e.stopPropagation(); r?.id && deleteRecipe(r.id); }} disabled={deletingId === r?.id} className="text-red-400 hover:text-red-600 text-xs mt-2">
                      {deletingId === r?.id ? "…" : t("btnDelete")}
                    </button>
                  </div>
                ))}
            </div>
          </div>
        </div>
      </div>
      )}
      </div>

      {/* Recipe Form Modal — ανοίγει με κλικ πάνω σε μια συνταγή ή στο
          "Νέα Συνταγή", αντί για ενσωματωμένο πάνελ. */}
      <Modal
        isOpen={editing}
        onClose={() => setEditing(false)}
        title={selectedRecipe ? (locale === "gr" ? "Επεξεργασία Συνταγής" : "Edit Recipe") : (locale === "gr" ? "Νέα Συνταγή" : "New Recipe")}
        size="full"
      >
        <div id="printable-recipe-area">
          {/* Print CSS — συμπυκνώνει τη συνταγή ώστε να χωράει σε 1
              σελίδα εκτύπωσης αντί για 2-3, και σπάει έξω από τους
              περιορισμούς ύψους/overflow του Modal ώστε να μην κόβεται
              περιεχόμενο. */}
          <style>{`
            @media print {
              body * { visibility: hidden; }
              #printable-recipe-area, #printable-recipe-area * { visibility: visible; }
              .fixed.inset-0.z-50 { position: static !important; display: block !important; padding: 0 !important; }
              .backdrop-blur-sm { display: none !important; }
              .relative.bg-white.rounded-2xl {
                position: static !important; box-shadow: none !important; max-height: none !important;
                width: 100% !important; margin: 0 !important; border-radius: 0 !important;
              }
              .flex-1.overflow-y-auto.p-6 { overflow: visible !important; padding: 0 !important; flex: none !important; }
              #plating-gallery-section { display: none !important; }
              #printable-recipe-area .erp-card {
                margin-bottom: 4px !important; box-shadow: none !important;
                border: 1px solid #e2e8f0 !important; page-break-inside: avoid;
              }
              #printable-recipe-area .erp-card-header { padding: 3px 10px !important; }
              #printable-recipe-area .p-6 { padding: 8px !important; }
              #printable-recipe-area, #printable-recipe-area * { font-size: 12.5px !important; line-height: 1.3 !important; }
              #printable-recipe-area .erp-label { font-size: 10px !important; margin-bottom: 0 !important; color: #64748b !important; }
              #printable-recipe-area h3 { font-size: 14px !important; }
              #printable-recipe-area input, #printable-recipe-area select, #printable-recipe-area textarea {
                border: none !important; padding: 1px 0 !important; background: transparent !important;
                height: auto !important; min-height: 0 !important;
              }
              #printable-recipe-area .erp-table th, #printable-recipe-area .erp-table td { padding: 2px 4px !important; }
              #printable-recipe-area .gap-4 { gap: 4px !important; }
              #printable-recipe-area .mb-4, #printable-recipe-area .mb-6 { margin-bottom: 3px !important; }
              @page { size: A4; margin: 8mm; }
            }
          `}</style>
          <div className="flex flex-wrap items-center gap-2 mb-4 print:hidden">
            <button onClick={saveRecipe} disabled={saving} className="erp-btn-success">{saving ? "…" : "💾"} {t("btnSaveRecipe")}</button>
            <button onClick={calculateCosting} className="erp-btn-secondary">🧮 {locale === "gr" ? "Υπολογισμός Κόστους" : "Calculate Costing"}</button>
            <button onClick={() => setShowSearch(true)} className="erp-btn-secondary">🔍 {t("btnSearchRestore")}</button>
            <button onClick={() => window.print()} className="erp-btn-secondary">🖨️ {t("btnPrint")} / PDF</button>
            {selectedRecipe && (
              <button onClick={exportRecipeToExcel} className="erp-btn-secondary">📊 {locale === "gr" ? "Εξαγωγή Excel" : "Export Excel"}</button>
            )}
          </div>

          <div className="erp-card mb-6">
            <div className="erp-card-header"><h3 className="font-semibold">👨‍🍳 {locale === "gr" ? "Στοιχεία Συνταγής" : "Recipe Details"}</h3></div>
            <div className="p-6">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                <div className="col-span-2"><label className="erp-label">{locale === "gr" ? "Ελληνική Ονομασία" : "Greek Name"}</label><input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="erp-input" /></div>
                <div className="col-span-2"><label className="erp-label">English Name</label><input type="text" value={form.nameEn} onChange={e => setForm({ ...form, nameEn: e.target.value })} className="erp-input" /></div>
                <div><label className="erp-label">{t("fieldPortionYield")}</label><input type="number" value={form.portionYield} onChange={e => setForm({ ...form, portionYield: e.target.value })} className="erp-input" step="0.1" /></div>
                <div><label className="erp-label">{t("fieldUnit")}</label>
                  <select value={form.portionUnit} onChange={e => setForm({ ...form, portionUnit: e.target.value })} className="erp-select">
                    <option value="pcs">{locale === "gr" ? "Μερίδες" : "Portions"}</option><option value="L">L</option><option value="kg">kg</option>
                  </select>
                </div>
                <div><label className="erp-label">{locale === "gr" ? "Κόστος Εργασίας" : "Labor Cost"}</label><input type="number" value={form.laborCost} onChange={e => setForm({ ...form, laborCost: e.target.value })} className="erp-input" step="0.01" /></div>
                <div><label className="erp-label">{locale === "gr" ? "Γενικά Έξοδα" : "Overhead Cost"}</label><input type="number" value={form.overheadCost} onChange={e => setForm({ ...form, overheadCost: e.target.value })} className="erp-input" step="0.01" /></div>
                <div><label className="erp-label">{locale === "gr" ? "Περιθώριο Κέρδους %" : "Profit Margin %"}</label><input type="number" value={form.profitMarginPercent} onChange={e => setForm({ ...form, profitMarginPercent: e.target.value })} className="erp-input" step="1" /></div>
                <div><label className="erp-label">{locale === "gr" ? "Θερμίδες / Μερίδα" : "Calories / Portion"}</label><input type="number" value={form.caloriesPerPortion} onChange={e => setForm({ ...form, caloriesPerPortion: e.target.value })} className="erp-input" step="1" /></div>
                <div>
                  <label className="erp-label">{locale === "gr" ? "Γραμμάρια / Μερίδα" : "Grams / Portion"}</label>
                  <input type="number" value={form.gramsPerPortion} onChange={e => setForm({ ...form, gramsPerPortion: e.target.value })} className="erp-input" step="1" />
                  {recipeItems.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setForm(prev => ({ ...prev, gramsPerPortion: computedGramsPerPortion.toFixed(0) }))}
                      className="mt-1.5 w-full flex items-center justify-between gap-2 px-3 py-2 bg-amber-50 border border-amber-300 rounded-lg text-sm font-semibold text-amber-800 hover:bg-amber-100 transition-colors"
                    >
                      <span>
                        {locale === "gr" ? "Υπολογισμένο από τα υλικά:" : "Computed from ingredients:"}{" "}
                        {computedGramsPerPortion.toFixed(0)} g
                      </span>
                      <span className="text-xs underline">{locale === "gr" ? "Χρήση αυτού" : "Use this"}</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Allergens */}
              <div className="mb-4">
                <label className="erp-label">{t("fieldAllergens")}</label>
                <div className="flex flex-wrap gap-2">
                  {ALLERGEN_LIST.map(a => (
                    <button key={a} onClick={() => setForm((prev) => ({
                      ...prev,
                      allergens: prev.allergens.includes(a) ? prev.allergens.filter((x) => x !== a) : [...prev.allergens, a],
                    }))} className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${form.allergens.includes(a) ? "bg-red-500 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
                      {a}
                    </button>
                  ))}
                </div>
              </div>

              {/* Technical Guide */}
              <div className="mb-4">
                <label className="erp-label">{t("fieldTechnicalGuide")}</label>
                <textarea value={form.technicalGuide} onChange={e => setForm({ ...form, technicalGuide: e.target.value })} className="erp-input min-h-[120px] font-mono text-sm" placeholder={locale === "gr" ? "Βήμα 1: ... Βήμα 2: ..." : "Step 1: ... Step 2: ..."} />
              </div>

              {/* Costing Summary */}
              <div className="grid grid-cols-2 sm:grid-cols-6 gap-3 bg-slate-50 rounded-lg p-4">
                <div><div className="text-xs text-slate-500">{locale === "gr" ? "Κόστος Υλικών" : "Raw Material Cost"}</div><div className="font-bold">€{Number(form.totalRawMaterialCost).toFixed(2)}</div></div>
                <div><div className="text-xs text-slate-500">{locale === "gr" ? "Συνολικό Κόστος" : "Total Cost"}</div><div className="font-bold">€{Number(form.totalCost).toFixed(2)}</div></div>
                <div><div className="text-xs text-slate-500">{locale === "gr" ? "Τιμή Πώλησης" : "Selling Price"}</div><div className="font-bold text-emerald-700">€{Number(form.sellingPrice).toFixed(2)}</div></div>
                <div><div className="text-xs text-slate-500">{locale === "gr" ? "Τιμή Μενού (ΦΠΑ)" : "Menu Price (VAT)"}</div><div className="font-bold text-blue-700">€{Number(form.menuPriceVat).toFixed(2)}</div></div>
                <div><div className="text-xs text-slate-500">{locale === "gr" ? `Συνολικά Γραμμάρια (${targetPortions || 0} μερ.)` : `Total Grams (${targetPortions || 0} ptn)`}</div><div className="font-bold">{(Number(form.gramsPerPortion) * Number(targetPortions || form.portionYield || 1)).toFixed(0)} g</div></div>
                <div><div className="text-xs text-slate-500">{locale === "gr" ? `Κόστος Υλικών (${targetPortions || 0} μερ.)` : `Raw Cost (${targetPortions || 0} ptn)`}</div><div className="font-bold">€{((Number(form.totalRawMaterialCost) / (Number(form.portionYield || 1) || 1)) * Number(targetPortions || 0)).toFixed(2)}</div></div>
              </div>
            </div>
          </div>

          {/* Ingredient Matrix — ενοποιημένη ξανά μέσα στη φόρμα
              συνταγής, κατόπιν ρητού αιτήματος του χρήστη. */}
          {selectedRecipe && (
            <div className="erp-card mb-6">
              <div className="erp-card-header flex flex-col gap-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h3 className="font-semibold">🧂 {locale === "gr" ? "Υλικά Συνταγής" : "Recipe Ingredients"}</h3>
                  <div className="flex items-center gap-1 text-xs bg-blue-50 rounded-lg px-2 py-1.5">
                    <span className="text-slate-500">{locale === "gr" ? "Υπολογισμός για" : "Calculate for"}</span>
                    <input
                      type="number" value={targetPortions}
                      onChange={(e) => setTargetPortions(e.target.value)}
                      className="erp-input text-xs py-1 w-16 text-center" step="any"
                    />
                    <span className="text-slate-500">{locale === "gr" ? "μερίδες" : "portions"}</span>
                  </div>
                  {recipeItems.length > 0 && (
                    <button
                      type="button"
                      onClick={refreshAllPrices}
                      disabled={refreshingPrices}
                      className="erp-btn-secondary text-xs py-1.5"
                      title={locale === "gr" ? "Ξαναφέρνει την πραγματική τιμή για όλα τα υλικά αυτής της συνταγής" : "Re-fetches the real price for every ingredient in this recipe"}
                    >
                      {refreshingPrices ? "…" : "🔄"} {locale === "gr" ? "Ανανέωση Τιμών" : "Refresh Prices"}
                    </button>
                  )}
                  {priceRefreshMsg && (
                    <span className="text-xs font-semibold text-emerald-700">{priceRefreshMsg}</span>
                  )}
                </div>
                {/* Ξεχωριστή γραμμή, ΟΧΙ μέσα στο ίδιο flex-wrap row με τα
                    παραπάνω -- όταν τίτλος/μερίδες/κουμπί/μήνυμα μαζί δεν
                    χωρούσαν σε μία γραμμή, αυτό το κουτί "τυλιγόταν" σε
                    απρόβλεπτη θέση και το αναδυόμενο dropdown αποτελεσμάτων
                    (που είναι απόλυτα τοποθετημένο ΚΑΤΩ από αυτό) εμφανιζόταν
                    "κρεμασμένο" κάπου αλλού στη σελίδα, χωρίς να φαίνεται
                    καθόλου το ίδιο το πλαίσιο αναζήτησης. Με δική του γραμμή,
                    έχει πάντα σταθερό, προβλέψιμο πλάτος. */}
                <div className="relative flex items-center gap-1.5" ref={ingredientSearchRef}>
                  <select
                    value={ingredientUnitFilter}
                    onChange={(e) => { setIngredientUnitFilter(e.target.value); setShowIngredientSearch(true); }}
                    className="erp-select text-xs py-1.5 w-20"
                    title={t("filterUnit")}
                  >
                    <option value="">{locale === "gr" ? "Μονάδα" : "Unit"}</option>
                    {ingredientUnits.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                  <input
                    type="text"
                    value={ingredientSearchTerm}
                    onChange={(e) => { setIngredientSearchTerm(e.target.value); setShowIngredientSearch(true); }}
                    onFocus={() => setShowIngredientSearch(true)}
                    placeholder={locale === "gr" ? "🔍 Αναζήτηση υλικού…" : "🔍 Search ingredient…"}
                    className="erp-input text-xs py-1.5 w-56"
                    autoComplete="off"
                  />
                  {/* top-full παρακάτω είναι απαραίτητο, ΟΧΙ προαιρετικό στολίδι:
                      αυτό το div είναι flex item μέσα στο "flex items-center"
                      γονικό div (μαζί με το select και το input) -- χωρίς ρητό
                      top, ένα absolute στοιχείο πέφτει στη "στατική" θέση του
                      ΜΕΣΑ στη σειρά flex (δηλ. δίπλα στο input, όχι από κάτω),
                      γι' αυτό εμφανιζόταν "κρεμασμένο" πάνω από τον πίνακα
                      αντί ακριβώς κάτω από το πλαίσιο αναζήτησης. */}
                  {/* right-0 (όχι left-0): το πλαίσιο αναζήτησης είναι το ΔΕΞΙ
                      στοιχείο της σειράς (Μονάδα, μετά αναζήτηση) -- με left-0
                      το dropdown άνοιγε κάτω από το "Μονάδα" (αριστερά), μακριά
                      από το σημείο που κοιτάει/γράφει ο χρήστης, ειδικά τώρα
                      που είναι πιο φαρδύ. Με right-0 ευθυγραμμίζεται με το
                      δεξί άκρο του πλαισίου αναζήτησης. */}
                  {showIngredientSearch && (ingredientSearchTerm.trim() || ingredientUnitFilter) && (
                    <div className="absolute right-0 top-full z-30 mt-1 w-[30rem] max-w-[90vw] max-h-[28rem] overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-2xl">
                      {ingredientSearchResults.length === 0 ? (
                        <div className="px-4 py-4 text-sm text-slate-400 text-center">
                          {locale === "gr" ? "Δεν βρέθηκαν υλικά" : "No ingredients found"}
                        </div>
                      ) : (
                        <table className="w-full text-sm">
                          <tbody>
                            {ingredientSearchResults.map((ing) => (
                              <tr
                                key={ing.id}
                                onClick={() => addIngredientToRecipe(ing)}
                                className="cursor-pointer hover:bg-blue-50 border-b border-slate-50"
                              >
                                <td className="px-4 py-2.5">
                                  <div className="font-medium text-slate-700">{locale === "gr" ? ing.name : (ing.nameEn || ing.name)}</div>
                                  <div className="flex items-center gap-2 flex-wrap text-xs">
                                    <span className="text-slate-400">{ing.sku}</span>
                                    {(() => {
                                      const rp = resultPrices[ing.id];
                                      if (rp === "loading" || rp === undefined) {
                                        return <span className="text-slate-300">…</span>;
                                      }
                                      if (rp === "error") {
                                        return <span className="text-slate-400">€{Number(ing.basePrice).toFixed(2)}/{ing.unit}</span>;
                                      }
                                      if (rp.priceSource === "none") {
                                        return (
                                          <span className="text-amber-600 font-semibold">
                                            ⚠️ {locale === "gr" ? "χωρίς τιμή" : "no price"}
                                          </span>
                                        );
                                      }
                                      return (
                                        <span className="text-emerald-600 font-semibold">
                                          ✅ €{rp.unitCost.toFixed(2)}/{rp.unit}
                                        </span>
                                      );
                                    })()}
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="erp-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th className="min-w-[220px]">{t("fieldProduct")}</th>
                      <th className="min-w-[160px]">{t("fieldQuantity")}</th>
                      <th className="min-w-[80px]">{t("fieldUnit")}</th>
                      <th>{locale === "gr" ? "Τιμή Μερίδας" : "Portion Price"}</th>
                      <th>{locale === "gr" ? `Ποσότητα (${targetPortions || 0} μερ.)` : `Qty (${targetPortions || 0} ptn)`}</th>
                      <th>{locale === "gr" ? `Κόστος (${targetPortions || 0} μερ.)` : `Cost (${targetPortions || 0} ptn)`}</th>
                      <th>{locale === "gr" ? "Σύνολο" : "Total"}</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {recipeItems.length === 0 ? (
                      <tr><td colSpan={9} className="text-center py-6 text-slate-400">{t("noData")}</td></tr>
                    ) : recipeItems.filter((item): item is typeof item & { id: number } => item.id != null).map((item, i) => {
                      const toggleable = isWeightUnit(item.unit);
                      const displayUnit = toggleable ? (rowUnitDisplay[item.id] || (item.unit.toLowerCase() as "kg" | "g")) : item.unit;
                      const dispQty = toggleable ? convertQty(Number(item.quantity || 0), item.unit, displayUnit) : Number(item.quantity || 0);
                      const dispBatchQty = toggleable ? convertQty(batchQtyBase(item), item.unit, displayUnit) : batchQtyBase(item);
                      return (
                        <tr key={item.id} className={savingIngredientRowId === item.id ? "opacity-50" : ""}>
                          <td className="text-xs text-slate-400">{i + 1}</td>
                          <td className="min-w-[220px] font-medium">{item.ingredientName}</td>
                          <td>
                            <input
                              key={displayUnit}
                              type="number" defaultValue={dispQty}
                              onBlur={(e) => {
                                const displayVal = Number(e.target.value);
                                const baseVal = toggleable ? convertQty(displayVal, displayUnit, item.unit) : displayVal;
                                updateIngredientRow(item.id, "quantity", Number(baseVal.toFixed(4)));
                              }}
                              className="erp-input text-xs py-1 w-24" style={{ minWidth: "6rem" }} step="0.001"
                            />
                          </td>
                          <td>
                            {toggleable ? (
                              <select
                                value={displayUnit}
                                onChange={(e) => setRowUnitDisplay(prev => ({ ...prev, [item.id]: e.target.value as "kg" | "g" }))}
                                className="erp-input text-xs py-1 w-16"
                              >
                                <option value="kg">kg</option>
                                <option value="g">g</option>
                              </select>
                            ) : (
                              // Μονάδες εκτός kg/g (π.χ. ΤΕΜ, L, ml) δεν είχαν
                              // ΚΑΝΕΝΑ τρόπο διόρθωσης -- έμεναν σαν απλό,
                              // μη-επεξεργάσιμο κείμενο. Τώρα είναι πάντα
                              // επεξεργάσιμο πεδίο, ώστε να διορθώνεται
                              // χειροκίνητα μια λάθος μονάδα (π.χ. από
                              // παλιά/χαλασμένη εισαγωγή δεδομένων).
                              <input
                                key={item.unit}
                                type="text"
                                defaultValue={item.unit}
                                onBlur={(e) => {
                                  const newUnit = e.target.value.trim();
                                  if (newUnit && newUnit !== item.unit) updateIngredientRow(item.id, "unit", newUnit);
                                }}
                                className="erp-input text-xs py-1 w-16"
                              />
                            )}
                          </td>
                          <td>€{pricePerPortion(item).toFixed(3)}</td>
                          <td>{dispBatchQty.toFixed(toggleable && displayUnit === "g" ? 0 : 3)} {displayUnit}</td>
                          <td className="font-semibold">€{batchPrice(item).toFixed(2)}</td>
                          <td className="font-semibold">€{Number(item.totalCost).toFixed(2)}</td>
                          <td>
                            <button onClick={() => deleteIngredientRow(item.id)} disabled={savingIngredientRowId === item.id} className="text-red-400 hover:text-red-600">
                              {savingIngredientRowId === item.id ? "…" : "✕"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {!selectedRecipe && (
            <div className="erp-card mb-6 p-6 text-center text-sm text-slate-400">
              {locale === "gr"
                ? "Αποθήκευσε πρώτα τη συνταγή (💾 Αποθήκευση Συνταγής) για να εμφανιστεί εδώ ο πίνακας υλικών και να μπορείς να προσθέσεις υλικά."
                : "Save the recipe first (💾 Save Recipe) — the ingredients table will appear here once it's saved."}
            </div>
          )}

          {/* Plating Gallery — κρύβεται στην εκτύπωση (κενά placeholders,
              δεν έχει νόημα να τυπώνονται). */}
          <div id="plating-gallery-section" className="erp-card">
            <div className="erp-card-header"><h3 className="font-semibold">📸 {t("fieldPlating")}</h3></div>
            <div className="p-6">
              {!selectedRecipe && (
                <div className="text-xs text-slate-400 mb-2">
                  {locale === "gr" ? "Αποθήκευσε πρώτα τη συνταγή για να μπορείς να ανεβάσεις φωτογραφίες." : "Save the recipe first to upload photos."}
                </div>
              )}
              <div className="grid grid-cols-3 gap-4">
                {[0, 1, 2].map((slot) => {
                  let images: string[] = [];
                  try { images = JSON.parse(form.platingImages || "[]"); } catch { images = []; }
                  const url = images[slot];
                  return (
                    <div key={slot}>
                      <input
                        type="file" accept="image/*" id={`plating-slot-${slot}`} className="hidden"
                        disabled={!selectedRecipe || uploadingSlot !== null}
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPlatingImage(slot, f); e.target.value = ""; }}
                      />
                      {url ? (
                        <div className="relative">
                          <img src={url} alt={`plating-${slot}`} className="w-full h-32 object-cover rounded-xl border border-slate-200" />
                          <button type="button" onClick={() => removePlatingImage(slot)} className="absolute top-1 right-1 bg-white/90 text-red-500 rounded-full w-6 h-6 text-xs shadow">✕</button>
                        </div>
                      ) : (
                        <label
                          htmlFor={`plating-slot-${slot}`}
                          className={`border-2 border-dashed border-slate-300 rounded-xl p-8 text-center hover:border-blue-400 transition-colors flex flex-col items-center justify-center h-32 ${selectedRecipe ? "cursor-pointer" : "cursor-not-allowed opacity-50"}`}
                        >
                          <div className="text-3xl mb-2">{uploadingSlot === slot ? "…" : "📷"}</div>
                          <div className="text-xs text-slate-400">
                            {uploadingSlot === slot ? (locale === "gr" ? "Ανεβαίνει…" : "Uploading…") : (locale === "gr" ? `Εικόνα ${slot + 1}` : `Image ${slot + 1}`)}
                          </div>
                        </label>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </Modal>

      {/* Search Modal */}
      <Modal isOpen={showSearch} onClose={() => setShowSearch(false)} title={t("btnSearchRestore")} size="lg">
        <input type="text" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder={t("filterSearch")} className="erp-input mb-4" />
        <div className="space-y-2 max-h-[300px] overflow-y-auto">
          {recipes.filter(r => {
            if (!searchTerm) return true;
            const q = searchTerm.toLowerCase();
            return r?.name?.toLowerCase().includes(q) || (r?.nameEn && r.nameEn.toLowerCase().includes(q));
          }).map((r, idx) => (
            <div key={r?.id ?? `search-${idx}`} onClick={() => { loadRecipe(r); setShowSearch(false); }} className="p-3 rounded-lg hover:bg-blue-50 cursor-pointer flex items-center justify-between">
              <div><div className="font-medium">{r?.name ?? "—"}</div><div className="text-xs text-slate-400">{r?.nameEn}</div></div>
              <Badge color="green">€{Number(r?.totalCost ?? 0).toFixed(2)}</Badge>
            </div>
          ))}
        </div>
      </Modal>

      {/* Bulk Import Modal */}
      <Modal
        isOpen={showBulkImport}
        onClose={() => { if (!bulkImporting) { setShowBulkImport(false); setBulkMsg(null); setBulkFile(null); } }}
        title={locale === "gr" ? "Μαζική Εισαγωγή Συνταγών" : "Bulk Recipe Import"}
        size="lg"
      >
        <div className="space-y-4">
          {bulkMsg && (
            <div className={`p-3 rounded-lg text-sm ${bulkMsg.kind === "ok" ? "bg-emerald-50 border border-emerald-300 text-emerald-800" : "bg-red-50 border border-red-300 text-red-800"}`}>
              {bulkMsg.text}
            </div>
          )}

          <div
            onClick={() => bulkFileInputRef.current?.click()}
            className="border-2 border-dashed border-slate-300 rounded-xl p-8 text-center hover:border-blue-400 transition-colors cursor-pointer"
          >
            <div className="text-4xl mb-3">📄</div>
            <div className="font-medium text-slate-700">
              {bulkFile ? bulkFile.name : (locale === "gr" ? "Κάντε κλικ για επιλογή αρχείου Excel/CSV" : "Click to select an Excel/CSV file")}
            </div>
            <div className="text-xs text-slate-400 mt-2">
              {locale === "gr"
                ? "Στήλες: Όνομα Συνταγής, Κατηγορία, Μερίδες, Υλικό, Ποσότητα, Μονάδα Μέτρησης, Οδηγίες"
                : "Columns: Recipe Name, Category, Portions, Ingredient, Quantity, Unit, Instructions"}
            </div>
            <input
              ref={bulkFileInputRef} type="file" accept=".csv,.xlsx,.xls,.ods,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              onChange={(e) => setBulkFile(e.target.files?.[0] ?? null)} className="hidden"
            />
          </div>

          <div className="text-xs text-slate-400 bg-slate-50 rounded-lg p-3">
            {locale === "gr" ? (
              <>
                <strong>Πώς λειτουργεί:</strong> κάθε γραμμή του αρχείου αντιστοιχεί σε ένα (συνταγή, υλικό) ζευγάρι — μια συνταγή με 6 υλικά εμφανίζεται ως 6 γραμμές με το ίδιο &quot;Όνομα Συνταγής&quot;. Τα υλικά αντιστοιχίζονται στο υπάρχον Μητρώο Υλικών βάσει ονόματος· αν δεν βρεθεί αντιστοιχία, δημιουργείται αυτόματα νέο υλικό. Υποστηρίζει αρχεία με χιλιάδες γραμμές.
              </>
            ) : (
              <>
                <strong>How it works:</strong> each row in the file is one (recipe, ingredient) pair — a recipe with 6 ingredients appears as 6 rows sharing the same &quot;Recipe Name&quot;. Ingredients are matched against the existing Ingredients Register by name; unmatched ones are created automatically. Supports files with thousands of rows.
              </>
            )}
          </div>

          <div className="flex gap-2 pt-2">
            <button onClick={handleBulkImport} disabled={!bulkFile || bulkImporting} className="erp-btn-success">
              {bulkImporting ? (locale === "gr" ? "Εισαγωγή…" : "Importing…") : "📥 " + (locale === "gr" ? "Εισαγωγή" : "Import")}
            </button>
            <button onClick={() => { setShowBulkImport(false); setBulkMsg(null); setBulkFile(null); }} disabled={bulkImporting} className="erp-btn-ghost">
              {t("btnCancel")}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
