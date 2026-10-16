-- Explicit provenance and verified status for shared physical rooms marketed
-- under two categories (e.g. Ottofiori Triple -> additional Queen).
-- Schema only. This migration does NOT schedule jobs or change live inventory.
alter table public.room_sale_overnight_watches
  add column if not exists physical_source_obk_id text,
  add column if not exists virtual_listing_obk_id text,
  add column if not exists activated_physical_available integer
    check (activated_physical_available is null or activated_physical_available >= 0),
  add column if not exists activated_virtual_available integer
    check (activated_virtual_available is null or activated_virtual_available >= 0),
  add column if not exists last_verified_physical_availability integer
    check (last_verified_physical_availability is null or last_verified_physical_availability >= 0),
  add column if not exists last_verified_virtual_availability integer
    check (last_verified_virtual_availability is null or last_verified_virtual_availability >= 0),
  add column if not exists last_verified_at timestamptz;

-- Existing watches already store original physical category in second_obk_id and
-- additional listing in first_obk_id. No availability or booking rows are touched.
update public.room_sale_overnight_watches
set physical_source_obk_id=coalesce(physical_source_obk_id,second_obk_id),
    virtual_listing_obk_id=coalesce(virtual_listing_obk_id,first_obk_id)
where physical_source_obk_id is null or virtual_listing_obk_id is null;

comment on column public.room_sale_overnight_watches.physical_source_obk_id is
'Previo physical source category for a shared offer; category-level proof, not an invented room ID.';
comment on column public.room_sale_overnight_watches.virtual_listing_obk_id is
'Alternative room category. Only its explicitly shared availability is protected; do not infer physical inventory from a manual +N override.';
comment on column public.room_sale_overnight_watches.last_verified_at is
'Last time both Previo room-type availability values were read back and checked against physical capacity.';

-- A manager may end the alternative offer after a verified Previo close.
-- Paused watches are excluded from the polling worker, but remain auditable.
alter table public.room_sale_overnight_watches
  drop constraint if exists room_sale_overnight_watches_status_check;
alter table public.room_sale_overnight_watches
  add constraint room_sale_overnight_watches_status_check
  check (status in ('active','triggered','closed','needs_review','expired','paused'));
alter table public.room_sale_overnight_watches
  add column if not exists paused_at timestamptz,
  add column if not exists paused_by uuid references public.profiles(id);
