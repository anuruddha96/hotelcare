-- Shared category availability is a virtual listing of already existing physical rooms.
-- Default 1 preserves previously-created Ottofiori watches.
alter table public.room_sale_overnight_watches
  add column if not exists shared_units integer not null default 1
  check (shared_units between 1 and 20);
alter table public.room_sale_overnight_watches
  add column if not exists physical_capacity integer
  check (physical_capacity is null or physical_capacity > 0);
alter table public.room_sale_overnight_watches
  add column if not exists last_confirmed_remaining integer
  check (last_confirmed_remaining is null or last_confirmed_remaining >= 0);
comment on column public.room_sale_overnight_watches.shared_units is
'Physical rooms shown under both categories, not additional property capacity. Recalculate both counts when a booking changes availability.';
