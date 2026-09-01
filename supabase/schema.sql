-- ============================================================
-- F&B ERP — Supabase Schema (PostgreSQL DDL)
-- ============================================================
-- Run this entire script once in the Supabase SQL Editor
-- (Project → SQL Editor → New query → paste → Run).
-- It is safe to re-run: every statement uses IF NOT EXISTS /
-- CREATE OR REPLACE, so re-running it after a partial failure
-- won't duplicate anything or error out.
--
-- Table and column names are snake_case (Postgres convention);
-- the app's TypeScript layer converts to/from camelCase when
-- reading and writing, so you do not need to rename anything
-- here to match the UI.
-- ============================================================

-- ------------------------------------------------------------
-- USERS
-- ------------------------------------------------------------
-- This table holds the app-specific profile (name, role) for
-- each person. Its primary key is the SAME uuid as the matching
-- row in Supabase's own auth.users table (which stores the
-- login email + password hash — you never query or edit
-- auth.users directly). The trigger below keeps the two in sync
-- automatically: whenever someone signs up, a matching row here
-- is created for you, defaulting to the 'chef' role until an
-- admin changes it from the User Management screen.
-- ------------------------------------------------------------
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  email text not null unique,
  role text not null default 'chef' check (role in ('admin', 'chef', 'storekeeper')),
  is_active boolean not null default true,
  last_login_at timestamptz,
  created_at timestamptz not null default now()
);

