-- ============================================================
-- ΑΣΦΑΛΕΙΑ: έγκριση νέων χρηστών, άδειες ανά καρτέλα, αντίγραφο
-- ============================================================
-- Τρέξε το ΜΙΑ φορά στο Supabase → SQL Editor → New query → Run.
-- Ασφαλές να ξανατρέξει. ΔΕΝ σβήνει και ΔΕΝ αλλάζει δεδομένα.
-- Οι σημερινοί χρήστες μένουν ενεργοί όπως είναι.
--
--  1. Νέα εγγραφή = ΑΝΕΝΕΡΓΟΣ λογαριασμός μέχρι να τον εγκρίνει
--     ο διαχειριστής (Διαχείριση Χρηστών → «✓ Έγκριση»).
--  2. Ανενεργός ή άγνωστος λογαριασμός δεν διαβάζει/γράφει ΤΙΠΟΤΑ
--     (κανόνας στη βάση, όχι μόνο στην οθόνη).
--  3. Άδειες ανά χρήστη (users.permissions). Στη βάση φυλάσσονται:
--     μισθοδοσία, έσοδα, τιμολόγια αγορών, χρεώσεις/πληρωμές
--     προμηθευτών — μόνο όποιος έχει την αντίστοιχη άδεια.
--  4. backup_rows(): πλήρες αντίγραφο για τον διαχειριστή.
-- ============================================================

-- ── 1. Στήλη αδειών + νέοι χρήστες ανενεργοί ────────────────
alter table public.users add column if not exists permissions jsonb;
alter table public.users alter column is_active set default false;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  is_first_user boolean;
begin
  select not exists (select 1 from public.users) into is_first_user;
  insert into public.users (id, name, email, role, is_active)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.email,
    case when is_first_user then 'admin' else 'chef' end,
    is_first_user            -- μόνο ο πρώτος χρήστης ενεργός αμέσως
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ── 2. Βοηθητικές συναρτήσεις ───────────────────────────────
create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (select 1 from public.users where id = auth.uid() and is_active = true);
$$;

-- Έχει ο τρέχων χρήστης την άδεια p; (διαχειριστής: πάντα)
create or replace function public.has_perm(p text)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.is_active = true
      and (u.role = 'admin' or (u.permissions is not null and u.permissions ? p))
  );
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

grant execute on function public.is_active_user() to authenticated;
grant execute on function public.has_perm(text) to authenticated;

-- Ο χρήστης δεν μπορεί να αλλάξει μόνος του ρόλο/άδειες/ενεργοποίηση
-- (οι υπάρχοντες κανόνες users_admin_* το επιτρέπουν μόνο στον διαχειριστή).

-- Πίνακας χρηστών: πάντα με κανόνες. Αν (σπάνια) λείπουν οι βασικοί, ξαναμπαίνουν.
alter table public.users enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='users' and policyname='users_select_all_authenticated') then
    create policy "users_select_all_authenticated" on public.users for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='users' and policyname='users_admin_update') then
    create policy "users_admin_update" on public.users for update to authenticated using (public.is_admin()) with check (public.is_admin());
  end if;
end $$;

-- Ανενεργός βλέπει μόνο τη δική του γραμμή στους χρήστες
drop policy if exists "users_self_or_active" on public.users;
create policy "users_self_or_active" on public.users as restrictive
  for select to authenticated
  using (id = auth.uid() or public.is_active_user());

-- ── 2β. Κανόνας «μόνο ενεργοί χρήστες» σε όλους τους πίνακες της εφαρμογής ──
do $$
declare
  t text;
