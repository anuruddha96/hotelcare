-- Responsive housekeeping sections are the operational source of truth for
-- locality-aware room assignment.  They intentionally sit beside the legacy
-- visual floor-layout table so existing properties are not disturbed.

create table if not exists public.hotel_housekeeping_sections (
  id uuid primary key default gen_random_uuid(),
  hotel_name text not null,
  name text not null,
  floor_number integer not null,
  description text,
  color text not null default 'sky',
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hotel_housekeeping_sections_name_not_blank check (btrim(name) <> ''),
  constraint hotel_housekeeping_sections_floor_range check (floor_number between -5 and 99),
  constraint hotel_housekeeping_sections_color_check check (
    color in ('sky', 'emerald', 'amber', 'violet', 'rose', 'slate')
  ),
  constraint hotel_housekeeping_sections_hotel_name_key unique (hotel_name, name)
);

create index if not exists hotel_housekeeping_sections_hotel_floor_idx
  on public.hotel_housekeeping_sections (hotel_name, floor_number, sort_order);

create table if not exists public.hotel_housekeeping_section_rooms (
  room_id uuid primary key references public.rooms(id) on delete cascade,
  section_id uuid not null references public.hotel_housekeeping_sections(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists hotel_housekeeping_section_rooms_section_idx
  on public.hotel_housekeeping_section_rooms (section_id);

create table if not exists public.hotel_housekeeping_section_tasks (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.hotel_housekeeping_sections(id) on delete cascade,
  task_name text not null,
  icon text not null default '🧹',
  instructions text,
  estimated_duration integer not null default 15,
  auto_assign boolean not null default true,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hotel_housekeeping_section_tasks_name_not_blank check (btrim(task_name) <> ''),
  constraint hotel_housekeeping_section_tasks_duration_check check (estimated_duration between 1 and 480),
  constraint hotel_housekeeping_section_tasks_section_name_key unique (section_id, task_name)
);

create index if not exists hotel_housekeeping_section_tasks_section_idx
  on public.hotel_housekeeping_section_tasks (section_id, sort_order);

alter table public.general_tasks
  add column if not exists housekeeping_section_id uuid
    references public.hotel_housekeeping_sections(id) on delete set null,
  add column if not exists housekeeping_section_task_id uuid
    references public.hotel_housekeeping_section_tasks(id) on delete set null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'general_tasks_section_task_date_key'
      and conrelid = 'public.general_tasks'::regclass
  ) then
    alter table public.general_tasks
      add constraint general_tasks_section_task_date_key
      unique (housekeeping_section_task_id, assigned_date);
  end if;
end
$$;

create index if not exists general_tasks_housekeeping_section_date_idx
  on public.general_tasks (housekeeping_section_id, assigned_date)
  where housekeeping_section_id is not null;

drop trigger if exists update_hotel_housekeeping_sections_updated_at
  on public.hotel_housekeeping_sections;
create trigger update_hotel_housekeeping_sections_updated_at
before update on public.hotel_housekeeping_sections
for each row execute function public.update_updated_at_column();

drop trigger if exists update_hotel_housekeeping_section_rooms_updated_at
  on public.hotel_housekeeping_section_rooms;
create trigger update_hotel_housekeeping_section_rooms_updated_at
before update on public.hotel_housekeeping_section_rooms
for each row execute function public.update_updated_at_column();

drop trigger if exists update_hotel_housekeeping_section_tasks_updated_at
  on public.hotel_housekeeping_section_tasks;
create trigger update_hotel_housekeeping_section_tasks_updated_at
before update on public.hotel_housekeeping_section_tasks
for each row execute function public.update_updated_at_column();

alter table public.hotel_housekeeping_sections enable row level security;
alter table public.hotel_housekeeping_section_rooms enable row level security;
alter table public.hotel_housekeeping_section_tasks enable row level security;

grant select, insert, update, delete on public.hotel_housekeeping_sections to authenticated;
grant select, insert, update, delete on public.hotel_housekeeping_section_rooms to authenticated;
grant select, insert, update, delete on public.hotel_housekeeping_section_tasks to authenticated;
grant all on public.hotel_housekeeping_sections to service_role;
grant all on public.hotel_housekeeping_section_rooms to service_role;
grant all on public.hotel_housekeeping_section_tasks to service_role;

drop policy if exists "Hotel staff view housekeeping sections" on public.hotel_housekeeping_sections;
create policy "Hotel staff view housekeeping sections"
on public.hotel_housekeeping_sections for select to authenticated
using (public.user_can_access_hotel(auth.uid(), hotel_name));

drop policy if exists "Eligible managers manage housekeeping sections" on public.hotel_housekeeping_sections;
create policy "Eligible managers manage housekeeping sections"
on public.hotel_housekeeping_sections for all to authenticated
using (
  public.get_user_role(auth.uid())::text in (
    'admin', 'top_management', 'top_management_manager', 'manager',
    'housekeeping_manager', 'supervisor'
  )
  and public.user_can_access_hotel(auth.uid(), hotel_name)
)
with check (
  public.get_user_role(auth.uid())::text in (
    'admin', 'top_management', 'top_management_manager', 'manager',
    'housekeeping_manager', 'supervisor'
  )
  and public.user_can_access_hotel(auth.uid(), hotel_name)
);

drop policy if exists "Hotel staff view housekeeping room sections" on public.hotel_housekeeping_section_rooms;
create policy "Hotel staff view housekeeping room sections"
on public.hotel_housekeeping_section_rooms for select to authenticated
using (
  exists (
    select 1
    from public.hotel_housekeeping_sections section
    join public.rooms room on room.id = hotel_housekeeping_section_rooms.room_id
    where section.id = hotel_housekeeping_section_rooms.section_id
      and room.hotel = section.hotel_name
      and public.user_can_access_hotel(auth.uid(), section.hotel_name)
  )
);

drop policy if exists "Eligible managers map housekeeping rooms" on public.hotel_housekeeping_section_rooms;
create policy "Eligible managers map housekeeping rooms"
on public.hotel_housekeeping_section_rooms for all to authenticated
using (
  public.get_user_role(auth.uid())::text in (
    'admin', 'top_management', 'top_management_manager', 'manager',
    'housekeeping_manager', 'supervisor'
  )
  and exists (
    select 1
    from public.hotel_housekeeping_sections section
    join public.rooms room on room.id = hotel_housekeeping_section_rooms.room_id
    where section.id = hotel_housekeeping_section_rooms.section_id
      and room.hotel = section.hotel_name
      and public.user_can_access_hotel(auth.uid(), section.hotel_name)
  )
)
with check (
  public.get_user_role(auth.uid())::text in (
    'admin', 'top_management', 'top_management_manager', 'manager',
    'housekeeping_manager', 'supervisor'
  )
  and exists (
    select 1
    from public.hotel_housekeeping_sections section
    join public.rooms room on room.id = hotel_housekeeping_section_rooms.room_id
    where section.id = hotel_housekeeping_section_rooms.section_id
      and room.hotel = section.hotel_name
      and public.user_can_access_hotel(auth.uid(), section.hotel_name)
  )
);

drop policy if exists "Hotel staff view housekeeping section tasks" on public.hotel_housekeeping_section_tasks;
create policy "Hotel staff view housekeeping section tasks"
on public.hotel_housekeeping_section_tasks for select to authenticated
using (
  exists (
    select 1
    from public.hotel_housekeeping_sections section
    where section.id = hotel_housekeeping_section_tasks.section_id
      and public.user_can_access_hotel(auth.uid(), section.hotel_name)
  )
);

drop policy if exists "Eligible managers manage housekeeping section tasks" on public.hotel_housekeeping_section_tasks;
create policy "Eligible managers manage housekeeping section tasks"
on public.hotel_housekeeping_section_tasks for all to authenticated
using (
  public.get_user_role(auth.uid())::text in (
    'admin', 'top_management', 'top_management_manager', 'manager',
    'housekeeping_manager', 'supervisor'
  )
  and exists (
    select 1
    from public.hotel_housekeeping_sections section
    where section.id = hotel_housekeeping_section_tasks.section_id
      and public.user_can_access_hotel(auth.uid(), section.hotel_name)
  )
)
with check (
  public.get_user_role(auth.uid())::text in (
    'admin', 'top_management', 'top_management_manager', 'manager',
    'housekeeping_manager', 'supervisor'
  )
  and exists (
    select 1
    from public.hotel_housekeeping_sections section
    where section.id = hotel_housekeeping_section_tasks.section_id
      and public.user_can_access_hotel(auth.uid(), section.hotel_name)
  )
);

-- Top management and supervisors can manage only the generated section tasks
-- for hotels they can access. Existing general-task policies remain unchanged.
drop policy if exists "Eligible managers manage mapped section tasks" on public.general_tasks;
create policy "Eligible managers manage mapped section tasks"
on public.general_tasks for all to authenticated
using (
  housekeeping_section_task_id is not null
  and public.get_user_role(auth.uid())::text in (
    'admin', 'top_management', 'top_management_manager', 'manager',
    'housekeeping_manager', 'supervisor'
  )
  and public.user_can_access_hotel(auth.uid(), hotel)
)
with check (
  housekeeping_section_task_id is not null
  and assigned_by = auth.uid()
  and public.get_user_role(auth.uid())::text in (
    'admin', 'top_management', 'top_management_manager', 'manager',
    'housekeeping_manager', 'supervisor'
  )
  and public.user_can_access_hotel(auth.uid(), hotel)
);

-- Sync active area templates into the daily general-task board. The function
-- is security invoker so table RLS remains authoritative.
create or replace function public.assign_housekeeping_section_tasks(
  p_hotel_name text,
  p_assigned_date date,
  p_assignments jsonb
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  if auth.uid() is null
     or public.get_user_role(auth.uid())::text not in (
       'admin', 'top_management', 'top_management_manager', 'manager',
       'housekeeping_manager', 'supervisor'
     )
     or not public.user_can_access_hotel(auth.uid(), p_hotel_name) then
    raise exception 'Housekeeping section assignment is not allowed'
      using errcode = '42501';
  end if;

  if p_assigned_date is null
     or jsonb_typeof(coalesce(p_assignments, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_assignments, '[]'::jsonb)) > 200 then
    raise exception 'Invalid housekeeping section assignments'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_assignments, '[]'::jsonb))
      as assignment(section_task_id uuid, assigned_to uuid)
    left join public.hotel_housekeeping_section_tasks task
      on task.id = assignment.section_task_id
    left join public.hotel_housekeeping_sections section
      on section.id = task.section_id
    where task.id is null
       or assignment.assigned_to is null
       or section.hotel_name <> p_hotel_name
       or not task.is_active
       or not task.auto_assign
       or not public.user_can_access_hotel(assignment.assigned_to, p_hotel_name)
  ) then
    raise exception 'A section task or assignee does not belong to this hotel'
      using errcode = '42501';
  end if;

  insert into public.general_tasks (
    task_name,
    task_description,
    task_type,
    assigned_to,
    assigned_by,
    assigned_date,
    status,
    priority,
    estimated_duration,
    hotel,
    organization_slug,
    housekeeping_section_id,
    housekeeping_section_task_id
  )
  select
    task.task_name,
    concat(
      'Mapped section: ', section.name,
      case
        when nullif(btrim(task.instructions), '') is not null
          then E'\n' || btrim(task.instructions)
        else ''
      end
    ),
    'section_cleaning',
    assignment.assigned_to,
    auth.uid(),
    p_assigned_date,
    'assigned',
    1,
    task.estimated_duration,
    p_hotel_name,
    (select profile.organization_slug from public.profiles profile where profile.id = auth.uid()),
    section.id,
    task.id
  from jsonb_to_recordset(coalesce(p_assignments, '[]'::jsonb))
    as assignment(section_task_id uuid, assigned_to uuid)
  join public.hotel_housekeeping_section_tasks task
    on task.id = assignment.section_task_id
  join public.hotel_housekeeping_sections section
    on section.id = task.section_id
  where section.hotel_name = p_hotel_name
    and task.is_active
    and task.auto_assign
  on conflict (housekeeping_section_task_id, assigned_date)
  do update set
    assigned_to = excluded.assigned_to,
    assigned_by = excluded.assigned_by,
    task_name = excluded.task_name,
    task_description = excluded.task_description,
    estimated_duration = excluded.estimated_duration,
    housekeeping_section_id = excluded.housekeeping_section_id,
    updated_at = now()
  where general_tasks.status = 'assigned'
    and general_tasks.hotel = excluded.hotel;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.assign_housekeeping_section_tasks(text, date, jsonb)
  from public, anon;
