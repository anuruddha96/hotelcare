-- Lost & Found reports created outside a guest room need a first-class
-- location. Room-linked reports continue to use room_id as the source of truth.
-- Nullable for existing records and current housekeeping room reports.
alter table public.lost_and_found
  add column if not exists found_location text;

comment on column public.lost_and_found.found_location is
  'Reception, Lobby, other hotel area, or user-entered location; null for room-linked reports.';
