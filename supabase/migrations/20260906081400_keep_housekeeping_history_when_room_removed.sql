-- Historical room records must survive room remapping/deletion.
alter table public.housekeeping_room_snapshots
  drop constraint if exists housekeeping_room_snapshots_room_id_fkey;