grant execute on function public.assign_housekeeping_section_tasks(text, date, jsonb)
  to authenticated, service_role;

-- Hotel Memories Budapest: an initial practical map derived only from the
-- manager-provided room anchors. Other hotels receive no data changes.
insert into public.hotel_housekeeping_sections (
  hotel_name, name, floor_number, description, color, sort_order
)
select
  'Hotel Memories Budapest', seed.name, seed.floor_number,
  seed.description, seed.color, seed.sort_order
from (
  values
    ('Ground Floor', 0, 'Ground-floor rooms and public facilities', 'emerald', 0),
    ('100 Side', 1, 'First-floor room section', 'sky', 10),
    ('Middle', 1, 'Middle section anchored around room 112', 'violet', 20),
    ('131 / 137 / 144 Side', 1, 'Service section anchored by rooms 131, 137 and 144', 'amber', 30),
    ('200 Side', 2, 'Second-floor room section', 'rose', 40),
    ('300 Side', 3, 'Third-floor room section', 'slate', 50)
) as seed(name, floor_number, description, color, sort_order)
where exists (
  select 1 from public.hotel_configurations
  where hotel_name = 'Hotel Memories Budapest'
)
on conflict (hotel_name, name) do update set
  floor_number = excluded.floor_number,
  description = excluded.description,
  color = excluded.color,
  sort_order = excluded.sort_order,
  is_active = true;

