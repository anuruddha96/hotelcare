-- Housekeeping rooms use the canonical hotel_configurations.hotel_id, while
-- the room-map UI can receive and persist the hotel's display name.  Requiring
-- those raw values to be equal blocked legitimate mappings such as:
--   rooms.hotel = 'mika-downtown'
--   sections.hotel_name = 'Hotel Mika Downtown'
-- Resolve both values through the same hotel configuration row so aliases are
-- accepted without allowing a room to be mapped into another hotel's section.

create index if not exists hotel_configurations_hotel_name_idx
  on public.hotel_configurations (hotel_name);

drop policy if exists "Hotel staff view housekeeping room sections"
  on public.hotel_housekeeping_section_rooms;
drop policy if exists "Eligible managers map housekeeping rooms"
  on public.hotel_housekeeping_section_rooms;
drop policy if exists "Eligible managers create housekeeping room mappings"
  on public.hotel_housekeeping_section_rooms;
drop policy if exists "Eligible managers update housekeeping room mappings"
  on public.hotel_housekeeping_section_rooms;
drop policy if exists "Eligible managers delete housekeeping room mappings"
  on public.hotel_housekeeping_section_rooms;

create policy "Hotel staff view housekeeping room sections"
on public.hotel_housekeeping_section_rooms for select to authenticated
using (
  exists (
    select 1
    from public.hotel_housekeeping_sections section
    join public.rooms room
      on room.id = hotel_housekeeping_section_rooms.room_id
    join public.hotel_configurations hotel
      on (hotel.hotel_id = room.hotel or hotel.hotel_name = room.hotel)
     and (hotel.hotel_id = section.hotel_name or hotel.hotel_name = section.hotel_name)
    where section.id = hotel_housekeeping_section_rooms.section_id
      and public.user_can_access_hotel((select auth.uid()), hotel.hotel_id)
  )
);

create policy "Eligible managers create housekeeping room mappings"
on public.hotel_housekeeping_section_rooms for insert to authenticated
with check (
  public.get_user_role((select auth.uid()))::text in (
    'admin', 'top_management', 'top_management_manager', 'manager',
    'housekeeping_manager', 'supervisor'
  )
  and exists (
    select 1
    from public.hotel_housekeeping_sections section
    join public.rooms room
      on room.id = hotel_housekeeping_section_rooms.room_id
    join public.hotel_configurations hotel
      on (hotel.hotel_id = room.hotel or hotel.hotel_name = room.hotel)
     and (hotel.hotel_id = section.hotel_name or hotel.hotel_name = section.hotel_name)
    where section.id = hotel_housekeeping_section_rooms.section_id
      and public.user_can_access_hotel((select auth.uid()), hotel.hotel_id)
  )
);

create policy "Eligible managers update housekeeping room mappings"
on public.hotel_housekeeping_section_rooms for update to authenticated
using (
  public.get_user_role((select auth.uid()))::text in (
    'admin', 'top_management', 'top_management_manager', 'manager',
    'housekeeping_manager', 'supervisor'
  )
  and exists (
    select 1
    from public.hotel_housekeeping_sections section
    join public.rooms room
      on room.id = hotel_housekeeping_section_rooms.room_id
    join public.hotel_configurations hotel
      on (hotel.hotel_id = room.hotel or hotel.hotel_name = room.hotel)
     and (hotel.hotel_id = section.hotel_name or hotel.hotel_name = section.hotel_name)
    where section.id = hotel_housekeeping_section_rooms.section_id
      and public.user_can_access_hotel((select auth.uid()), hotel.hotel_id)
  )
)
with check (
  public.get_user_role((select auth.uid()))::text in (
    'admin', 'top_management', 'top_management_manager', 'manager',
    'housekeeping_manager', 'supervisor'
  )
  and exists (
    select 1
    from public.hotel_housekeeping_sections section
    join public.rooms room
      on room.id = hotel_housekeeping_section_rooms.room_id
    join public.hotel_configurations hotel
      on (hotel.hotel_id = room.hotel or hotel.hotel_name = room.hotel)
     and (hotel.hotel_id = section.hotel_name or hotel.hotel_name = section.hotel_name)
    where section.id = hotel_housekeeping_section_rooms.section_id
      and public.user_can_access_hotel((select auth.uid()), hotel.hotel_id)
  )
);

create policy "Eligible managers delete housekeeping room mappings"
on public.hotel_housekeeping_section_rooms for delete to authenticated
using (
  public.get_user_role((select auth.uid()))::text in (
    'admin', 'top_management', 'top_management_manager', 'manager',
    'housekeeping_manager', 'supervisor'
  )
  and exists (
    select 1
    from public.hotel_housekeeping_sections section
    join public.rooms room
      on room.id = hotel_housekeeping_section_rooms.room_id
    join public.hotel_configurations hotel
      on (hotel.hotel_id = room.hotel or hotel.hotel_name = room.hotel)
     and (hotel.hotel_id = section.hotel_name or hotel.hotel_name = section.hotel_name)
    where section.id = hotel_housekeeping_section_rooms.section_id
      and public.user_can_access_hotel((select auth.uid()), hotel.hotel_id)
  )
);
