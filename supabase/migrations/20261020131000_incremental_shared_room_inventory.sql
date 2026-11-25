-- Preserve each category's independent units when one higher-category physical
-- room is advertised under a lower category as extra shared inventory.
-- Existing full-pair watches continue to use the legacy reconciliation path.
alter table public.room_sale_overnight_watches
  add column if not exists pool_mode text not null default 'legacy_full',
  add column if not exists source_base_availability integer,
  add column if not exists target_base_availability integer,
  add column if not exists source_booked_at_start integer,
  add column if not exists target_booked_at_start integer;

alter table public.room_sale_overnight_watches
  drop constraint if exists room_sale_overnight_watches_pool_mode_check;
alter table public.room_sale_overnight_watches
  add constraint room_sale_overnight_watches_pool_mode_check
  check (pool_mode in ('legacy_full','incremental'));

-- No existing watches are converted or reopened by this migration.
comment on column public.room_sale_overnight_watches.pool_mode is
  'incremental: the target category retains its ordinary units plus shared_units borrowed from the source; legacy_full: original full-pair behavior';