begin
  foreach t in array array[
    'businesses','business_profile','company_settings','departments','units',
    'suppliers','supplier_products','ingredient_supplier_map','product_sku_map','sku_unit_conversions',
    'orders','order_items','supplier_payments','purchase_invoices',
    'ingredients','recipes','recipe_ingredients','menus','menu_recipes','prep_lists',
    'stock_takings','stock_taking_items','inventory_snapshots','internal_transfers','internal_transfer_items',
    'buffet_dishes','buffet_cycle_entries','reservations',
    'revenue_entries','payroll_entries','ingestion_logs'
  ]
  loop
    if to_regclass('public.' || t) is null then
      raise notice 'Ο πίνακας % δεν υπάρχει — παραλείπεται', t;
      continue;
    end if;
    execute format('alter table public.%I enable row level security', t);
    -- αν δεν έχει καμία «επιτρεπτική» πολιτική, βάλε «όλοι οι συνδεδεμένοι»
    -- (αλλιώς με RLS ενεργό δεν θα έβλεπε κανείς τίποτα)
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and permissive = 'PERMISSIVE') then
      execute format('create policy "allow_authenticated_all" on public.%I for all to authenticated using (true) with check (true)', t);
      raise notice '%: προστέθηκε βασική πολιτική πρόσβασης', t;
    end if;
    execute format('drop policy if exists "active_user_only" on public.%I', t);
    execute format(
      'create policy "active_user_only" on public.%I as restrictive for all to authenticated
         using (public.is_active_user()) with check (public.is_active_user())', t);
  end loop;
end $$;

-- ── 3. Ευαίσθητοι πίνακες: μόνο με την αντίστοιχη άδεια ─────
do $$
declare
  r record;
begin
  for r in select * from (values
    ('payroll_entries',   $c$public.has_perm('/payroll') or public.has_perm('/reports')$c$),
    ('revenue_entries',   $c$public.has_perm('/revenue') or public.has_perm('/reports')$c$),
    ('purchase_invoices', $c$public.has_perm('/purchases') or public.has_perm('/reports')$c$),
    ('supplier_payments', $c$public.has_perm('financials') or public.has_perm('/payments') or public.has_perm('/supplier-crm') or public.has_perm('/import-orders')$c$)
  ) as v(tbl, cond)
  loop
    if to_regclass('public.' || r.tbl) is null then continue; end if;
    execute format('drop policy if exists "perm_only" on public.%I', r.tbl);
    execute format('create policy "perm_only" on public.%I as restrictive for all to authenticated using (%s) with check (%s)',
                   r.tbl, r.cond, r.cond);
  end loop;
end $$;

-- ── 4. Πλήρες αντίγραφο ασφαλείας (μόνο διαχειριστής) ───────
-- Διαβάζει ΚΑΙ τις ανενεργές επιχειρήσεις (παρακάμπτει τους κανόνες).
create or replace function public.backup_rows(p_table text, p_offset int default 0, p_limit int default 1000)
returns setof jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  has_id boolean;
begin
  if not public.is_admin() then
    raise exception 'Μόνο ο διαχειριστής μπορεί να πάρει αντίγραφο';
  end if;
  if p_table not in (
    'businesses','business_profile','company_settings','users','departments','units',
    'suppliers','supplier_products','ingredient_supplier_map','product_sku_map','sku_unit_conversions',
    'orders','order_items','supplier_payments','purchase_invoices',
    'ingredients','recipes','recipe_ingredients','menus','menu_recipes','prep_lists',
    'stock_takings','stock_taking_items','inventory_snapshots','internal_transfers','internal_transfer_items',
    'buffet_dishes','buffet_cycle_entries','reservations',
    'revenue_entries','payroll_entries','ingestion_logs'
  ) or to_regclass('public.' || p_table) is null then
    raise exception 'Άγνωστος πίνακας %', p_table;
  end if;
  select exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = p_table and column_name = 'id') into has_id;
  return query execute format(
    'select to_jsonb(t) from public.%I t %s offset %s limit %s',
    p_table, case when has_id then 'order by t.id' else '' end,
    greatest(p_offset, 0), least(greatest(p_limit, 1), 5000));
end $$;
grant execute on function public.backup_rows(text, int, int) to authenticated;

-- Έλεγχος: οι χρήστες και η κατάστασή τους
select name, email, role, is_active, permissions from public.users order by created_at;
