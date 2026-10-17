-- ============================================================
-- ΤΙΜΕΣ ΣΥΝΤΑΓΩΝ ΑΠΟ ΑΓΟΡΕΣ
-- ============================================================
-- Τρέξε το ΜΙΑ φορά στο Supabase → SQL Editor → New query → Run,
-- ΜΕΤΑ το migration_multi_business.sql. Ασφαλές να ξανατρέξει.
--
--  1. sku_unit_conversions: «1 <μονάδα> αυτής της ομάδας SKU = Χ γρ./ml»
--     (π.χ. 1 ΤΕΜ ελαιόλαδο 5L = 5000, 1 ΤΕΜΑΧΙΟ λεμόνι = 120).
--     Ανά επιχείρηση, όπως η Ομαδοποίηση SKU.
--  2. apply_recipe_prices(jsonb): γράφει μαζικά τιμές υλικών και
--     κόστη συνταγών (αντί για χιλιάδες ξεχωριστά αιτήματα).
--  3. activate_business: αντιγράφει και τις μετατροπές μαζί με το SKU.
-- ============================================================

create table if not exists public.sku_unit_conversions (
  id bigint generated always as identity primary key,
  business_id bigint not null default public.current_business_id() references public.businesses(id),
  sku text not null,
  unit text not null,
  grams numeric(14,4) not null check (grams > 0),
  updated_at timestamptz not null default now(),
  unique (business_id, sku, unit)
);

grant select, insert, update, delete on public.sku_unit_conversions to authenticated;
alter table public.sku_unit_conversions enable row level security;
drop policy if exists "allow_authenticated_all" on public.sku_unit_conversions;
create policy "allow_authenticated_all" on public.sku_unit_conversions
  for all to authenticated using (true) with check (true);
drop policy if exists "active_business_only" on public.sku_unit_conversions;
create policy "active_business_only" on public.sku_unit_conversions as restrictive
  for all to authenticated
  using (business_id = public.current_business_id())
  with check (business_id = public.current_business_id());

-- Τιμή ανά γραμμάριο (π.χ. 0,001955 €/γρ.) θέλει 6 δεκαδικά — με 4 χανόταν ακρίβεια.
do $$
begin
  alter table public.recipe_ingredients alter column unit_cost type numeric(16,6);
exception when others then
  raise notice 'Η ακρίβεια της unit_cost δεν άλλαξε: %', sqlerrm;
end $$;

-- Μαζική ενημέρωση τιμών. Μορφή:
-- { "ingredients": [ {"id":1,"unit_cost":0.0067,"total_cost":0.34}, ... ],
--   "recipes":     [ {"id":5,"raw":3.2,"total":9.2,"selling":23,"menu_vat":28.5,"menu_final":2.85}, ... ] }
create or replace function public.apply_recipe_prices(p jsonb)
returns jsonb
language plpgsql
security invoker set search_path = public
as $$
declare n_ing int := 0; n_rec int := 0;
begin
  update public.recipe_ingredients ri
     set unit_cost = (x->>'unit_cost')::numeric,
         total_cost = (x->>'total_cost')::numeric
    from jsonb_array_elements(coalesce(p->'ingredients', '[]'::jsonb)) x
   where ri.id = (x->>'id')::bigint;
  get diagnostics n_ing = row_count;

  update public.recipes r
     set total_raw_material_cost = (x->>'raw')::numeric,
         total_cost = (x->>'total')::numeric,
         selling_price = (x->>'selling')::numeric,
         menu_price_vat = (x->>'menu_vat')::numeric,
         menu_price_final = (x->>'menu_final')::numeric
    from jsonb_array_elements(coalesce(p->'recipes', '[]'::jsonb)) x
   where r.id = (x->>'id')::bigint;
  get diagnostics n_rec = row_count;

  return jsonb_build_object('ingredients', n_ing, 'recipes', n_rec);
end $$;
grant execute on function public.apply_recipe_prices(jsonb) to authenticated;

-- Αλλαγή επιχείρησης: αντιγραφή ΚΑΙ των μετατροπών μαζί με την ομαδοποίηση SKU
create or replace function public.activate_business(p_id bigint, p_copy_sku_from bigint default null)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Μόνο ο διαχειριστής μπορεί να αλλάξει επιχείρηση';
  end if;
  if not exists (select 1 from public.businesses where id = p_id) then
    raise exception 'Η επιχείρηση % δεν υπάρχει', p_id;
  end if;
  update public.businesses set is_active = false, deactivated_at = now()
    where is_active and id <> p_id;
  update public.businesses set is_active = true, deactivated_at = null where id = p_id;

  if p_copy_sku_from is not null and p_copy_sku_from <> p_id then
    if to_regclass('public.product_sku_map') is not null then
      insert into public.product_sku_map (product_name, sku, final_group, business_id)
      select s.product_name, s.sku, s.final_group, p_id
      from public.product_sku_map s
      where s.business_id = p_copy_sku_from
        and not exists (select 1 from public.product_sku_map t
                        where t.business_id = p_id and t.product_name = s.product_name);
    end if;
    insert into public.sku_unit_conversions (business_id, sku, unit, grams)
    select p_id, c.sku, c.unit, c.grams
    from public.sku_unit_conversions c
    where c.business_id = p_copy_sku_from
    on conflict (business_id, sku, unit) do nothing;
  end if;
end $$;
grant execute on function public.activate_business(bigint, bigint) to authenticated;

select 'ok' as αποτέλεσμα, count(*) as μετατροπές from public.sku_unit_conversions;
