-- ============================================================
-- Backfill: create a "Χρέωση" (debit) in the Payments Ledger for
-- every EXISTING order that doesn't already have one — so past
-- orders count toward each supplier's Σύνολο Χρεώσεων / Ανοιχτό
-- Υπόλοιπο too, not just new ones going forward.
--
-- Safe to re-run: it only inserts a debit for an order that
-- doesn't already have one (matched by order_number), so running
-- it twice — or running it after new orders have already started
-- auto-creating their own debit — will never create duplicates.
--
-- Run this once in Supabase (Project → SQL Editor → New query →
-- paste → Run).
-- ============================================================

insert into public.supplier_payments (supplier_id, transaction_date, amount, type, reference, notes)
select
  o.supplier_id,
  o.order_date,
  o.total_gross,
  'debit',
  o.order_number,
  'Αυτόματη χρέωση από παραγγελία (αναδρομική συμπλήρωση)'
from public.orders o
where o.total_gross > 0
  and not exists (
    select 1 from public.supplier_payments sp
    where sp.type = 'debit' and sp.reference = o.order_number
  );