insert into public.hotel_housekeeping_section_rooms (room_id, section_id)
select
  room.id,
  section.id
from public.rooms room
join public.hotel_housekeeping_sections section
  on section.hotel_name = 'Hotel Memories Budapest'
 and section.name = case
   when room.room_number = '112' then 'Middle'
   when room.room_number in ('131', '137', '144') then '131 / 137 / 144 Side'
   when coalesce(room.floor_number, floor(nullif(regexp_replace(room.room_number, '[^0-9]', '', 'g'), '')::numeric / 100)::integer) = 0 then 'Ground Floor'
   when coalesce(room.floor_number, floor(nullif(regexp_replace(room.room_number, '[^0-9]', '', 'g'), '')::numeric / 100)::integer) = 1 then '100 Side'
   when coalesce(room.floor_number, floor(nullif(regexp_replace(room.room_number, '[^0-9]', '', 'g'), '')::numeric / 100)::integer) = 2 then '200 Side'
   when coalesce(room.floor_number, floor(nullif(regexp_replace(room.room_number, '[^0-9]', '', 'g'), '')::numeric / 100)::integer) = 3 then '300 Side'
   else null
 end
where room.hotel = 'Hotel Memories Budapest'
on conflict (room_id) do update set
  section_id = excluded.section_id,
  updated_at = now();

