alter table public.daily_overview_snapshots
  add column if not exists room_number text,
  add column if not exists room_type_code text,
  add column if not exists room_suffix text;
create index if not exists daily_overview_snapshots_hotel_date_room_idx
  on public.daily_overview_snapshots (hotel_id, business_date, room_number);