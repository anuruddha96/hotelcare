-- Rich physical housekeeping mapping for zone-aware auto assignment.
-- The existing room/section map remains authoritative; these tables only add
-- relationships that tell the planner which mapped areas/rooms are close,
-- should stay together, can overflow, or should be kept apart.

create table if not exists public.hotel_housekeeping_section_links (
  id uuid primary key default gen_random_uuid(),
  hotel_name text not null,
  organization_slug text default pi_user_org(),
  source_section_id uuid not null references public.hotel_housekeeping_sections(id) on delete cascade,
  target_section_id uuid not null references public.hotel_housekeeping_sections(id) on delete cascade,
  relation_type text not null check (relation_type in ('nearby', 'overflow', 'avoid')),
  priority smallint not null default 50 check (priority between 1 and 100),
  is_directional boolean not null default false,
  low_load_threshold_minutes integer check (low_load_threshold_minutes is null or low_load_threshold_minutes between 0 and 450),
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint housekeeping_section_link_distinct check (source_section_id <> target_section_id),
  constraint housekeeping_section_link_unique unique (source_section_id, target_section_id, relation_type)
);

create index if not exists idx_housekeeping_section_links_hotel
  on public.hotel_housekeeping_section_links(hotel_name);
create index if not exists idx_housekeeping_section_links_source
  on public.hotel_housekeeping_section_links(source_section_id);
create index if not exists idx_housekeeping_section_links_target
  on public.hotel_housekeeping_section_links(target_section_id);

create table if not exists public.hotel_housekeeping_room_relationships (
  id uuid primary key default gen_random_uuid(),
  hotel_name text not null,
  organization_slug text default pi_user_org(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  related_room_id uuid not null references public.rooms(id) on delete cascade,
  relation_type text not null check (relation_type in ('together', 'nearby', 'far')),
  priority smallint not null default 50 check (priority between 1 and 100),
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint housekeeping_room_relationship_distinct check (room_id <> related_room_id),
  constraint housekeeping_room_relationship_unique unique (room_id, related_room_id, relation_type)
);

create index if not exists idx_housekeeping_room_relationships_hotel
  on public.hotel_housekeeping_room_relationships(hotel_name);
create index if not exists idx_housekeeping_room_relationships_room
  on public.hotel_housekeeping_room_relationships(room_id);
create index if not exists idx_housekeeping_room_relationships_related
  on public.hotel_housekeeping_room_relationships(related_room_id);

alter table public.hotel_housekeeping_section_links enable row level security;
alter table public.hotel_housekeeping_room_relationships enable row level security;

drop policy if exists "Housekeeping section links visible inside organization" on public.hotel_housekeeping_section_links;
create policy "Housekeeping section links visible inside organization"
  on public.hotel_housekeeping_section_links for select to authenticated
  using (organization_slug is null or organization_slug = pi_user_org());

drop policy if exists "Housekeeping section links writable inside organization" on public.hotel_housekeeping_section_links;
create policy "Housekeeping section links writable inside organization"
  on public.hotel_housekeeping_section_links for all to authenticated
  using (organization_slug is null or organization_slug = pi_user_org())
  with check (organization_slug is null or organization_slug = pi_user_org());

drop policy if exists "Housekeeping room relationships visible inside organization" on public.hotel_housekeeping_room_relationships;
create policy "Housekeeping room relationships visible inside organization"
  on public.hotel_housekeeping_room_relationships for select to authenticated
  using (organization_slug is null or organization_slug = pi_user_org());

drop policy if exists "Housekeeping room relationships writable inside organization" on public.hotel_housekeeping_room_relationships;
create policy "Housekeeping room relationships writable inside organization"
  on public.hotel_housekeeping_room_relationships for all to authenticated
  using (organization_slug is null or organization_slug = pi_user_org())
  with check (organization_slug is null or organization_slug = pi_user_org());

-- Seed only the physical facts confirmed by Hotel Memories management.
-- Nearby is symmetric in the planner. Overflow is directional: Ground Floor
-- housekeepers may help 100 Side only when their mapped workload is materially
-- lighter; no fixed threshold is imposed here so the algorithm compares loads.
insert into public.hotel_housekeeping_section_links (
  hotel_name, organization_slug, source_section_id, target_section_id,
  relation_type, priority, is_directional, notes
)
select
  'Hotel Memories Budapest', null, a.id, b.id,
  'nearby', 90, false, 'Manager confirmed these first-floor sections are physically close.'
from public.hotel_housekeeping_sections a
join public.hotel_housekeeping_sections b
  on b.hotel_name = a.hotel_name and b.name = '100 Side'
where a.hotel_name = 'Hotel Memories Budapest' and a.name = 'Near the elevator'
on conflict (source_section_id, target_section_id, relation_type) do nothing;

insert into public.hotel_housekeeping_section_links (
  hotel_name, organization_slug, source_section_id, target_section_id,
  relation_type, priority, is_directional, notes
)
select
  'Hotel Memories Budapest', null, a.id, b.id,
  'nearby', 90, false, 'Manager confirmed these first-floor sections are physically close.'
from public.hotel_housekeeping_sections a
join public.hotel_housekeeping_sections b
  on b.hotel_name = a.hotel_name and b.name = '130 - 140 Side'
where a.hotel_name = 'Hotel Memories Budapest' and a.name = 'Near the elevator'
on conflict (source_section_id, target_section_id, relation_type) do nothing;

insert into public.hotel_housekeeping_section_links (
  hotel_name, organization_slug, source_section_id, target_section_id,
  relation_type, priority, is_directional, notes
)
select
  'Hotel Memories Budapest', null, a.id, b.id,
  'overflow', 80, true,
  'When Ground Floor has materially lighter work, its housekeeper may receive nearby 100 Side rooms above.'
from public.hotel_housekeeping_sections a
join public.hotel_housekeeping_sections b
  on b.hotel_name = a.hotel_name and b.name = '100 Side'
where a.hotel_name = 'Hotel Memories Budapest' and a.name = 'Ground Floor'
on conflict (source_section_id, target_section_id, relation_type) do nothing;
