#!/usr/bin/env python3
"""
extract_recipes.py
------------------
Εξάγει συνταγές, υλικά, αλλεργιογόνα και τεχνικές οδηγίες
από το αρχείο Copy_of_Recipes_Management_ENRICHED.xlsm
και τα αποθηκεύει σε recipes_data.json έτοιμα για εισαγωγή
στην εφαρμογή ERP μέσω /import-recipes.

Χρήση:
    pip install openpyxl
    python scripts/extract_recipes.py [path/to/file.xlsm] [output.json]

Παράδειγμα:
    python scripts/extract_recipes.py Copy_of_Recipes_Management_ENRICHED.xlsm recipes_data.json
"""
import sys
import re
import json
import openpyxl


def normalize_allergen(raw: str) -> str:
    """Extract allergen name from a Windows file path like D:\\icons\\ΓΛΟΥΤΕΝΗ.png"""
    m = re.search(r'[/\\]([^/\\]+)\.(png|jpg|jpeg|bmp)$', raw, re.IGNORECASE)
    if m:
        return m.group(1).upper()
    return raw.upper().strip()


def load_recipes(xlsm_path: str) -> dict:
    """Load all recipes from ΑΡΧΕΙΟ ΣΥΝΤΑΓΩΝ sheet."""
    wb = openpyxl.load_workbook(xlsm_path, read_only=True, data_only=True, keep_vba=False)
    ws = wb['ΑΡΧΕΙΟ ΣΥΝΤΑΓΩΝ']

    recipes = {}
    header_found = False

    for row in ws.iter_rows(values_only=True):
        if row[2] == 'ΟΝΟΜΑ ΣΥΝΤΑΓΗΣ':
            header_found = True
            continue
        if not header_found:
            continue
        if not row[2] or str(row[2]).strip() in ('', 'nan'):
            continue

        name = str(row[2]).strip()
        portions_raw = row[6]
        try:
            portions = float(portions_raw) if portions_raw else 1
        except (TypeError, ValueError):
            portions = 1
        if portions <= 0:
            portions = 1

        instructions = None
        if row[11] and str(row[11]).strip() not in ('', 'nan'):
            instructions = str(row[11]).strip()

        # Columns 13–17 hold allergen paths (up to 5)
        allergens_raw = [
            str(a) for a in row[13:18]
            if a and str(a).strip() not in ('', 'nan', 'False', 'True', '#VALUE!', '#REF!')
        ]
        allergens = []
        skip_tags = {'NO ALLERGENS', 'VEGAN', 'MILD', 'VEGETARIAN', 'ORGANIC',
                     'GLUTEN FREE', 'FAT FREE', 'SUGAR FREE', 'VEGETARIAN-ICON-300X300'}
        for a in allergens_raw:
            tag = normalize_allergen(a)
            if tag not in skip_tags:
                allergens.append(tag)

        recipes[name] = {
            'name': name,
            'portions': portions,
            'instructions': instructions,
            'allergens': allergens,
            'ingredients': [],
        }

    wb.close()
    print(f"  Recipes loaded from ΑΡΧΕΙΟ ΣΥΝΤΑΓΩΝ: {len(recipes)}")
    return recipes


def load_ingredients(xlsm_path: str, recipes: dict) -> int:
    """Load all recipe ingredients from ΥΛΙΚΑ ΣΥΝΤΑΓΩΝ sheet into recipes dict."""
    wb = openpyxl.load_workbook(xlsm_path, read_only=True, data_only=True, keep_vba=False)
    ws = wb['ΥΛΙΚΑ ΣΥΝΤΑΓΩΝ']

    header_found = False
    count = 0
    unmatched_recipes = set()

    for row in ws.iter_rows(values_only=True):
        if row[2] == 'ΟΝΟΜΑ ΣΥΝΤΑΓΗΣ':
            header_found = True
            continue
        if not header_found:
            continue
        if not row[2] or str(row[2]).strip() in ('', 'nan'):
            continue

        rname = str(row[2]).strip()
        iname = str(row[3]).strip() if row[3] else None
        if not iname or iname in ('', 'nan'):
            continue

        try:
            qty = float(row[4]) if row[4] is not None else 0
        except (TypeError, ValueError):
            qty = 0

        # Unit: may contain (pack_size) suffix like "ΓΡΑΜΜΑΡΙΑ (2500)"
        unit_raw = str(row[5]).strip() if row[5] else 'ΓΡΑΜΜΑΡΙΑ'
        if unit_raw in ('', 'nan', 'None'):
            unit_raw = 'ΓΡΑΜΜΑΡΙΑ'

        if rname in recipes:
            recipes[rname]['ingredients'].append({
                'name': iname,
                'qty': qty,
                'unit': unit_raw,
            })
            count += 1
        else:
            unmatched_recipes.add(rname)

    wb.close()

    if unmatched_recipes:
        print(f"  ⚠️  {len(unmatched_recipes)} ingredient rows reference unknown recipes (ignored)")

    print(f"  Ingredient rows loaded: {count}")
    return count


def main():
    xlsm_path = sys.argv[1] if len(sys.argv) > 1 else 'Copy_of_Recipes_Management_ENRICHED.xlsm'
    output_path = sys.argv[2] if len(sys.argv) > 2 else 'recipes_data.json'

    print(f"Reading: {xlsm_path}")
    print("Loading recipes…")
    recipes = load_recipes(xlsm_path)

    print("Loading ingredients…")
    load_ingredients(xlsm_path, recipes)

    recipe_list = list(recipes.values())

    # Stats
    with_ingr = sum(1 for r in recipe_list if r['ingredients'])
    with_instr = sum(1 for r in recipe_list if r['instructions'])
    total_ingr = sum(len(r['ingredients']) for r in recipe_list)
    unique_ingr = len({i['name'] for r in recipe_list for i in r['ingredients']})

    print(f"\n=== Summary ===")
    print(f"  Total recipes:          {len(recipe_list)}")
    print(f"  With ingredients:       {with_ingr}")
    print(f"  With instructions:      {with_instr}")
    print(f"  Total ingredient rows:  {total_ingr}")
    print(f"  Unique ingredient names:{unique_ingr}")

    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(recipe_list, f, ensure_ascii=False, indent=2)

    print(f"\n✅ Saved: {output_path} ({len(recipe_list)} recipes)")
    print(f"\nΕπόμενο βήμα: Άνοιξε https://fb-erp-application-5.vercel.app/import-recipes")
    print(f"και ανέβασε το αρχείο '{output_path}'.")


if __name__ == '__main__':
    main()
