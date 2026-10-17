-- ============================================================
-- ΠΟΛΛΕΣ ΕΠΙΧΕΙΡΗΣΕΙΣ (μία ενεργή κάθε φορά)
-- ============================================================
-- Τρέξε το ΜΙΑ φορά στο Supabase → SQL Editor → New query → Run.
-- Είναι ασφαλές να ξανατρέξει (idempotent).
--
-- Τι κάνει:
--  1. Πίνακας `businesses` (στοιχεία επιχείρησης + ποια είναι ενεργή).
--     Η σημερινή «Καρτέλα Επιχείρησης» γίνεται η 1η επιχείρηση (NOE).
--  2. Στους πίνακες που ανήκουν σε επιχείρηση προστίθεται στήλη
--     business_id. Ό,τι υπάρχει σήμερα δηλώνεται στην ενεργή (NOE).
--     Κάθε νέα εγγραφή παίρνει αυτόματα την ενεργή επιχείρηση.
--  3. Κανόνας ασφαλείας (RLS): κάθε οθόνη βλέπει/γράφει ΜΟΝΟ τα
--     δεδομένα της ενεργής επιχείρησης. Τίποτα δεν σβήνεται.
--
-- ΑΝΗΚΟΥΝ ΣΕ ΕΠΙΧΕΙΡΗΣΗ: προμηθευτές, προσφορές/τιμές προμηθευτών,
--   παραγγελίες + είδη, χρεώσεις/πληρωμές, αντιστοίχιση υλικών με
--   προϊόντα προμηθευτών, ομαδοποίηση SKU, απογραφές, εσωτ. διακίνηση,
--   τιμολόγια αγορών.
-- ΚΟΙΝΑ: συνταγές, μενού, υλικά, μονάδες, χρήστες, μισθοδοσία,
--   έσοδα, κρατήσεις, μπουφές.
-- ============================================================

-- ── 1. Πίνακας επιχειρήσεων ─────────────────────────────────
create table if not exists public.businesses (
  id bigint generated always as identity primary key,
  name text not null,
  address text not null default '',
  phone text not null default '',
  email text not null default '',
  tax_id text not null default '',
  logo_data_url text,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  deactivated_at timestamptz
);

-- Μόνο ΜΙΑ ενεργή επιχείρηση
create unique index if not exists businesses_one_active
  on public.businesses (is_active) where is_active;

-- Πρώτη επιχείρηση από τη σημερινή Καρτέλα Επιχείρησης
do $$
begin
  if not exists (select 1 from public.businesses) then
    if to_regclass('public.business_profile') is not null then
      insert into public.businesses (name, address, phone, email, tax_id, logo_data_url, is_active)
      select coalesce(nullif(trim(name), ''), 'NOE BEACH CLUB'), coalesce(address, ''), coalesce(phone, ''),
             coalesce(email, ''), coalesce(tax_id, ''), logo_data_url, true
      from public.business_profile where id = 1;
    end if;
    if not exists (select 1 from public.businesses) then
      insert into public.businesses (name, is_active) values ('NOE BEACH CLUB', true);
    end if;
  end if;
end $$;

-- Η ενεργή επιχείρηση (security definer: διαβάζει πάντα, χωρίς RLS)
create or replace function public.current_business_id()
returns bigint
language sql
stable
security definer set search_path = public
as $$
  select id from public.businesses where is_active order by id limit 1;
$$;

grant select, insert, update, delete on public.businesses to authenticated;
alter table public.businesses enable row level security;
drop policy if exists "businesses_read" on public.businesses;
create policy "businesses_read" on public.businesses
  for select to authenticated using (true);
drop policy if exists "businesses_admin_write" on public.businesses;
create policy "businesses_admin_write" on public.businesses
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Ενεργοποίηση επιχείρησης (απενεργοποιεί την τρέχουσα) — μόνο διαχειριστής.
-- p_copy_sku_from: προαιρετικά αντιγράφει την ομαδοποίηση SKU από άλλη επιχείρηση.
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

  if p_copy_sku_from is not null and p_copy_sku_from <> p_id
     and to_regclass('public.product_sku_map') is not null then
    insert into public.product_sku_map (product_name, sku, final_group, business_id)
    select s.product_name, s.sku, s.final_group, p_id
    from public.product_sku_map s
    where s.business_id = p_copy_sku_from
      and not exists (
        select 1 from public.product_sku_map t
        where t.business_id = p_id and t.product_name = s.product_name
      );
  end if;
end $$;

grant execute on function public.current_business_id() to authenticated;
grant execute on function public.activate_business(bigint, bigint) to authenticated;

