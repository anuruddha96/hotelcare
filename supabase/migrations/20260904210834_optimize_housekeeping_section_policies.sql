-- Keep housekeeping-map authorization fast as room and task counts grow.
-- Read policies are separate from manager writes so PostgreSQL evaluates only
-- one permissive policy for each table/action.

create index if not exists hotel_housekeeping_sections_created_by_idx
  on public.hotel_housekeeping_sections (created_by);
create index if not exists hotel_housekeeping_section_rooms_created_by_idx
  on public.hotel_housekeeping_section_rooms (created_by);
create index if not exists hotel_housekeeping_section_tasks_created_by_idx
  on public.hotel_housekeeping_section_tasks (created_by);

drop policy if exists "Hotel staff view housekeeping sections"
  on public.hotel_housekeeping_sections;
drop policy if exists "Eligible managers manage housekeeping sections"
  on public.hotel_housekeeping_sections;

create policy "Hotel staff view housekeeping sections"
on public.hotel_housekeeping_sections for select to authenticated
using (public.user_can_access_hotel((select auth.uid()), hotel_name));

create policy "Eligible managers create housekeeping sections"
on public.hotel_housekeeping_sections for insert to authenticated
with check (
  public.get_user_role((select auth.uid()))::text in (
    'admin', 'top_management', 'top_management_manager', 'manager',
    'housekeeping_manager', 'supervisor'
  )
  and public.user_can_access_hotel((select auth.uid()), hotel_name)
);

create policy "Eligible managers update housekeeping sections"
on public.hotel_housekeeping_sections for update to authenticated
using (
  public.get_user_role((select auth.uid()))::text in (
    'admin', 'top_management', 'top_management_manager', 'manager',
    'housekeeping_manager', 'supervisor'
  )
  and public.user_can_access_hotel((select auth.uid()), hotel_name)
)
with check (
  public.get_user_role((select auth.uid()))::text in (
    'admin', 'top_management', 'top_management_manager', 'manager',
    'housekeeping_manager', 'supervisor'
  )
  and public.user_can_access_hotel((select auth.uid()), hotel_name)
);

create policy "Eligible managers delete housekeeping sections"
on public.hotel_housekeeping_sections for delete to authenticated
using (
  public.get_user_role((select auth.uid()))::text in (
    'admin', 'top_management', 'top_management_manager', 'manager',
    'housekeeping_manager', 'supervisor'
  )
  and public.user_can_access_hotel((select auth.uid()), hotel_name)
);

drop policy if exists "Hotel staff view housekeeping room sections"
  on public.hotel_housekeeping_section_rooms;
drop policy if exists "Eligible managers map housekeeping rooms"
  on public.hotel_housekeeping_section_rooms;

create policy "Hotel staff view housekeeping room sections"
on public.hotel_housekeeping_section_rooms for select to authenticated
using (
  exists (
    select 1
    from public.hotel_housekeeping_sections section
    join public.rooms room on room.id = hotel_housekeeping_section_rooms.room_id
    where section.id = hotel_housekeeping_section_rooms.section_id
      and room.hotel = section.hotel_name
      and public.user_can_access_hotel((select auth.uid()), section.hotel_name)
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
    join public.rooms room on room.id = hotel_housekeeping_section_rooms.room_id
    where section.id = hotel_housekeeping_section_rooms.section_id
      and room.hotel = section.hotel_name
      and public.user_can_access_hotel((select auth.uid()), section.hotel_name)
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
    join public.rooms room on room.id = hotel_housekeeping_section_rooms.room_id
    where section.id = hotel_housekeeping_section_rooms.section_id
      and room.hotel = section.hotel_name
      and public.user_can_access_hotel((select auth.uid()), section.hotel_name)
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
    join public.rooms room on room.id = hotel_housekeeping_section_rooms.room_id
    where section.id = hotel_housekeeping_section_rooms.section_id
      and room.hotel = section.hotel_name
      and public.user_can_access_hotel((select auth.uid()), section.hotel_name)
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
    join public.rooms room on room.id = hotel_housekeeping_section_rooms.room_id
    where section.id = hotel_housekeeping_section_rooms.section_id
      and room.hotel = section.hotel_name
      and public.user_can_access_hotel((select auth.uid()), section.hotel_name)
  )
);

drop policy if exists "Hotel staff view housekeeping section tasks"
  on public.hotel_housekeeping_section_tasks;
drop policy if exists "Eligible managers manage housekeeping section tasks"
  on public.hotel_housekeeping_section_tasks;

create policy "Hotel staff view housekeeping section tasks"
on public.hotel_housekeeping_section_tasks for select to authenticated
using (
  exists (
    select 1
    from public.hotel_housekeeping_sections section
    where section.id = hotel_housekeeping_section_tasks.section_id
      and public.user_can_access_hotel((select auth.uid()), section.hotel_name)
  )
);

create policy "Eligible managers create housekeeping section tasks"
on public.hotel_housekeeping_section_tasks for insert to authenticated
with check (
  public.get_user_role((select auth.uid()))::text in (
    'admin', 'top_management', 'top_management_manager', 'manager',
    'housekeeping_manager', 'supervisor'
  )
  and exists (
    select 1
    from public.hotel_housekeeping_sections section
    where section.id = hotel_housekeeping_section_tasks.section_id
      and public.user_can_access_hotel((select auth.uid()), section.hotel_name)
  )
);

create policy "Eligible managers update housekeeping section tasks"
on public.hotel_housekeeping_section_tasks for update to authenticated
using (
  public.get_user_role((select auth.uid()))::text in (
    'admin', 'top_management', 'top_management_manager', 'manager',
    'housekeeping_manager', 'supervisor'
  )
  and exists (
    select 1
    from public.hotel_housekeeping_sections section
    where section.id = hotel_housekeeping_section_tasks.section_id
      and public.user_can_access_hotel((select auth.uid()), section.hotel_name)
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
    where section.id = hotel_housekeeping_section_tasks.section_id
      and public.user_can_access_hotel((select auth.uid()), section.hotel_name)
  )
);

create policy "Eligible managers delete housekeeping section tasks"
on public.hotel_housekeeping_section_tasks for delete to authenticated
using (
  public.get_user_role((select auth.uid()))::text in (
    'admin', 'top_management', 'top_management_manager', 'manager',
    'housekeeping_manager', 'supervisor'
  )
  and exists (
    select 1
    from public.hotel_housekeeping_sections section
    where section.id = hotel_housekeeping_section_tasks.section_id
      and public.user_can_access_hotel((select auth.uid()), section.hotel_name)
  )
);

drop policy if exists "Eligible managers manage mapped section tasks"
  on public.general_tasks;
create policy "Eligible managers manage mapped section tasks"
on public.general_tasks for all to authenticated
using (
  housekeeping_section_task_id is not null
  and public.get_user_role((select auth.uid()))::text in (
    'admin', 'top_management', 'top_management_manager', 'manager',
    'housekeeping_manager', 'supervisor'
  )
  and public.user_can_access_hotel((select auth.uid()), hotel)
)
with check (
  housekeeping_section_task_id is not null
  and assigned_by = (select auth.uid())
  and public.get_user_role((select auth.uid()))::text in (
    'admin', 'top_management', 'top_management_manager', 'manager',
    'housekeeping_manager', 'supervisor'
  )
  and public.user_can_access_hotel((select auth.uid()), hotel)
);
