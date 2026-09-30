-- SLNT Team B operational cleanup.
-- 1) Add the one extra dirty-linen item requested by SLNT.
-- 2) Mark only the mapped Team B units that require a dish towel.
-- 3) Remove the one stale workbook-missing SLNT unit from operating inventory.
-- No RD Hotels rows are touched.

begin;

insert into public.dirty_linen_items (name, display_name, is_active, sort_order, hotel_scope)
select 'slnt_dish_towel', 'Dish towel', true, 7, 'slnt'
where not exists (
  select 1
  from public.dirty_linen_items
  where name = 'slnt_dish_towel' and hotel_scope = 'slnt'
);

-- Keep the existing global catalogue readable everywhere, preserve the Gozsdu
-- scoped catalogue, and expose SLNT-scoped additions only inside the SLNT tenant.
drop policy if exists "Read own venue linen catalogue" on public.dirty_linen_items;
create policy "Read own venue linen catalogue"
on public.dirty_linen_items
for select
to authenticated
using (
  hotel_scope is null
  or (
    hotel_scope = 'gozsdu-court'
    and get_user_assigned_hotel(auth.uid()) = any (array['gozsdu-court'::text, 'Gozsdu Court Budapest'::text])
  )
  or (
    hotel_scope = 'slnt'
    and get_user_organization_slug(auth.uid()) in ('slnt', 'slnt-group')
  )
);

-- The workbook specifies one additional dish towel only for Be Local,
-- Dorothilux, Giselle and K4 Rooms 1-7. Restrict the update to rooms that are
-- actively mapped to SLNT Team B; Team A and every other tenant remain untouched.
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
      and ht.code = 'team-b'
  )
  and (
    r.room_number in ('Be Local Budapest Apartment', 'Dorothilux Apartment', 'Giselle Apartment')
    or r.room_number like 'K4 %Room %'
  );

-- Sobi is not present in the supplied active apartment workbook. Do not delete
-- the row or its history; make only this exact SLNT unit non-operating.
update public.rooms
set status = 'out_of_order', updated_at = now()
where organization_slug = 'slnt'
  and room_number = 'Sobi Apartment Budapest'
  and status is distinct from 'out_of_order';

commit;
