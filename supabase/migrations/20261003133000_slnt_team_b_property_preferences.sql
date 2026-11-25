-- Learn manager-corrected SLNT Team B physical-property preferences.
-- Preferences are advisory: saved/manual day assignments remain authoritative.

begin;

create table if not exists public.housekeeping_team_property_preferences (
  team_id uuid not null references public.housekeeping_teams(id) on delete cascade,
  property_key text not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (team_id, property_key)
);

alter table public.housekeeping_team_property_preferences enable row level security;

drop policy if exists housekeeping_team_property_preferences_org_read on public.housekeeping_team_property_preferences;
create policy housekeeping_team_property_preferences_org_read
on public.housekeeping_team_property_preferences
for select to authenticated
using (
  exists (
    select 1 from public.housekeeping_teams t
    join public.profiles p on p.id = auth.uid()
    where t.id = housekeeping_team_property_preferences.team_id
      and p.deleted_at is null
      and p.organization_slug = t.organization_slug
  )
);

create or replace function public.save_slnt_team_b_property_preferences(p_preferences jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
  v_item jsonb;
  v_property_key text;
  v_user_id uuid;
  v_saved integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not public.can_manage_next_day_housekeeping_plan('slnt', 'slnt-group') then
    raise exception 'Not authorized to manage SLNT Team B planning' using errcode = '42501';
  end if;
  if p_preferences is null or jsonb_typeof(p_preferences) <> 'array' then
    raise exception 'Preferences must be a JSON array.';
  end if;

  select id into v_team_id from public.housekeeping_teams
  where organization_slug='slnt' and hotel_id='slnt-group' and code='team-b' and is_active
  limit 1;
  if v_team_id is null then raise exception 'Active SLNT Team B is not configured.'; end if;

  for v_item in select value from jsonb_array_elements(p_preferences)
  loop
    v_property_key := btrim(coalesce(v_item->>'property_key',''));
    begin v_user_id := (v_item->>'user_id')::uuid;
    exception when invalid_text_representation then raise exception 'Invalid cleaner id.'; end;
    if v_property_key = '' then continue; end if;
    if not exists (
      select 1 from public.housekeeping_team_members m
      join public.profiles p on p.id=m.user_id
      where m.team_id=v_team_id and m.user_id=v_user_id and m.is_active
        and p.organization_slug='slnt' and p.deleted_at is null
    ) then
      raise exception 'Preferred cleaner must be an active Team B member.';
    end if;
    insert into public.housekeeping_team_property_preferences(team_id,property_key,user_id,updated_by,updated_at)
    values(v_team_id,v_property_key,v_user_id,auth.uid(),now())
    on conflict(team_id,property_key) do update
      set user_id=excluded.user_id, updated_by=excluded.updated_by, updated_at=now();
    v_saved := v_saved + 1;
  end loop;
  return v_saved;
end;
$$;

revoke all on function public.save_slnt_team_b_property_preferences(jsonb) from public;
grant execute on function public.save_slnt_team_b_property_preferences(jsonb) to authenticated;

comment on table public.housekeeping_team_property_preferences is
  'Learned SLNT Team B physical-property-to-cleaner preferences from manager-approved plans. Advisory for future auto assignment.';

commit;
