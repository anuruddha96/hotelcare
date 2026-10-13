-- A manager can request a read-back-and-repair for an existing shared
-- room offer after an incomplete Previo write. A watcher may only reopen
-- missing virtual availability after revalidating actual reservations.
alter table public.room_sale_overnight_watches
  add column if not exists reconcile_requested_at timestamptz;
alter table public.room_sale_overnight_watches
  add column if not exists reconciled_at timestamptz;