-- ── 2 + 3. business_id + κανόνας ασφαλείας σε κάθε πίνακα επιχείρησης ──
do $$
declare
  t text;
  active_id bigint := public.current_business_id();
  c record;
  cols text;
begin
  foreach t in array array[
    'suppliers','supplier_products','orders','order_items','supplier_payments',
    'ingredient_supplier_map','product_sku_map',
    'stock_takings','stock_taking_items','inventory_snapshots',
    'internal_transfers','internal_transfer_items','purchase_invoices'
  ]
  loop
    if to_regclass('public.' || t) is null then
      raise notice 'Ο πίνακας % δεν υπάρχει — παραλείπεται', t;
      continue;
    end if;

    -- στήλη + υπάρχοντα δεδομένα → ενεργή επιχείρηση
    execute format('alter table public.%I add column if not exists business_id bigint references public.businesses(id)', t);
    execute format('update public.%I set business_id = %s where business_id is null', t, active_id);
    execute format('alter table public.%I alter column business_id set default public.current_business_id()', t);
    execute format('alter table public.%I alter column business_id set not null', t);
    execute format('create index if not exists %I on public.%I (business_id)', t || '_business_idx', t);

    -- μοναδικότητες (π.χ. αριθμός παραγγελίας) → ανά επιχείρηση
    for c in
      select con.conname, array_agg(att.attname order by k.ord) as colnames
      from pg_constraint con
      join lateral unnest(con.conkey) with ordinality as k(attnum, ord) on true
      join pg_attribute att on att.attrelid = con.conrelid and att.attnum = k.attnum
      where con.conrelid = ('public.' || t)::regclass and con.contype = 'u'
      group by con.conname
      having not ('business_id' = any(array_agg(att.attname)))
    loop
      select string_agg(quote_ident(x), ', ') into cols from unnest(c.colnames) x;
      execute format('alter table public.%I drop constraint %I', t, c.conname);
      execute format('alter table public.%I add constraint %I unique (business_id, %s)', t, c.conname, cols);
      raise notice '%: μοναδικότητα % → ανά επιχείρηση', t, c.conname;
    end loop;

    -- RLS: αν δεν υπάρχει καμία πολιτική, πρόσθεσε την «όλοι οι συνδεδεμένοι»
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and permissive = 'PERMISSIVE') then
      execute format('create policy "allow_authenticated_all" on public.%I for all to authenticated using (true) with check (true)', t);
    end if;
    -- ΠΕΡΙΟΡΙΣΤΙΚΗ πολιτική: μόνο η ενεργή επιχείρηση
    execute format('drop policy if exists "active_business_only" on public.%I', t);
    execute format(
      'create policy "active_business_only" on public.%I as restrictive for all to authenticated
         using (business_id = public.current_business_id())
         with check (business_id = public.current_business_id())', t);
  end loop;
end $$;

-- Μοναδικά indexes (όχι constraints) στους ίδιους πίνακες → ανά επιχείρηση
do $$
declare
  r record;
  newdef text;
begin
  for r in
    select i.indexrelid::regclass::text as idx, c.relname as tbl, pg_get_indexdef(i.indexrelid) as def
    from pg_index i
    join pg_class c on c.oid = i.indrelid
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    where i.indisunique and not i.indisprimary
      and not exists (select 1 from pg_constraint con where con.conindid = i.indexrelid)
      and c.relname = any(array['suppliers','supplier_products','orders','order_items','supplier_payments',
        'ingredient_supplier_map','product_sku_map','stock_takings','stock_taking_items','inventory_snapshots',
        'internal_transfers','internal_transfer_items','purchase_invoices'])
      and pg_get_indexdef(i.indexrelid) not like '%business_id%'
  loop
    newdef := regexp_replace(r.def, '\(', '(business_id, ', '');
    execute format('drop index if exists %s', r.idx);
    execute newdef;
    raise notice '%: μοναδικό index → ανά επιχείρηση', r.tbl;
  end loop;
end $$;

-- Συναρτήσεις που παρακάμπτουν το RLS θα έβλεπαν και άλλες επιχειρήσεις:
-- η αναζήτηση προμηθευτών υλικού τρέχει πλέον με τα δικαιώματα του χρήστη.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as fn from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
    where p.proname = 'get_supplier_options_for_ingredient' and p.prosecdef
  loop
    execute format('alter function %s security invoker', r.fn);
    raise notice '% → security invoker', r.fn;
  end loop;
end $$;

-- Έλεγχος: πόσες εγγραφές ανά πίνακα ανήκουν στην ενεργή επιχείρηση
select b.id, b.name, b.is_active from public.businesses b order by b.id;