with task_seed(section_name, task_name, icon, instructions, estimated_duration, sort_order) as (
  values
    ('Ground Floor', 'Storage 1', '📦', 'Clean and organize the first ground-floor storage area.', 10, 10),
    ('Ground Floor', 'Storage 2', '📦', 'Clean and organize the second ground-floor storage area.', 10, 20),
    ('Ground Floor', 'Storage 3', '📦', 'Clean and organize the third ground-floor storage area.', 10, 30),
    ('Ground Floor', 'Public Toilet', '🚻', 'Clean and restock the ground-floor public toilet.', 15, 40),
    ('131 / 137 / 144 Side', 'Storage 1', '📦', 'Clean and organize the first storage area for this section.', 10, 10),
    ('131 / 137 / 144 Side', 'Storage 2', '📦', 'Clean and organize the second storage area for this section.', 10, 20),
    ('131 / 137 / 144 Side', 'Storage 3', '📦', 'Clean and organize the third storage area for this section.', 10, 30),
    ('131 / 137 / 144 Side', 'Kitchen', '🍳', 'Clean the kitchen connected to this section.', 20, 40),
    ('Middle', 'Small Corridor', '🚶', 'Clean the small corridor near room 112.', 10, 10),
    ('Middle', 'Sauna', '♨️', 'Clean and reset the sauna area, including used towels.', 20, 20),
    ('Middle', 'Jacuzzi', '🫧', 'Clean and reset the jacuzzi area, including used towels.', 20, 30),
    ('Middle', 'Gym', '🏋️', 'Clean the gym and collect used towels.', 20, 40),
    ('Middle', 'Corridor', '🚶', 'Clean the main corridor connected to the middle section.', 15, 50),
    ('200 Side', 'New-side Decorations', '✨', 'Dust and clean the decorations on the new side.', 15, 10),
    ('200 Side', 'Staircase', '🪜', 'Clean the staircase connected to the 200 side.', 15, 20),
    ('300 Side', 'Decorations', '✨', 'Dust and clean the decorations on the 300 side.', 15, 10),
    ('300 Side', 'Staircase', '🪜', 'Clean the staircase connected to the 300 side.', 15, 20),
    ('300 Side', 'Public Toilet', '🚻', 'Clean and restock the toilet connected to the 300 side.', 15, 30)
)
insert into public.hotel_housekeeping_section_tasks (
  section_id, task_name, icon, instructions, estimated_duration, sort_order
)
select
  section.id, seed.task_name, seed.icon, seed.instructions,
  seed.estimated_duration, seed.sort_order
from task_seed seed
join public.hotel_housekeeping_sections section
  on section.hotel_name = 'Hotel Memories Budapest'
 and section.name = seed.section_name
on conflict (section_id, task_name) do update set
  icon = excluded.icon,
  instructions = excluded.instructions,
  estimated_duration = excluded.estimated_duration,
  auto_assign = true,
  is_active = true,
  sort_order = excluded.sort_order;
