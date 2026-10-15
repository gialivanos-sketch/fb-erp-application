import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

// ----------------------------------------------------------------
// POST /api/import-recipes
// Body: JSON array of recipe objects extracted from the xlsm file.
// Each recipe:
//   { name, portions, instructions, allergens, ingredients: [{name, qty, unit}] }
//
// The route:
//  1. Fetches all existing ingredient names from DB (for fuzzy matching).
//  2. For each recipe, inserts a `recipes` row.
//  3. For each ingredient, tries to find a matching `ingredients` row.
//     - Exact match (case-insensitive) → use ingredient_id + ingredient_name
//     - No match                       → ingredient_id = null, ingredient_name as-is
//  4. Inserts all `recipe_ingredients` rows.
//  5. Returns a summary { created, skipped, unmatchedIngredients }.
// ----------------------------------------------------------------

function buildClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient<Database>(url, key);
}

// Normalize a string for fuzzy matching: lowercase, collapse spaces,
// strip parenthetical suffixes like "(2500)" that appear in xlsm names.
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/\(.*?\)/g, "")   // remove (…) clauses
    .replace(/[_\-\/\\]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Map allergen icon filename → canonical allergen tag used by the app.
const ALLERGEN_MAP: Record<string, string> = {
  "ΑΥΓΑ": "ΑΥΓΑ", "04EGGS": "ΑΥΓΑ",
  "ΓΑΛΑ": "ΓΑΛΑ", "12MILK": "ΓΑΛΑ", "MILK": "ΓΑΛΑ",
  "ΓΛΟΥΤΕΝΗ": "ΓΛΟΥΤΕΝΗ", "18GLUTEN": "ΓΛΟΥΤΕΝΗ",
  "ΘΕΙΩΔΗ": "ΘΕΙΩΔΗ", "05SULFITES": "ΘΕΙΩΔΗ",
  "ΜΟΥΣΤΑΡΔΑ": "ΜΟΥΣΤΑΡΔΑ", "11MUSTARD": "ΜΟΥΣΤΑΡΔΑ",
  "ΞΗΡΟΙ ΚΑΡΠΟΙ": "ΞΗΡΟΙ ΚΑΡΠΟΙ", "07NUTS": "ΞΗΡΟΙ ΚΑΡΠΟΙ",
  "ΣΕΛΕΡΥ": "ΣΕΛΕΡΥ", "01SELERY": "ΣΕΛΕΡΥ",
  "ΣΟΥΣΑΜΙ": "ΣΟΥΣΑΜΙ", "13SESAME": "ΣΟΥΣΑΜΙ",
  "ΨΑΡΙ": "ΨΑΡΙ", "16FISH": "ΨΑΡΙ",
  "ΘΑΛΑΣΣΙΝΑ": "ΘΑΛΑΣΣΙΝΑ", "02CRUSTACEAN": "ΘΑΛΑΣΣΙΝΑ",
  "ΜΑΛΑΚΙΑ": "ΜΑΛΑΚΙΑ", "09MOLLUSCS": "ΜΑΛΑΚΙΑ",
  "ΣΟΓΙΑ": "ΣΟΓΙΑ", "08SOY": "ΣΟΓΙΑ",
  "12MILKEGGS": "ΓΑΛΑ",
};

function mapAllergens(raw: string[]): string[] {
  const out = new Set<string>();
  for (const a of raw) {
    const mapped = ALLERGEN_MAP[a.toUpperCase()];
    if (mapped) out.add(mapped);
  }
  return Array.from(out);
}

// Unit normalization: map xlsm units → app units
function normalizeUnit(u: string): string {
  const base = u.replace(/\s*\(.*\)/, "").trim().toUpperCase();
  const MAP: Record<string, string> = {
    "ΓΡΑΜΜΑΡΙΑ": "ΓΡΑΜΜΑΡΙΑ", "ΓΡΑΜΜΑΡΙΟ": "ΓΡΑΜΜΑΡΙΑ", "GR": "ΓΡΑΜΜΑΡΙΑ", "G": "ΓΡΑΜΜΑΡΙΑ",
    "ΚΙΛΟ": "ΚΙΛΟ", "KG": "ΚΙΛΟ",
    "ΛΙΤΡΟ": "ΛΙΤΡΟ", "LT": "ΛΙΤΡΟ", "L": "ΛΙΤΡΟ",
    "ML": "ML",
    "ΤΕΜΑΧΙΟ": "ΤΕΜΑΧΙΟ", "ΤΕΜ": "ΤΕΜΑΧΙΟ", "TEMAXIO": "ΤΕΜΑΧΙΟ", "TEM": "ΤΕΜΑΧΙΟ",
    "ΤΕΜΑΧΙΑ": "ΤΕΜΑΧΙΟ",
    "ΜΑΤΣΟ": "ΜΑΤΣΟ",
    "ΚΟΥΤΑΛΑΚΙΑ ΓΛΥΚΟΥ": "ΚΟΥΤΑΛΑΚΙ ΓΛΥΚΟΥ",
    "ΚΟΥΤΑΛΙΑ ΣΟΥΠΑΣ": "ΚΟΥΤΑΛΙΑ ΣΟΥΠΑΣ",
    "ΠΑΚΕΤΟ": "ΤΕΜΑΧΙΟ",
    "ΣΚΕΛΙΔΑ": "ΤΕΜΑΧΙΟ",
    "ΦΛΥΤΖΑΝΙΑ": "CUP",
  };
  return MAP[base] || base;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      recipes,
      batchStart = 0,
      batchSize = 50,
      skipExisting = true,
    } = body as {
      recipes: Array<{
        name: string;
        portions: number | string;
        instructions: string | null;
        allergens: string[];
        ingredients: Array<{ name: string; qty: number | string; unit: string }>;
      }>;
      batchStart?: number;
      batchSize?: number;
      skipExisting?: boolean;
    };

    if (!Array.isArray(recipes)) {
      return NextResponse.json({ error: "recipes must be an array" }, { status: 400 });
    }

    const supabase = buildClient();

    // 1. Fetch existing recipe names (for skip-existing check)
    const { data: existingRecipes } = await supabase
      .from("recipes")
      .select("name");
    const existingNames = new Set(
      (existingRecipes ?? []).map((r) => r.name.toLowerCase().trim())
    );

    // 2. Fetch all ingredients for matching
    const { data: dbIngredients } = await supabase
      .from("ingredients")
      .select("id, name");

    // Build lookup maps
    const exactMap = new Map<string, number>(); // normalized name → id
    for (const ing of dbIngredients ?? []) {
      exactMap.set(normalize(ing.name), ing.id);
    }

    // Process batch
    const batch = recipes.slice(batchStart, batchStart + batchSize);

    let created = 0;
    let skipped = 0;
    const unmatchedIngredients = new Set<string>();
    const errors: string[] = [];

    for (const recipe of batch) {
      const recipeName = String(recipe.name).trim();

      // Skip existing
      if (skipExisting && existingNames.has(recipeName.toLowerCase().trim())) {
        skipped++;
        continue;
      }

      // Map allergens
      const allergens = mapAllergens(recipe.allergens);

      // Portions
      const portions = Number(recipe.portions) || 1;
      const cleanPortions = portions > 0 ? portions : 1;

      try {
        // Insert recipe
        const { data: recipeData, error: recipeError } = await supabase
          .from("recipes")
          .insert({
            name: recipeName,
            portion_yield: cleanPortions,
            portion_unit: "ΜΕΡΙΔΑ",
            allergens: allergens,
            technical_guide: recipe.instructions || null,
            total_raw_material_cost: 0,
            labor_cost: 0,
            overhead_cost: 0,
            total_cost: 0,
            profit_margin_percent: 30,
            selling_price: 0,
            menu_price_vat: 0,
            menu_price_final: 0,
            is_active: true,
          })
          .select("id")
          .single();

        if (recipeError) {
          errors.push(`${recipeName}: ${recipeError.message}`);
          continue;
        }

        const recipeId = recipeData.id;

        // Build recipe_ingredients rows
        const ingRows = recipe.ingredients.map((ing) => {
          const ingName = String(ing.name).trim();
          const normalizedIngName = normalize(ingName);
          const ingredientId = exactMap.get(normalizedIngName) || null;

          if (!ingredientId) {
            unmatchedIngredients.add(ingName);
          }

          const unit = normalizeUnit(String(ing.unit || "ΓΡΑΜΜΑΡΙΑ"));
          const qty = Number(ing.qty) || 0;

          return {
            recipe_id: recipeId,
            ingredient_id: ingredientId,
            ingredient_name: ingName,
            quantity: qty,
            unit: unit,
            unit_cost: 0,
            total_cost: 0,
            wastage_factor: 0,
            requires_prep: false,
            prep_notes: null,
          };
        });

        if (ingRows.length > 0) {
          const { error: ingError } = await supabase
            .from("recipe_ingredients")
            .insert(ingRows);

          if (ingError) {
            errors.push(`${recipeName} ingredients: ${ingError.message}`);
          }
        }

        created++;
      } catch (err) {
        errors.push(`${recipeName}: ${String(err)}`);
      }
    }

    const total = recipes.length;
    const processed = batchStart + batch.length;
    const isDone = processed >= total;

    return NextResponse.json({
      created,
      skipped,
      errors: errors.slice(0, 20),
      unmatchedIngredients: Array.from(unmatchedIngredients).slice(0, 100),
      unmatchedCount: unmatchedIngredients.size,
      batchStart,
      batchEnd: processed,
      total,
      isDone,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
