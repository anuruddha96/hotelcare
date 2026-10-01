-- Complete the SLNT Team B workbook-driven linen and operating-room configuration.
--
-- This migration is intentionally tenant-scoped. It creates the exact SLNT linen
-- catalogue from the supplied workbook, records the per-guest standard quantities
-- on Team B rooms, marks dish-towel rooms, and makes the single workbook-missing
-- Sobi unit persistently non-operating without deleting history.

begin;

-- Fail closed if the production Team B mapping no longer matches the approved
-- workbook. The workbook contains exactly 46 Team B units.
do $$
declare
  v_team_id uuid;
  v_room_count integer;
begin
  select id into v_team_id
  from public.housekeeping_teams
  where organization_slug = 'slnt'
    and hotel_id = 'slnt-group'
    and code = 'team-b'
    and is_active = true
  limit 1;

  if v_team_id is null then
    raise exception 'Active SLNT Team B is not configured.';
  end if;

  select count(*)::integer into v_room_count
  from public.housekeeping_team_rooms
  where team_id = v_team_id
    and is_active = true;

  if v_room_count <> 46 then
    raise exception 'SLNT Team B workbook mismatch: expected 46 active rooms, found %.', v_room_count;
  end if;
end;
$$;

-- Exact workbook catalogue. Quantities are operational rules, not inventory
-- stock: per guest = 1 bedsheet, 1 duvet cover, 2 pillowcases, 1 small towel,
-- 1 large towel, 1 bathmat. Dish towel is unit-specific and handled below.
with desired(name, display_name, sort_order) as (
  values
    ('slnt_bedsheet', 'Bedsheet', 1),
    ('slnt_duvet_cover', 'Duvet cover', 2),
    ('slnt_pillowcase', 'Pillowcase', 3),
    ('slnt_small_towel', 'Small towel', 4),
    ('slnt_large_towel', 'Large towel', 5),
    ('slnt_bathmat', 'Bathmat', 6),
    ('slnt_dish_towel', 'Dish towel', 7)
)
insert into public.dirty_linen_items (name, display_name, is_active, sort_order, hotel_scope)
select d.name, d.display_name, true, d.sort_order, 'slnt'
from desired d
where not exists (
  select 1
  from public.dirty_linen_items existing
  where existing.name = d.name
    and existing.hotel_scope = 'slnt'
);

with desired(name, display_name, sort_order) as (
  values
    ('slnt_bedsheet', 'Bedsheet', 1),
    ('slnt_duvet_cover', 'Duvet cover', 2),
    ('slnt_pillowcase', 'Pillowcase', 3),
    ('slnt_small_towel', 'Small towel', 4),
    ('slnt_large_towel', 'Large towel', 5),
    ('slnt_bathmat', 'Bathmat', 6),
    ('slnt_dish_towel', 'Dish towel', 7)
)
update public.dirty_linen_items item
set display_name = desired.display_name,
    sort_order = desired.sort_order,
    is_active = true,
    updated_at = now()
from desired
where item.hotel_scope = 'slnt'
  and item.name = desired.name;

-- Store the workbook standard on every active Team B room. This keeps the
-- operational rule available for future automated linen calculations while the
-- current Dirty Linen UI continues to record the actually collected quantities.
update public.rooms r
set pms_metadata = coalesce(r.pms_metadata, '{}'::jsonb)
  || jsonb_build_object(
    'slntLinen',
    coalesce(r.pms_metadata->'slntLinen', '{}'::jsonb)
      || jsonb_build_object(
        'standardPerGuest', jsonb_build_object(
          'bedsheet', 1,
          'duvet_cover', 1,
          'pillowcase', 2,
          'small_towel', 1,
          'large_towel', 1,
          'bathmat', 1
        ),
        'requiresDishTowel', false,
        'source', 'SLNT workbook 2026-09-30'
      )
  ),
  updated_at = now()
where r.organization_slug = 'slnt'
  and exists (
    select 1
    from public.housekeeping_team_rooms htr
    join public.housekeeping_teams ht on ht.id = htr.team_id
    where htr.room_id = r.id
      and htr.is_active = true
      and ht.is_active = true
      and ht.organization_slug = 'slnt'
      and ht.hotel_id = 'slnt-group'
      and ht.code = 'team-b'
  );

-- Team B workbook exceptions: the three named apartments plus K4 Rooms 1-7
-- collect one dish towel in addition to the standard per-guest linen.
update public.rooms r
set pms_metadata = jsonb_set(
      coalesce(r.pms_metadata, '{}'::jsonb),
      '{slntLinen,requiresDishTowel}',
      'true'::jsonb,
      true
    ),
    updated_at = now()
where r.organization_slug = 'slnt'
  and exists (
    select 1
    from public.housekeeping_team_rooms htr
    join public.housekeeping_teams ht on ht.id = htr.team_id
    where htr.room_id = r.id
      and htr.is_active = true
      and ht.is_active = true
      and ht.organization_slug = 'slnt'
      and ht.hotel_id = 'slnt-group'
      and ht.code = 'team-b'
  )
  and (
    r.room_number in ('Be Local Budapest Apartment', 'Dorothilux Apartment', 'Giselle Apartment')
    or r.room_number ~ '^K4\s*[–-]\s*Room [1-7]$'
  );

-- The supplied active workbook contains 60 SLNT units total (46 Team B + 14
-- Team A). Sobi is the one current HotelCare room absent from that active list.
-- Keep its record/history, but make the exclusion persistent across PMS refreshes.
update public.rooms
set status = 'out_of_order',
    pms_metadata = coalesce(pms_metadata, '{}'::jsonb)
      || jsonb_build_object(
        'manualHousekeepingHold', true,
        'slntOperational', jsonb_build_object(
          'status', 'inactive_workbook',
          'reason', 'Not present in SLNT active accommodation workbook 2026-09-30',
          'source', 'SLNT workbook 2026-09-30'
        )
      ),
    updated_at = now()
where organization_slug = 'slnt'
  and room_number = 'Sobi Apartment Budapest';

commit;