-- Auto-creates a public.users row whenever someone signs up via
-- Supabase Auth. Pulls the display name from the "name" field
-- passed at signup (see the app's signup form), falling back to
-- the email's local part if none was given.
--
-- Bootstrap rule: the very FIRST person ever to sign up becomes
-- 'admin' automatically (there's no one else yet who could grant
-- that role from the User Management screen). Every signup after
-- that defaults to 'chef', same as before — an existing admin
-- promotes them from the User Management screen afterward.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  is_first_user boolean;
begin
  select not exists (select 1 from public.users) into is_first_user;
  insert into public.users (id, name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.email,
    case when is_first_user then 'admin' else 'chef' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ------------------------------------------------------------
-- SUPPLIERS
-- ------------------------------------------------------------
create table if not exists public.suppliers (
  id bigint generated always as identity primary key,
  name text not null,
  name_en text,
  contact_email text,
  contact_phone text,
  address text,
  category text,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- SUPPLIER PRODUCTS (price list entries — one row per supplier
-- offering for a product, which is what the SKU search compares
-- across suppliers)
-- ------------------------------------------------------------
create table if not exists public.supplier_products (
  id bigint generated always as identity primary key,
  supplier_id bigint not null references public.suppliers(id) on delete cascade,
  product_name text not null,
  product_name_en text,
  category text not null default 'Produce',
  unit text not null default 'kg',
  base_price numeric(12,4) not null default 0,
  quality_grade text,
  region_of_origin text,
  is_contract_price boolean default false,
  is_active boolean default true,
  created_at timestamptz not null default now()
);
create index if not exists idx_supplier_products_supplier on public.supplier_products(supplier_id);
create index if not exists idx_supplier_products_name on public.supplier_products using gin (to_tsvector('simple', product_name || ' ' || coalesce(product_name_en, '')));

-- ------------------------------------------------------------
-- ORDERS + ORDER ITEMS
-- ------------------------------------------------------------
create table if not exists public.orders (
  id bigint generated always as identity primary key,
  order_number text not null unique,
  supplier_id bigint not null references public.suppliers(id) on delete restrict,
  order_date date not null default current_date,
  invoice_number text,
  delivery_note_number text,
  notes text,
  status text not null default 'draft' check (status in ('draft', 'confirmed', 'delivered', 'cancelled')),
  total_net numeric(12,2) not null default 0,
  total_vat numeric(12,2) not null default 0,
  total_gross numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_orders_supplier on public.orders(supplier_id);

create table if not exists public.order_items (
  id bigint generated always as identity primary key,
  order_id bigint not null references public.orders(id) on delete cascade,
  supplier_product_id bigint references public.supplier_products(id) on delete set null,
  product_name text not null,
  ordered_quantity numeric(12,3) not null default 0,
  delivered_quantity numeric(12,3),
  unit text not null default 'kg',
  base_price numeric(12,4) not null default 0,
  vat_percent numeric(5,2) not null default 24,
  discount_percent numeric(5,2) not null default 0,
  net_amount numeric(12,2) not null default 0,
  vat_amount numeric(12,2) not null default 0,
  gross_amount numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_order_items_order on public.order_items(order_id);

-- ------------------------------------------------------------
-- SUPPLIER PAYMENTS (financial ledger)
-- ------------------------------------------------------------
create table if not exists public.supplier_payments (
  id bigint generated always as identity primary key,
  supplier_id bigint not null references public.suppliers(id) on delete cascade,
  transaction_date date not null default current_date,
  amount numeric(12,2) not null default 0,
  type text not null check (type in ('debit', 'payment')),
  reference text,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists idx_supplier_payments_supplier on public.supplier_payments(supplier_id);

-- ------------------------------------------------------------
-- STOCK TAKINGS + LINE ITEMS
-- ------------------------------------------------------------
create table if not exists public.stock_takings (
  id bigint generated always as identity primary key,
  taking_date date not null default current_date,
  notes text,
  total_recorded_value numeric(12,2) not null default 0,
  total_purchase_value numeric(12,2) not null default 0,
  total_quantity_bought numeric(12,3) not null default 0,
  distinct_sku_count integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.stock_taking_items (
  id bigint generated always as identity primary key,
  stock_taking_id bigint not null references public.stock_takings(id) on delete cascade,
  product_name text not null,
  initial_stock numeric(12,3) not null default 0,
  supplier text,
  last_purchase_date date,
  price numeric(12,4) not null default 0,
  unit text not null default 'kg',
  manual_count numeric(12,3),
  inventory_value numeric(12,2) not null default 0,
  variance numeric(12,3) not null default 0
);
create index if not exists idx_stock_taking_items_taking on public.stock_taking_items(stock_taking_id);

-- ------------------------------------------------------------
-- INVENTORY SNAPSHOTS (monthly archive)
-- ------------------------------------------------------------
create table if not exists public.inventory_snapshots (
  id bigint generated always as identity primary key,
  snapshot_date date not null default current_date,
  month_label text,
  recorded_value numeric(12,2) not null default 0,
  previous_value numeric(12,2) not null default 0,
  delta_variance numeric(12,2) not null default 0,
  notes text,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- INGREDIENTS (Master Ingredients Register)
-- ------------------------------------------------------------
create table if not exists public.ingredients (
  id bigint generated always as identity primary key,
  sku text not null unique,
  name text not null,
  name_en text,
  current_stock numeric(12,3) not null default 0,
  unit text not null default 'kg',
  base_price numeric(12,4) not null default 0,
  conversion_factor numeric(12,4) not null default 1,
  conversion_per_unit text,
  mapped_supplier_product_id bigint references public.supplier_products(id) on delete set null,
  wastage_factor numeric(5,2) not null default 0,
  calories integer not null default 0,
  is_active boolean default true,
  created_at timestamptz not null default now()
);
create index if not exists idx_ingredients_name on public.ingredients using gin (to_tsvector('simple', name || ' ' || coalesce(name_en, '')));

-- ------------------------------------------------------------
-- RECIPES + RECIPE INGREDIENTS
-- ------------------------------------------------------------
create table if not exists public.recipes (
  id bigint generated always as identity primary key,
  name text not null,
  name_en text,
  portion_yield numeric(8,2) not null default 1,
  portion_unit text not null default 'pcs',
  allergens jsonb not null default '[]'::jsonb,
  plating_images jsonb,
  technical_guide text,
  total_raw_material_cost numeric(12,2) not null default 0,
  labor_cost numeric(12,2) not null default 0,
  overhead_cost numeric(12,2) not null default 0,
  total_cost numeric(12,2) not null default 0,
  profit_margin_percent numeric(5,2) not null default 60,
  selling_price numeric(12,2) not null default 0,
  menu_price_vat numeric(12,2) not null default 0,
  menu_price_final numeric(12,2) not null default 0,
  calories_per_portion numeric(10,2) not null default 0,
  grams_per_portion numeric(10,2) not null default 0,
  is_active boolean default true,
  created_at timestamptz not null default now()
);

-- Migration for a recipes table created before these two columns existed
-- (safe to re-run — no-ops once the columns are present):
alter table public.recipes add column if not exists calories_per_portion numeric(10,2) not null default 0;
alter table public.recipes add column if not exists grams_per_portion numeric(10,2) not null default 0;

create table if not exists public.recipe_ingredients (
  id bigint generated always as identity primary key,
  recipe_id bigint not null references public.recipes(id) on delete cascade,
  ingredient_id bigint references public.ingredients(id) on delete set null,
  ingredient_name text not null,
  quantity numeric(12,4) not null default 0,
  unit text not null default 'kg',
  unit_cost numeric(12,4) not null default 0,
  total_cost numeric(12,4) not null default 0,
  wastage_factor numeric(5,2) not null default 0,
  requires_prep boolean not null default false,
  prep_notes text default ''
);
create index if not exists idx_recipe_ingredients_recipe on public.recipe_ingredients(recipe_id);

-- ------------------------------------------------------------
-- MENUS + MENU RECIPES
-- ------------------------------------------------------------
create table if not exists public.menus (
  id bigint generated always as identity primary key,
  title text not null,
  title_en text,
  status text not null default 'active' check (status in ('active', 'archived', 'draft')),
  total_recipes integer not null default 0,
  total_portions integer not null default 0,
  avg_profit_margin numeric(5,2) not null default 0,
  total_food_cost numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.menu_recipes (
  id bigint generated always as identity primary key,
  menu_id bigint not null references public.menus(id) on delete cascade,
  recipe_id bigint references public.recipes(id) on delete set null,
  recipe_name text not null,
  portions integer not null default 1,
  food_cost numeric(12,2) not null default 0,
  selling_price numeric(12,2) not null default 0,
  profit_margin numeric(5,2) not null default 0
);
create index if not exists idx_menu_recipes_menu on public.menu_recipes(menu_id);

-- ------------------------------------------------------------
-- PREP LISTS
-- ------------------------------------------------------------
create table if not exists public.prep_lists (
  id bigint generated always as identity primary key,
  menu_id bigint references public.menus(id) on delete cascade,
  recipe_name text not null,
  ingredient_name text not null,
  quantity_needed numeric(12,3) not null default 0,
  unit text not null default 'kg',
  is_prepped boolean not null default false,
  manual_override numeric(12,3),
  portion_calculation numeric(12,2),
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- UNITS (static reference table — seeded below)
-- ------------------------------------------------------------
create table if not exists public.units (
  id bigint generated always as identity primary key,
  name text not null,
  name_en text,
  abbreviation text not null,
  base_unit text,
  conversion_factor numeric(12,6) not null default 1,
  description text
);

-- ------------------------------------------------------------
-- INGESTION LOGS (bulk file upload history)
-- ------------------------------------------------------------
create table if not exists public.ingestion_logs (
  id bigint generated always as identity primary key,
  file_name text not null,
  file_type text not null,
  records_parsed integer not null default 0,
  records_inserted integer not null default 0,
  status text not null default 'completed',
  errors text,
  created_at timestamptz not null default now()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
-- Every table below has RLS enabled. This is required: without
-- it, anyone holding the public anon key (which is embedded in
-- the browser bundle and visible to any visitor) could read AND
-- write every row directly against the Supabase REST API,
-- bypassing your app's UI entirely.
--
-- Two tiers:
--  - public.users gets a STRICTER policy: any signed-in person
--    can read the user list (needed for the User Management
--    screen and for showing names elsewhere), but only an admin
--    can insert/update/delete rows — e.g. change someone's role
--    or delete an account. This is enforced at the database
--    level now, not just hidden by the UI.
--  - Every other table uses a simpler policy for a small internal
--    team: any authenticated Supabase user may read and write.
--    It does NOT enforce your app's chef/storekeeper feature
--    restrictions at the database level — those stay UI-only
--    (RoleGuard), same as before. Locking e.g. recipes to
--    admin+chef only at the database level is a further step
--    beyond this script, ask if you want it added.
-- ============================================================

-- Checks whether the currently signed-in user (per Supabase Auth)
-- is an admin, WITHOUT going through RLS on public.users itself —
-- security definer bypasses RLS for this one lookup, which is
-- what avoids the classic "policy queries the table it protects"
-- infinite-recursion trap.
create or replace function public.is_admin()
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (
    select 1 from public.users
    where id = auth.uid() and role = 'admin' and is_active = true
  );
$$;

alter table public.users enable row level security;

drop policy if exists "users_select_all_authenticated" on public.users;
create policy "users_select_all_authenticated" on public.users
  for select to authenticated using (true);

drop policy if exists "users_admin_write" on public.users;
create policy "users_admin_write" on public.users
  for insert to authenticated with check (public.is_admin());

drop policy if exists "users_admin_update" on public.users;
create policy "users_admin_update" on public.users
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "users_admin_delete" on public.users;
create policy "users_admin_delete" on public.users
  for delete to authenticated using (public.is_admin());

do $$
declare
  t text;
begin
  for t in
    select unnest(array[
      'suppliers','supplier_products','orders','order_items',
      'supplier_payments','stock_takings','stock_taking_items',
      'inventory_snapshots','ingredients','recipes','recipe_ingredients',
      'menus','menu_recipes','prep_lists','units','ingestion_logs'
    ])
  loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists "allow_authenticated_all" on public.%I;', t);
    execute format(
      'create policy "allow_authenticated_all" on public.%I for all to authenticated using (true) with check (true);',
      t
    );
  end loop;
end $$;

-- ============================================================
-- REALTIME
-- ============================================================
-- Enables live updates: when one device writes a row, every
-- other connected device sees the change without refreshing.
-- `units` is intentionally excluded — it's static reference data
-- seeded once below and never edited from the UI, so there's
-- nothing for it to sync.
-- ============================================================
alter publication supabase_realtime add table
  public.users, public.suppliers, public.supplier_products,
  public.orders, public.order_items, public.supplier_payments,
  public.stock_takings, public.stock_taking_items,
  public.inventory_snapshots, public.ingredients, public.recipes,
  public.recipe_ingredients, public.menus, public.menu_recipes,
  public.prep_lists, public.ingestion_logs;

-- ============================================================
-- SEED DATA — starter units only.
-- ============================================================
-- Deliberately NOT seeding public.users here. public.users.id is
-- a foreign key to auth.users(id) with no default value — every
-- row must correspond to a real Supabase Auth account (real email
-- + password), which plain SQL cannot create (Auth accounts are
-- created through the Auth API/UI, not by inserting rows). Trying
-- to insert placeholder users here without matching auth.users
-- rows would fail with a foreign-key/not-null violation on `id`.
--
-- Real people get their public.users row automatically, via the
-- on_auth_user_created trigger above, the moment they sign up
-- from the app's own sign-up screen. The first person to do so
-- becomes admin automatically (see the trigger's bootstrap rule).
--
-- Business data (suppliers, recipes, etc.) is also intentionally
-- NOT seeded here — import it via the app's bulk-upload screens
-- instead, using your real files.
-- ============================================================
insert into public.units (name, name_en, abbreviation, base_unit, conversion_factor, description)
values
  ('Κιλό', 'Kilogram', 'kg', 'kg', 1, 'Βασική μονάδα βάρους'),
  ('Γραμμάριο', 'Gram', 'g', 'kg', 0.001, '1000g = 1kg'),
  ('Λίτρο', 'Liter', 'L', 'L', 1, 'Βασική μονάδα όγκου'),
  ('Μιλιλίτρο', 'Milliliter', 'ml', 'L', 0.001, '1000ml = 1L'),
  ('Τεμάχιο', 'Piece', 'pcs', 'pcs', 1, 'Μονάδα αντικειμένων'),
  ('Μπουκάλι', 'Bottle', 'btl', 'pcs', 1, 'Ένα μπουκάλι'),
  ('Κουτί', 'Box/Carton', 'box', 'pcs', 1, 'Μια συσκευασία'),
  ('Σακούλα', 'Sack', 'sack', 'kg', 25, '25kg σακούλα')
on conflict do nothing;

-- ============================================================
-- Done. Next step: in your Supabase project, go to
-- Project Settings → API and copy the "Project URL" and the
-- "anon public" key into your Vercel environment variables —
-- see the app's README section on Supabase setup for the exact
-- variable names.
-- ============================================================
