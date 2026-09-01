"use client";
import { useState } from "react";
import { useApp } from "@/lib/context";
import { PageHeader, KpiCard, Modal, Badge } from "@/components/shared";
import { RoleGuard } from "@/components/RoleGuard";
import type { AppUser, UserRole } from "@/lib/types";
import { parseSpreadsheetFile, rowsToObjects, pick, parsePrice } from "@/lib/csv";
import * as db from "@/lib/supabaseData";

const ROLE_OPTIONS: { value: UserRole; label: string; labelEn: string }[] = [
  { value: "admin", label: "Διαχειριστής", labelEn: "Administrator" },
  { value: "chef", label: "Σεφ / Κουζίνα", labelEn: "Chef / Kitchen" },
  { value: "storekeeper", label: "Αποθηκάριος", labelEn: "Storekeeper" },
];

export default function UserManagementPage() {
  const { t, locale, users, currentUser, data, refreshAll } = useApp();
  // Role edit
  const [editingUser, setEditingUser] = useState<AppUser | null>(null);
  const [savingRole, setSavingRole] = useState(false);
  // Delete confirmation
  const [confirmDeleteUser, setConfirmDeleteUser] = useState<AppUser | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Bulk ingestion row
  const [ingestMsg, setIngestMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);

  const usersSafe: AppUser[] = Array.isArray(users) ? users : [];

  async function changeRole(user: AppUser, role: UserRole) {
    if (!confirm(t("confirmRoleChange"))) return;
    setSavingRole(true);
    try {
      await db.updateUserRole(user.id, role);
      await refreshAll();
      setEditingUser(null);
    } catch (err) {
      alert(locale === "gr" ? "Αποτυχία αλλαγής ρόλου: " + String(err) : "Failed to change role: " + String(err));
    } finally {
      setSavingRole(false);
    }
  }

  function requestDelete(user: AppUser) {
    setConfirmDeleteUser(user);
  }

  async function confirmDelete() {
    if (!confirmDeleteUser) return;
    setDeleting(true);
    try {
      await db.deleteUser(confirmDeleteUser.id);
      await refreshAll();
      setConfirmDeleteUser(null);
    } catch (err) {
      alert(locale === "gr" ? "Αποτυχία διαγραφής: " + String(err) : "Failed to delete: " + String(err));
    } finally {
      setDeleting(false);
    }
  }

  // ---- Bulk ingestion: file inputs -> populate suppliers/ingredients/recipes in Supabase ----

  async function logIngestion(fileName: string, fileType: string, parsed: number, inserted: number, status: string, errors?: string) {
    try {
      await db.logIngestion({ fileName, fileType, recordsParsed: parsed, recordsInserted: inserted, status, errors: errors ?? null });
    } catch {
      // Logging failures shouldn't block the user from seeing their import result.
    }
  }

  async function handleSuppliersUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading("suppliers");
    try {
      const table = await parseSpreadsheetFile(file);
      const objs = rowsToObjects(table);
      if (objs.length === 0) {
        setIngestMsg({ kind: "err", text: locale === "gr" ? "Το αρχείο είναι κενό ή μη αναγνώσιμο." : "File is empty or unreadable." });
        await logIngestion(file.name, "suppliers", 0, 0, "failed", "Empty or unreadable file");
        return;
      }
      let inserted = 0;
      for (const row of objs) {
        const name = pick(row, ["name", "supplier", "suppliername", "onoma"]);
        if (!name) continue;
        const nameEn = pick(row, ["nameen", "englishname", "name_en"]);
        const contactEmail = pick(row, ["email", "contactemail"]);
        const contactPhone = pick(row, ["phone", "contactphone", "tel"]);
        const address = pick(row, ["address", "dieuthinsi"]);
        const category = pick(row, ["category", "kategoria"]) || "Produce";
        await db.createSupplier({ name, nameEn: nameEn || null, contactEmail: contactEmail || null, contactPhone: contactPhone || null, address: address || null, category });
        inserted++;
      }
      await refreshAll();
      if (inserted === 0) {
        setIngestMsg({ kind: "err", text: locale === "gr" ? `⚠️ Δεν βρέθηκε καμία αναγνωρίσιμη στήλη ονόματος στο ${file.name} — καμία εγγραφή δεν εισήχθη.` : `⚠️ No recognizable name column found in ${file.name} — nothing was imported.` });
        await logIngestion(file.name, "suppliers", objs.length, 0, "no_matches");
      } else {
        setIngestMsg({ kind: "ok", text: locale === "gr" ? `✅ ${inserted} προμηθευτές εισήχθησαν από ${file.name}` : `✅ ${inserted} suppliers imported from ${file.name}` });
        await logIngestion(file.name, "suppliers", objs.length, inserted, "completed");
      }
    } catch (err) {
      setIngestMsg({ kind: "err", text: locale === "gr" ? "Αποτυχία ανάγνωσης αρχείου: " + String(err) : "Failed to read file: " + String(err) });
      await logIngestion(file.name, "suppliers", 0, 0, "failed", String(err));
    } finally {
      setUploading(null);
    }
  }

  // Εισαγωγή προσφορών από ΠΟΛΛΑΠΛΟΥΣ προμηθευτές σε ένα ενιαίο CSV/XLSX: κάθε
  // γραμμή φέρει τη δική της στήλη "supplier". Ο προμηθευτής κάθε γραμμής
  // αναγνωρίζεται (case-insensitive match στο όνομα, βάσει των ήδη
  // φορτωμένων `data.suppliers`) ή δημιουργείται στο Supabase αν δεν
  // υπάρχει ήδη.
  async function handleMultiSupplierOffersUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading("supplier_offers");
    try {
      const table = await parseSpreadsheetFile(file);
      const objs = rowsToObjects(table);
      if (objs.length === 0) {
        setIngestMsg({ kind: "err", text: locale === "gr" ? "Το αρχείο είναι κενό ή μη αναγνώσιμο." : "File is empty or unreadable." });
        await logIngestion(file.name, "supplier_offers", 0, 0, "failed", "Empty or unreadable file");
        return;
      }
      let inserted = 0;
      let suppliersCreated = 0;
      // Local working copy of the supplier-name -> id map, seeded from
      // already-loaded data and extended as new suppliers are created
      // mid-loop (so row 50 can find a supplier created by row 3).
      const supplierByName = new Map<string, number>();
      for (const s of data.suppliers) supplierByName.set(s.name.toLowerCase(), s.id);

      const newProducts: { supplierId: number; productName: string; category: string; unit: string; basePrice: string; qualityGrade: string | null; regionOfOrigin: string | null }[] = [];

      for (const row of objs) {
        const productName = pick(row, ["name", "product", "productname", "onoma", "proion", "όνομα", "είδος", "προϊόν", "προϊον"]);
        const supplierName = pick(row, ["supplier", "suppliername", "promitheutis", "προμηθευτής", "προμηθευτησ"]);
        if (!productName || !supplierName) continue;

        let supplierId = supplierByName.get(supplierName.toLowerCase());
        if (supplierId === undefined) {
          const email = pick(row, ["supplieremail", "email", "contactemail"]);
          const created = await db.createSupplier({ name: supplierName, nameEn: null, contactEmail: email || null, contactPhone: null, address: null, category: "Produce" });
          supplierId = created.id;
          supplierByName.set(supplierName.toLowerCase(), supplierId);
          suppliersCreated++;
        }

        const unit = pick(row, ["unit", "monada", "unitofmeasure", "uom", "measure", "measurementunit", "μονάδα", "μονάδαμέτρησης", "μεμ"]) || "kg";
        const price = parsePrice(pick(row, ["price", "baseprice", "timi", "τιμή"]));
        const grade = pick(row, ["grade", "qualitygrade", "poiotita", "ποιότητα", "ποιοτικήκατηγορία"]) || null;
        const region = pick(row, ["region", "regionoforigin", "perioxi", "περιοχή", "περιοχήπροέλευσης"]) || null;

        newProducts.push({ supplierId, productName, category: "Produce", unit, basePrice: price, qualityGrade: grade, regionOfOrigin: region });
        inserted++;
      }

      if (newProducts.length > 0) {
        await db.createSupplierProductsBulk(newProducts);
      }
      await refreshAll();

      if (inserted === 0) {
        setIngestMsg({ kind: "err", text: locale === "gr" ? `⚠️ Δεν βρέθηκαν αναγνωρίσιμες στήλες προϊόντος/προμηθευτή στο ${file.name} — καμία εγγραφή δεν εισήχθη.` : `⚠️ No recognizable product/supplier columns found in ${file.name} — nothing was imported.` });
        await logIngestion(file.name, "supplier_offers", objs.length, 0, "no_matches");
      } else {
        setIngestMsg({ kind: "ok", text: locale === "gr" ? `✅ ${inserted} προσφορές εισήχθησαν από ${file.name} (${suppliersCreated} νέοι προμηθευτές δημιουργήθηκαν)` : `✅ ${inserted} offers imported from ${file.name} (${suppliersCreated} new suppliers created)` });
        await logIngestion(file.name, "supplier_offers", objs.length, inserted, "completed");
      }
    } catch (err) {
      setIngestMsg({ kind: "err", text: locale === "gr" ? "Αποτυχία ανάγνωσης αρχείου: " + String(err) : "Failed to read file: " + String(err) });
      await logIngestion(file.name, "supplier_offers", 0, 0, "failed", String(err));
    } finally {
      setUploading(null);
    }
  }

  async function handleIngredientsUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading("ingredients");
    try {
      const table = await parseSpreadsheetFile(file);
      const objs = rowsToObjects(table);
      if (objs.length === 0) {
        setIngestMsg({ kind: "err", text: locale === "gr" ? "Το αρχείο είναι κενό ή μη αναγνώσιμο." : "File is empty or unreadable." });
        await logIngestion(file.name, "ingredients", 0, 0, "failed", "Empty or unreadable file");
        return;
      }
      const rows: { sku: string; name: string; nameEn: string | null; currentStock: string; unit: string; basePrice: string; wastageFactor: string; calories: number }[] = [];
      let skuCounter = data.ingredients.length + 1;
      for (const row of objs) {
        const name = pick(row, ["name", "ingredient", "onoma", "όνομα", "είδος", "υλικό", "υλικο"]);
        if (!name) continue;
        const sku = pick(row, ["sku", "code", "kodikos", "κωδικός", "κωδικος"]) || `ING-${String(skuCounter).padStart(4, "0")}`;
        const nameEn = pick(row, ["nameen", "englishname"]);
        const unit = pick(row, ["unit", "monada", "unitofmeasure", "uom", "measure", "measurementunit", "μονάδα", "μονάδαμέτρησης", "μεμ"]) || "kg";
        const basePrice = parsePrice(pick(row, ["price", "baseprice", "timi", "τιμή"]));
        const currentStock = pick(row, ["stock", "currentstock", "apothema", "απόθεμα", "απoθεμα"]) || "0";
        const wastageFactor = pick(row, ["wastage", "wastagefactor", "fyra", "φύρα", "φυρα"]) || "0";
        const calories = Number(pick(row, ["calories", "thermides", "θερμίδες", "θερμιδεσ"]) || "0");
        rows.push({ sku, name, nameEn: nameEn || null, currentStock, unit, basePrice, wastageFactor, calories: Number.isFinite(calories) ? calories : 0 });
        skuCounter++;
      }
      const inserted = rows.length > 0 ? await db.createIngredientsBulk(rows) : 0;
      await refreshAll();
      if (inserted === 0) {
        setIngestMsg({ kind: "err", text: locale === "gr" ? `⚠️ Δεν βρέθηκε καμία αναγνωρίσιμη στήλη ονόματος στο ${file.name} — καμία εγγραφή δεν εισήχθη.` : `⚠️ No recognizable name column found in ${file.name} — nothing was imported.` });
        await logIngestion(file.name, "ingredients", objs.length, 0, "no_matches");
      } else {
        setIngestMsg({ kind: "ok", text: locale === "gr" ? `✅ ${inserted} υλικά εισήχθησαν από ${file.name}` : `✅ ${inserted} ingredients imported from ${file.name}` });
        await logIngestion(file.name, "ingredients", objs.length, inserted, "completed");
      }
    } catch (err) {
      setIngestMsg({ kind: "err", text: locale === "gr" ? "Αποτυχία ανάγνωσης αρχείου: " + String(err) : "Failed to read file: " + String(err) });
      await logIngestion(file.name, "ingredients", 0, 0, "failed", String(err));
    } finally {
      setUploading(null);
    }
  }

  async function handleRecipesUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading("recipes");
    try {
      const table = await parseSpreadsheetFile(file);
      const objs = rowsToObjects(table);
      if (objs.length === 0) {
        setIngestMsg({ kind: "err", text: locale === "gr" ? "Το αρχείο είναι κενό ή μη αναγνώσιμο." : "File is empty or unreadable." });
        await logIngestion(file.name, "recipes", 0, 0, "failed", "Empty or unreadable file");
        return;
      }
      const rows: { name: string; nameEn: string | null; portionYield: string; totalCost: string; sellingPrice: string; profitMarginPercent: string }[] = [];
      for (const row of objs) {
        const name = pick(row, ["name", "recipe", "onoma", "όνομα", "συνταγή", "συνταγη"]);
        if (!name) continue;
        const nameEn = pick(row, ["nameen", "englishname"]);
        const portionYield = pick(row, ["portionyield", "yield", "portions", "μερίδες", "μεριδεσ"]) || "1";
        const totalCost = parsePrice(pick(row, ["totalcost", "cost", "kostos", "κόστος", "κοστοσ"])) || "0";
        const sellingPrice = parsePrice(pick(row, ["sellingprice", "price", "timi", "τιμή"])) || "0";
        const profitMarginPercent = pick(row, ["profitmargin", "margin", "perithorio", "περιθώριο", "περιθωριο"]) || "60";
        rows.push({ name, nameEn: nameEn || null, portionYield, totalCost, sellingPrice, profitMarginPercent });
      }
      const inserted = rows.length > 0 ? await db.createRecipesBulk(rows) : 0;
      await refreshAll();
      if (inserted === 0) {
        setIngestMsg({ kind: "err", text: locale === "gr" ? `⚠️ Δεν βρέθηκε καμία αναγνωρίσιμη στήλη ονόματος στο ${file.name} — καμία εγγραφή δεν εισήχθη.` : `⚠️ No recognizable name column found in ${file.name} — nothing was imported.` });
        await logIngestion(file.name, "recipes", objs.length, 0, "no_matches");
      } else {
        setIngestMsg({ kind: "ok", text: locale === "gr" ? `✅ ${inserted} συνταγές εισήχθησαν από ${file.name}` : `✅ ${inserted} recipes imported from ${file.name}` });
        await logIngestion(file.name, "recipes", objs.length, inserted, "completed");
      }
    } catch (err) {
      setIngestMsg({ kind: "err", text: locale === "gr" ? "Αποτυχία ανάγνωσης αρχείου: " + String(err) : "Failed to read file: " + String(err) });
      await logIngestion(file.name, "recipes", 0, 0, "failed", String(err));
    } finally {
      setUploading(null);
    }
  }

  // Σύνδεση Υλικών-Συνταγών: διαβάζει ένα flat CSV/XLSX όπου κάθε γραμμή
  // είναι ένα ζεύγος (συνταγή, υλικό), ομαδοποιεί κατά όνομα συνταγής, και
  // για κάθε ομάδα είτε ενημερώνει μια υπάρχουσα συνταγή (αντικαθιστά τα
  // υλικά της μέσω upsertRecipe) είτε δημιουργεί νέα.
  async function handleRecipeIngredientsUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading("recipe_ingredients");
    try {
      const table = await parseSpreadsheetFile(file);
      const objs = rowsToObjects(table);
      if (objs.length === 0) {
        setIngestMsg({ kind: "err", text: locale === "gr" ? "Το αρχείο είναι κενό ή μη αναγνώσιμο." : "File is empty or unreadable." });
        await logIngestion(file.name, "recipe_ingredients", 0, 0, "failed", "Empty or unreadable file");
        return;
      }

      const groups = new Map<string, { recipeName: string; rows: Record<string, string>[] }>();
      const groupOrder: string[] = [];
      for (const row of objs) {
        const recipeName = pick(row, ["recipe", "recipename", "onomasyntagis", "συνταγή", "συνταγη"]);
        const ingredientName = pick(row, ["ingredient", "ingredientname", "ylika", "υλικό", "υλικο", "είδος", "ειδος"]);
        if (!recipeName || !ingredientName) continue;
        const key = recipeName.toLowerCase();
        if (!groups.has(key)) {
          groups.set(key, { recipeName, rows: [] });
          groupOrder.push(key);
        }
        groups.get(key)!.rows.push(row);
      }

      if (groups.size === 0) {
        setIngestMsg({ kind: "err", text: locale === "gr" ? `⚠️ Δεν βρέθηκαν αναγνωρίσιμες στήλες συνταγής/υλικού στο ${file.name} — καμία εγγραφή δεν εισήχθη.` : `⚠️ No recognizable recipe/ingredient columns found in ${file.name} — nothing was imported.` });
        await logIngestion(file.name, "recipe_ingredients", objs.length, 0, "no_matches");
        return;
      }

      let recipesUpdated = 0;
      let recipesCreated = 0;
      let ingredientLinesInserted = 0;

      const ingredientByName = new Map(data.ingredients.map((ing) => [ing.name.toLowerCase(), ing]));
      const recipeByName = new Map(data.recipes.map((r) => [r.name.toLowerCase(), r]));

      for (const key of groupOrder) {
        const group = groups.get(key)!;
        const ingredientsForRecipe = group.rows.map((row) => {
          const ingredientName = pick(row, ["ingredient", "ingredientname", "ylika", "υλικό", "υλικο", "είδος", "ειδος"]);
          const matchedIngredient = ingredientByName.get(ingredientName.toLowerCase());
          const quantity = Number(parsePrice(pick(row, ["quantity", "posotita", "posotites", "ποσότητα", "ποσοτητα"])));
          const unit = pick(row, ["unit", "monada", "monades", "μονάδα", "μονάδαμέτρησης", "μεμ"]) || matchedIngredient?.unit || "kg";
          const rawUnitCost = pick(row, ["unitcost", "kostosmonada", "τιμήμονάδας", "κόστοςμονάδας"]);
          const unitCost = rawUnitCost ? Number(parsePrice(rawUnitCost)) : Number(matchedIngredient?.basePrice ?? "0");
          const rawTotalCost = pick(row, ["totalcost", "synolikokostos", "συνολικόκόστος"]);
          const totalCost = rawTotalCost ? Number(parsePrice(rawTotalCost)) : Number((quantity * unitCost).toFixed(4));
          ingredientLinesInserted++;
          return {
            ingredientId: matchedIngredient?.id ?? 0,
            ingredientName,
            quantity,
            unit,
            unitCost,
            totalCost,
            wastageFactor: matchedIngredient ? Number(matchedIngredient.wastageFactor) : 0,
            requiresPrep: false,
            prepNotes: "",
          };
        });

        const existing = recipeByName.get(key);
        const totalCost = ingredientsForRecipe.reduce((s, i) => s + i.totalCost, 0);
        if (existing) {
          await db.upsertRecipe({ ...existing, ingredients: ingredientsForRecipe });
          recipesUpdated++;
        } else {
          await db.upsertRecipe({
            name: group.recipeName, nameEn: null, portionYield: "1", portionUnit: "pcs",
            allergens: JSON.stringify([]), technicalGuide: null,
            totalRawMaterialCost: totalCost.toFixed(4), laborCost: "0", overheadCost: "0",
            totalCost: totalCost.toFixed(4), profitMarginPercent: "60",
            sellingPrice: (totalCost / 0.4).toFixed(4), menuPriceVat: ((totalCost / 0.4) * 1.24).toFixed(4),
            menuPriceFinal: (totalCost / 0.4).toFixed(4), isActive: true, ingredients: ingredientsForRecipe,
          });
          recipesCreated++;
        }
      }

      await refreshAll();
      setIngestMsg({
        kind: "ok",
        text: locale === "gr"
          ? `✅ ${ingredientLinesInserted} γραμμές υλικών εισήχθησαν σε ${recipesUpdated + recipesCreated} συνταγές (${recipesCreated} νέες, ${recipesUpdated} ενημερώθηκαν)`
          : `✅ ${ingredientLinesInserted} ingredient lines imported across ${recipesUpdated + recipesCreated} recipes (${recipesCreated} new, ${recipesUpdated} updated)`,
      });
      await logIngestion(file.name, "recipe_ingredients", objs.length, ingredientLinesInserted, "completed");
    } catch (err) {
      setIngestMsg({ kind: "err", text: locale === "gr" ? "Αποτυχία ανάγνωσης αρχείου: " + String(err) : "Failed to read file: " + String(err) });
      await logIngestion(file.name, "recipe_ingredients", 0, 0, "failed", String(err));
    } finally {
      setUploading(null);
    }
  }

  const roleBadgeColor = (role: string) => {
    if (role === "admin") return "blue";
    if (role === "chef") return "green";
    return "amber";
  };

  const roleLabel = (role: string) => {
    const opt = ROLE_OPTIONS.find((r) => r.value === role);
    return opt ? (locale === "gr" ? opt.label : opt.labelEn) : role;
  };

  return (
    <RoleGuard adminOnly>
      <div>
        <PageHeader
          title={t("headerUserManagement")}
          subtitle={locale === "gr" ? "Διαχείριση Χρηστών, Ρόλων & Μαζική Εισαγωγή Δεδομένων" : "User, Role & Bulk Data Import Management"}
        />

        {/* New users join via sign-up, not an admin-created form — Supabase
            Auth owns account creation (email + password), and the
            schema.sql trigger creates their public.users profile row
            automatically the moment they sign up. */}
        <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-xl text-sm text-blue-800">
          {locale === "gr"
            ? "💡 Οι νέοι χρήστες δημιουργούν λογαριασμό μόνοι τους από την οθόνη σύνδεσης (Εγγραφή). Μόλις εγγραφούν, εμφανίζονται εδώ με προεπιλεγμένο ρόλο «Σεφ» — αλλάξτε τον ρόλο τους παρακάτω όπως χρειάζεται."
            : "💡 New users create their own account from the sign-in screen (Sign Up). Once they do, they appear here with a default \"Chef\" role — change their role below as needed."}
        </div>

        {/* Bulk File Ingestion Utility Row */}
        <div className="erp-card mb-6">
          <div className="erp-card-header">
            <h3 className="font-semibold">📥 {locale === "gr" ? "Μαζική Εισαγωγή Δεδομένων (.csv, .xlsx)" : "Bulk Data Ingestion (.csv, .xlsx)"}</h3>
          </div>
          <div className="p-6">
            {ingestMsg && (
              <div className={`mb-4 p-3 rounded-lg text-sm font-medium ${ingestMsg.kind === "ok" ? "bg-emerald-50 border border-emerald-300 text-emerald-800" : "bg-red-50 border border-red-300 text-red-800"}`}>
                {ingestMsg.text}
              </div>
            )}
            <p className="text-xs text-slate-500 mb-4">
              {locale === "gr"
                ? "Δέχεται αρχεία .csv, .xlsx και .xls απευθείας. Οι στήλες αντιστοιχίζονται αυτόματα βάσει επικεφαλίδων (ελληνικών ή αγγλικών)."
                : "Accepts .csv, .xlsx, and .xls files directly. Columns are auto-mapped from headers (Greek or English)."}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <label className={`border-2 border-dashed border-slate-300 rounded-xl p-5 text-center hover:border-blue-400 transition-colors cursor-pointer block ${uploading ? "opacity-50 pointer-events-none" : ""}`}>
                <div className="text-3xl mb-2">🏢</div>
                <div className="font-medium text-sm text-slate-700">
                  {locale === "gr" ? "Πίνακας Προμηθευτών" : "Suppliers Matrix"}
                </div>
                <div className="text-xs text-slate-400 mt-1">{uploading === "suppliers" ? (locale === "gr" ? "Εισαγωγή…" : "Importing…") : "(.csv, .xlsx)"}</div>
                <input type="file" accept=".csv,.xlsx,.xls,text/csv" onChange={handleSuppliersUpload} className="hidden" disabled={!!uploading} />
              </label>
              <label className={`border-2 border-dashed border-slate-300 rounded-xl p-5 text-center hover:border-indigo-400 transition-colors cursor-pointer block ${uploading ? "opacity-50 pointer-events-none" : ""}`}>
                <div className="text-3xl mb-2">💹</div>
                <div className="font-medium text-sm text-slate-700">
                  {locale === "gr" ? "Προσφορές Πολλαπλών Προμηθευτών" : "Multi-Supplier Offers"}
                </div>
                <div className="text-xs text-slate-400 mt-1">
                  {uploading === "supplier_offers" ? (locale === "gr" ? "Εισαγωγή…" : "Importing…") : (locale === "gr" ? "(στήλη 'supplier')" : "('supplier' column)")}
                </div>
                <input type="file" accept=".csv,.xlsx,.xls,text/csv" onChange={handleMultiSupplierOffersUpload} className="hidden" disabled={!!uploading} />
              </label>
              <label className={`border-2 border-dashed border-slate-300 rounded-xl p-5 text-center hover:border-emerald-400 transition-colors cursor-pointer block ${uploading ? "opacity-50 pointer-events-none" : ""}`}>
                <div className="text-3xl mb-2">🥘</div>
                <div className="font-medium text-sm text-slate-700">
                  {locale === "gr" ? "Μητρώο Υλικών" : "Master Ingredients Register"}
                </div>
                <div className="text-xs text-slate-400 mt-1">{uploading === "ingredients" ? (locale === "gr" ? "Εισαγωγή…" : "Importing…") : "(.csv, .xlsx)"}</div>
                <input type="file" accept=".csv,.xlsx,.xls,text/csv" onChange={handleIngredientsUpload} className="hidden" disabled={!!uploading} />
              </label>
              <label className={`border-2 border-dashed border-slate-300 rounded-xl p-5 text-center hover:border-amber-400 transition-colors cursor-pointer block ${uploading ? "opacity-50 pointer-events-none" : ""}`}>
                <div className="text-3xl mb-2">👨‍🍳</div>
                <div className="font-medium text-sm text-slate-700">
                  {locale === "gr" ? "Κατάλογος Συνταγών" : "Recipes Catalog"}
                </div>
                <div className="text-xs text-slate-400 mt-1">{uploading === "recipes" ? (locale === "gr" ? "Εισαγωγή…" : "Importing…") : "(.csv, .xlsx)"}</div>
                <input type="file" accept=".csv,.xlsx,.xls,text/csv" onChange={handleRecipesUpload} className="hidden" disabled={!!uploading} />
              </label>
            </div>
            <div className="mt-3">
              <label className={`border-2 border-dashed border-slate-300 rounded-xl p-4 flex items-center gap-3 hover:border-purple-400 transition-colors cursor-pointer ${uploading ? "opacity-50 pointer-events-none" : ""}`}>
                <div className="text-2xl">🔗</div>
                <div className="flex-1 text-left">
                  <div className="font-medium text-sm text-slate-700">{locale === "gr" ? "Σύνδεση Υλικών σε Συνταγές" : "Link Ingredients to Recipes"}</div>
                  <div className="text-xs text-slate-400">{uploading === "recipe_ingredients" ? (locale === "gr" ? "Εισαγωγή…" : "Importing…") : (locale === "gr" ? "(στήλες 'recipe' + 'ingredient')" : "('recipe' + 'ingredient' columns)")}</div>
                </div>
                <input type="file" accept=".csv,.xlsx,.xls,text/csv" onChange={handleRecipeIngredientsUpload} className="hidden" disabled={!!uploading} />
              </label>
            </div>
          </div>
        </div>

        {/* Access Control Summary */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <KpiCard label={t("roleAdmin")} value={usersSafe.filter((u) => u.role === "admin").length} color="blue" icon="👑"
            subtitle={locale === "gr" ? "Πλήρης πρόσβαση σε όλα" : "Full access to everything"} />
          <KpiCard label={t("roleChef")} value={usersSafe.filter((u) => u.role === "chef").length} color="green" icon="👨‍🍳"
            subtitle={locale === "gr" ? "Συνταγές, φωτογραφίες, prep" : "Recipes, photos, prep lists"} />
          <KpiCard label={t("roleStorekeeper")} value={usersSafe.filter((u) => u.role === "storekeeper").length} color="amber" icon="📦"
            subtitle={locale === "gr" ? "Απογραφή, παραγγελίες, τιμολόγια" : "Inventory, orders, invoices"} />
        </div>

        {/* Users Table */}
        <div className="erp-card mb-6">
          <div className="erp-card-header">
            <h3 className="font-semibold">👥 {locale === "gr" ? "Πίνακας Χρηστών" : "User Table"} — {t("roleAdmin")}</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="erp-table">
              <thead>
                <tr>
                  <th>{t("fieldName")}</th>
                  <th>Email</th>
                  <th>{t("fieldRole")}</th>
                  <th>{t("fieldIsActive")}</th>
                  <th>{t("actions")}</th>
                </tr>
              </thead>
              <tbody>
                {usersSafe.length === 0 ? (
                  <tr><td colSpan={5} className="text-center py-8 text-slate-400">{t("noData")}</td></tr>
                ) : (
                  usersSafe.map((user, idx) => (
                    <tr key={user?.id ?? `user-${idx}`}>
                      <td className="font-medium">{user?.name ?? "—"}</td>
                      <td className="text-sm text-slate-600">{user?.email ?? "—"}</td>
                      <td>
                        {editingUser?.id === user?.id ? (
                          <select
                            value={editingUser?.role ?? "chef"}
                            onChange={(e) => setEditingUser(editingUser ? { ...editingUser, role: e.target.value as UserRole } : null)}
                            className="erp-select text-xs py-1 w-40"
                            disabled={savingRole}
                          >
                            {ROLE_OPTIONS.map((r) => (
                              <option key={r.value} value={r.value}>{locale === "gr" ? r.label : r.labelEn}</option>
                            ))}
                          </select>
                        ) : (
                          <Badge color={roleBadgeColor(user?.role ?? "chef")}>{roleLabel(user?.role ?? "chef")}</Badge>
                        )}
                      </td>
                      <td>{user?.isActive ? <Badge color="green">✓</Badge> : <Badge color="red">✕</Badge>}</td>
                      <td>
                        <div className="flex gap-1 flex-wrap">
                          {editingUser?.id === user?.id ? (
                            <>
                              <button onClick={() => user && changeRole(user, editingUser?.role ?? user.role)} disabled={savingRole} className="erp-btn-success text-xs px-2 py-1">
                                {savingRole ? "…" : "💾"}
                              </button>
                              <button onClick={() => setEditingUser(null)} disabled={savingRole} className="erp-btn-ghost text-xs px-2 py-1">✕</button>
                            </>
                          ) : (
                            <button onClick={() => user && setEditingUser({ ...user })} className="erp-btn-secondary text-xs px-2 py-1">
                              ⚙️ {locale === "gr" ? "Αλλαγή" : "Edit"}
                            </button>
                          )}
                          <button
                            onClick={() => user && requestDelete(user)}
                            disabled={user?.id === currentUser?.id}
                            title={user?.id === currentUser?.id ? (locale === "gr" ? "Δεν μπορείτε να διαγράψετε τον εαυτό σας" : "You cannot delete yourself") : undefined}
                            className="erp-btn-danger text-xs px-2 py-1"
                          >
                            🗑️ {locale === "gr" ? "Διαγραφή Χρήστη" : "Delete User"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Access Rights Matrix */}
        <div className="erp-card mb-6">
          <div className="erp-card-header">
            <h3 className="font-semibold">🔐 {locale === "gr" ? "Πίνακας Δικαιωμάτων Πρόσβασης" : "Access Rights Matrix"}</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="erp-table">
              <thead>
                <tr>
                  <th>{locale === "gr" ? "Λειτουργία" : "Feature"}</th>
                  <th className="text-center"><Badge color="blue">{t("roleAdmin")}</Badge></th>
                  <th className="text-center"><Badge color="green">{t("roleChef")}</Badge></th>
                  <th className="text-center"><Badge color="amber">{t("roleStorekeeper")}</Badge></th>
                </tr>
              </thead>
              <tbody>
                {[
                  { feature: locale === "gr" ? "Τιμές & Προμηθευτές" : "Prices & Suppliers", admin: "✓", chef: "✕", keeper: "✓" },
                  { feature: locale === "gr" ? "Οικονομικά (Κόστολόγηση, Περιθώρια)" : "Financials (Costing, Margins)", admin: "✓", chef: "✕", keeper: "✕" },
                  { feature: locale === "gr" ? "Συνταγές & Παρουσίαση" : "Recipes & Plating", admin: "✓", chef: "✓", keeper: "✕" },
                  { feature: locale === "gr" ? "Λίστες Prep" : "Prep Lists", admin: "✓", chef: "✓", keeper: "✕" },
                  { feature: locale === "gr" ? "Απογραφή Αποθέματος" : "Inventory Count", admin: "✓", chef: "✕", keeper: "✓" },
                  { feature: locale === "gr" ? "Παραγγελίες & Τιμολόγια" : "Orders & Invoices", admin: "✓", chef: "✕", keeper: "✓" },
                  { feature: locale === "gr" ? "Διαχείριση Χρηστών" : "User Management", admin: "✓", chef: "✕", keeper: "✕" },
                ].map((row, i) => (
                  <tr key={i}>
                    <td className="font-medium">{row.feature}</td>
                    <td className="text-center text-emerald-600 font-bold text-lg">{row.admin}</td>
                    <td className="text-center">{row.chef === "✓" ? <span className="text-emerald-600 font-bold text-lg">✓</span> : <span className="text-red-400">✕</span>}</td>
                    <td className="text-center">{row.keeper === "✓" ? <span className="text-emerald-600 font-bold text-lg">✓</span> : <span className="text-red-400">✕</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Ingestion History */}
        <div className="erp-card">
          <div className="erp-card-header">
            <h3 className="font-semibold">📜 {t("ingestionHistory")}</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="erp-table">
              <thead>
                <tr>
                  <th>{locale === "gr" ? "Αρχείο" : "File"}</th>
                  <th>{locale === "gr" ? "Τύπος" : "Type"}</th>
                  <th>{locale === "gr" ? "Αναλύθηκαν" : "Parsed"}</th>
                  <th>{locale === "gr" ? "Εισήχθησαν" : "Inserted"}</th>
                  <th>{t("fieldStatus")}</th>
                  <th>{locale === "gr" ? "Ημερομηνία" : "Date"}</th>
                </tr>
              </thead>
              <tbody>
                {data.ingestionLogs.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-8 text-slate-400">{t("noData")}</td></tr>
                ) : data.ingestionLogs.map((log) => (
                  <tr key={log.id}>
                    <td className="font-medium">{log.fileName}</td>
                    <td><Badge color={log.fileType === "recipes" ? "green" : log.fileType === "ingredients" ? "amber" : "blue"}>{log.fileType}</Badge></td>
                    <td>{log.recordsParsed.toLocaleString()}</td>
                    <td className="font-semibold text-emerald-700">{log.recordsInserted.toLocaleString()}</td>
                    <td><Badge color={log.status === "completed" ? "green" : log.status === "failed" ? "red" : "amber"}>{log.status}</Badge></td>
                    <td className="text-sm">{new Date(log.createdAt).toLocaleDateString("el-GR")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Delete User Confirmation Modal */}
        <Modal isOpen={!!confirmDeleteUser} onClose={() => setConfirmDeleteUser(null)} title={locale === "gr" ? "Διαγραφή Χρήστη" : "Delete User"} size="sm">
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              {locale === "gr"
                ? `Είστε σίγουροι ότι θέλετε να διαγράψετε τον χρήστη "${confirmDeleteUser?.name}"; Αυτή η ενέργεια δεν μπορεί να αναιρεθεί.`
                : `Are you sure you want to delete user "${confirmDeleteUser?.name}"? This action cannot be undone.`}
            </p>
            <div className="flex gap-2">
              <button onClick={confirmDelete} disabled={deleting} className="erp-btn-danger">{deleting ? "…" : "🗑️"} {locale === "gr" ? "Διαγραφή" : "Delete"}</button>
              <button onClick={() => setConfirmDeleteUser(null)} disabled={deleting} className="erp-btn-ghost">{t("btnCancel")}</button>
            </div>
          </div>
        </Modal>
      </div>
    </RoleGuard>
  );
}
