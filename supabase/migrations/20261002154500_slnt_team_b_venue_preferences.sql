-- Persistent SLNT Team B venue -> preferred cleaner affinity.
-- This is operational planning metadata and does not alter the HR staff schedule.
begin;

create table if not exists public.housekeeping_team_venue_preferences (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.housekeeping_teams(id) on delete cascade,
  venue_key text not null,
  preferred_user_id uuid not null references public.profiles(id) on delete cascade,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (team_id, venue_key)
);

create index if not exists idx_housekeeping_team_venue_preferences_team
  on public.housekeeping_team_venue_preferences(team_id);

alter table public.housekeeping_team_venue_preferences enable row level security;

drop policy if exists housekeeping_team_venue_preferences_org_read on public.housekeeping_team_venue_preferences;
create policy housekeeping_team_venue_preferences_org_read
on public.housekeeping_team_venue_preferences
for select to authenticated
using (
  exists (
    select 1
    from public.housekeeping_teams t
    join public.profiles p on p.id = auth.uid()
    where t.id = housekeeping_team_venue_preferences.team_id
      and p.deleted_at is null
      and p.organization_slug = t.organization_slug
  )
);

create or replace function public.set_slnt_team_b_venue_preferences(p_preferences jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_team_id uuid;
  v_item jsonb;
  v_venue_key text;
  v_preferred uuid;
  v_count integer := 0;
begin
  if v_user_id is null then raise exception 'Authentication required.'; end if;
  if not (
    is_super_admin(v_user_id)
    or is_top_management(v_user_id)
    or coalesce(get_user_role(v_user_id)::text, '') in ('admin','manager','housekeeping_manager','top_management','top_management_manager','supervisor')
  ) then
    raise exception 'Manager permission required.' using errcode = '42501';
  end if;

  select id into v_team_id from public.housekeeping_teams
  where organization_slug='slnt' and hotel_id='slnt-group' and code='team-b' and is_active
  limit 1;
  if v_team_id is null then raise exception 'Active SLNT Team B is not configured.'; end if;
  if p_preferences is null or jsonb_typeof(p_preferences) <> 'array' then
    raise exception 'Venue preferences must be a JSON array.';
  end if;

  for v_item in select value from jsonb_array_elements(p_preferences)
  loop
    v_venue_key := btrim(coalesce(v_item->>'venue_key',''));
    if v_venue_key = '' or length(v_venue_key) > 160 then raise exception 'Invalid venue key.'; end if;
    begin v_preferred := (v_item->>'preferred_user_id')::uuid;
    exception when invalid_text_representation then raise exception 'Invalid preferred cleaner id.'; end;

    if not exists (
      select 1 from public.housekeeping_team_members m
      join public.profiles p on p.id=m.user_id
      where m.team_id=v_team_id and m.user_id=v_preferred and m.is_active
        and p.organization_slug='slnt' and p.deleted_at is null
        and (p.role::text='housekeeping' or p.acts_as_housekeeper=true)
    ) then raise exception 'Preferred cleaner must be an active Team B member.'; end if;

    insert into public.housekeeping_team_venue_preferences(team_id,venue_key,preferred_user_id,updated_by)
    values(v_team_id,v_venue_key,v_preferred,v_user_id)
    on conflict(team_id,venue_key) do update
      set preferred_user_id=excluded.preferred_user_id, updated_by=v_user_id, updated_at=now();
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.set_slnt_team_b_venue_preferences(jsonb) from public;
grant execute on function public.set_slnt_team_b_venue_preferences(jsonb) to authenticated;

comment on table public.housekeeping_team_venue_preferences is
  'Persistent operational affinity between an SLNT Team B venue/property and its preferred cleaner.';
commit;
