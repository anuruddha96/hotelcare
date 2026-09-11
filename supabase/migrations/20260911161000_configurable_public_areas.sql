-- Venue/property-scoped public-area definitions for housekeeping.
--
-- The previous assignment dialog shipped a fixed client-side list for every
-- property. That made hotel-only areas (kitchen, breakfast room, gym, sauna,
-- etc.) appear even where they did not exist and gave managers no safe way to
-- add or retire a location. These definitions are deliberately independent
-- from general_tasks so archiving an area never mutates historical work.

create table if not exists public.hotel_public_areas (
  id uuid primary key default gen_random_uuid(),
  hotel_name text not null,
  name text not null,
  description text,
  icon text not null default '🧹',
  task_type text not null default 'public_area_cleaning',
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hotel_public_areas_hotel_not_blank check (btrim(hotel_name) <> ''),
  constraint hotel_public_areas_name_not_blank check (btrim(name) <> ''),
  constraint hotel_public_areas_name_length check (char_length(btrim(name)) <= 80),
  constraint hotel_public_areas_description_length check (
    description is null or char_length(description) <= 300
  ),
  constraint hotel_public_areas_task_type_not_blank check (btrim(task_type) <> '')
);

create unique index if not exists hotel_public_areas_hotel_name_ci_key
  on public.hotel_public_areas (hotel_name, lower(btrim(name)));

create index if not exists hotel_public_areas_active_sort_idx
  on public.hotel_public_areas (hotel_name, is_active, sort_order, name);

drop trigger if exists update_hotel_public_areas_updated_at on public.hotel_public_areas;
create trigger update_hotel_public_areas_updated_at
before update on public.hotel_public_areas
for each row execute function public.update_updated_at_column();

alter table public.hotel_public_areas enable row level security;

grant select, insert, update on public.hotel_public_areas to authenticated;
grant all on public.hotel_public_areas to service_role;

-- Anyone who can operate in a property can see its active configuration. RLS
-- remains property-aware through the same helper used by housekeeping sections.
drop policy if exists "Hotel staff view public areas" on public.hotel_public_areas;
create policy "Hotel staff view public areas"
on public.hotel_public_areas for select to authenticated
using (public.user_can_access_hotel(auth.uid(), hotel_name));

-- Configuration changes are limited to operational management roles. We use
-- soft archive in the UI, so no authenticated DELETE policy is intentionally
-- granted; old general_tasks therefore remain auditable forever.
drop policy if exists "Eligible managers create public areas" on public.hotel_public_areas;
create policy "Eligible managers create public areas"
on public.hotel_public_areas for insert to authenticated
with check (
  (
    public.is_super_admin(auth.uid())
    or public.get_user_role(auth.uid())::text in (
      'admin', 'top_management', 'top_management_manager', 'manager',
      'housekeeping_manager', 'supervisor', 'reception_manager',
      'back_office_manager'
    )
  )
  and public.user_can_access_hotel(auth.uid(), hotel_name)
  and created_by = auth.uid()
);

drop policy if exists "Eligible managers update public areas" on public.hotel_public_areas;
create policy "Eligible managers update public areas"
on public.hotel_public_areas for update to authenticated
using (
  (
    public.is_super_admin(auth.uid())
    or public.get_user_role(auth.uid())::text in (
      'admin', 'top_management', 'top_management_manager', 'manager',
      'housekeeping_manager', 'supervisor', 'reception_manager',
      'back_office_manager'
    )
  )
  and public.user_can_access_hotel(auth.uid(), hotel_name)
)
with check (
  (
    public.is_super_admin(auth.uid())
    or public.get_user_role(auth.uid())::text in (
      'admin', 'top_management', 'top_management_manager', 'manager',
      'housekeeping_manager', 'supervisor', 'reception_manager',
      'back_office_manager'
    )
  )
  and public.user_can_access_hotel(auth.uid(), hotel_name)
);

-- Keep defaults intentionally small and venue-neutral. Property managers can
-- add Reception, Kitchen, Breakfast Room, Dining, Gym, Sauna, Jacuzzi, Back
-- Office, terrace areas, extra restrooms, etc. only where they actually exist.
insert into public.hotel_public_areas (
  hotel_name, name, description, icon, task_type, sort_order
)
select
  hc.hotel_name,
  seed.name,
  seed.description,
  seed.icon,
  seed.task_type,
  seed.sort_order
from public.hotel_configurations hc
cross join (
  values
    ('Entrance & Lobby', 'Entrance, lobby and guest arrival area', '🏨', 'lobby_cleaning', 10),
    ('Guest Restrooms', 'Guest-facing restrooms and wash areas', '🚻', 'guest_toilets', 20),
    ('Corridors & Stairs', 'Guest corridors, stairways and lift landings', '🚶', 'stairways_cleaning', 30),
    ('Common Areas', 'Other shared guest-facing spaces', '🏠', 'common_areas_cleaning', 40)
) as seed(name, description, icon, task_type, sort_order)
where nullif(btrim(hc.hotel_name), '') is not null
on conflict do nothing;
