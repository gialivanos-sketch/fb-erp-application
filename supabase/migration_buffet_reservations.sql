-- ============================================================
-- MIGRATION: Buffet Menu Cycle + Reservations
-- Run this in Supabase → SQL Editor
-- ============================================================

-- ── 1. Internal Transfers ────────────────────────────────────
-- (if not already created from earlier session)

create table if not exists public.departments (
  id          serial primary key,
  name        text not null,
  name_en     text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.internal_transfers (
  id              serial primary key,
  transfer_date   date not null default current_date,
  from_department text not null default 'Αποθήκη',
  to_department   text not null,
  notes           text,
  status          text not null default 'pending'
                    check (status in ('pending','completed','cancelled')),
  created_by      uuid references public.users(id) on delete set null,
  created_at      timestamptz not null default now()
);

create table if not exists public.transfer_items (
  id              serial primary key,
  transfer_id     integer not null references public.internal_transfers(id) on delete cascade,
  product_name    text not null,
  quantity        numeric(10,3) not null default 0,
  unit            text not null default 'kg',
  notes           text,
  sort_order      integer not null default 0
);

-- Seed default departments (skip if already exist)
insert into public.departments (name, name_en) values
  ('Κουζίνα', 'Kitchen'),
  ('Μπαρ', 'Bar'),
  ('Ζαχαροπλαστείο', 'Pastry'),
  ('Μπουφές', 'Buffet'),
  ('Εστιατόριο', 'Restaurant'),
  ('Πισίνα', 'Pool Bar')
on conflict do nothing;

-- ── 2. Buffet Menu Cycle ─────────────────────────────────────

create table if not exists public.buffet_cycle_entries (
  id           serial primary key,
  week_number  smallint not null check (week_number between 1 and 4),
  day_of_week  smallint not null check (day_of_week between 1 and 7),
  meal_type    text not null check (meal_type in ('breakfast','lunch','dinner')),
  notes        text,
  created_at   timestamptz not null default now(),
  -- One entry per week × day × meal slot
  unique (week_number, day_of_week, meal_type)
);

create table if not exists public.buffet_dishes (
  id              serial primary key,
  cycle_entry_id  integer not null references public.buffet_cycle_entries(id) on delete cascade,
  dish_name       text not null,
  dish_category   text not null default 'Άλλο',
  kg_per_person   numeric(6,4) not null default 0.15,
  unit            text not null default 'kg',
  recipe_id       integer references public.recipes(id) on delete set null,
  sort_order      integer not null default 0
);

-- Indexes for fast lookup
create index if not exists buffet_cycle_entries_week_day
  on public.buffet_cycle_entries (week_number, day_of_week);

create index if not exists buffet_dishes_entry
  on public.buffet_dishes (cycle_entry_id);

-- ── 3. Reservations ─────────────────────────────────────────

create table if not exists public.reservations (
  id                serial primary key,
  reservation_date  date not null,
  meal_type         text not null check (meal_type in ('breakfast','lunch','dinner')),
  board_type        text not null check (board_type in ('BB','HB','FB','AI')),
  pax               integer not null check (pax > 0),
  source            text not null default 'manual'
                      check (source in ('manual','excel_import')),
  week_number       smallint,      -- cycle week 1-4, computed on insert
  notes             text,
  created_at        timestamptz not null default now()
);

-- Index for date-range queries and food cost joins
create index if not exists reservations_date
  on public.reservations (reservation_date);

create index if not exists reservations_date_meal
  on public.reservations (reservation_date, meal_type);

-- ── 4. RLS Policies ─────────────────────────────────────────
-- Internal Transfers
alter table public.departments         enable row level security;
alter table public.internal_transfers  enable row level security;
alter table public.transfer_items      enable row level security;

-- Buffet
alter table public.buffet_cycle_entries  enable row level security;
alter table public.buffet_dishes         enable row level security;

-- Reservations
alter table public.reservations  enable row level security;

-- Allow all authenticated users to read; only admin/chef/storekeeper to write
-- (Mirrors the pattern used by the rest of the app)

-- departments
create policy "authenticated read departments"
  on public.departments for select using (auth.role() = 'authenticated');
create policy "authenticated write departments"
  on public.departments for all using (auth.role() = 'authenticated');

-- internal_transfers
create policy "authenticated read internal_transfers"
  on public.internal_transfers for select using (auth.role() = 'authenticated');
create policy "authenticated write internal_transfers"
  on public.internal_transfers for all using (auth.role() = 'authenticated');

-- transfer_items
create policy "authenticated read transfer_items"
  on public.transfer_items for select using (auth.role() = 'authenticated');
create policy "authenticated write transfer_items"
  on public.transfer_items for all using (auth.role() = 'authenticated');

-- buffet_cycle_entries
create policy "authenticated read buffet_cycle_entries"
  on public.buffet_cycle_entries for select using (auth.role() = 'authenticated');
create policy "authenticated write buffet_cycle_entries"
  on public.buffet_cycle_entries for all using (auth.role() = 'authenticated');

-- buffet_dishes
create policy "authenticated read buffet_dishes"
  on public.buffet_dishes for select using (auth.role() = 'authenticated');
create policy "authenticated write buffet_dishes"
  on public.buffet_dishes for all using (auth.role() = 'authenticated');

-- reservations
create policy "authenticated read reservations"
  on public.reservations for select using (auth.role() = 'authenticated');
create policy "authenticated write reservations"
  on public.reservations for all using (auth.role() = 'authenticated');

-- ── 5. Realtime ─────────────────────────────────────────────
alter publication supabase_realtime add table
  public.departments,
  public.internal_transfers,
  public.transfer_items,
  public.buffet_cycle_entries,
  public.buffet_dishes,
  public.reservations;

-- ============================================================
-- Done. All 6 new tables created with RLS + realtime enabled.
-- ============================================================
