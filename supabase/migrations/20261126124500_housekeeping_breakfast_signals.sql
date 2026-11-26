-- Advisory breakfast signals only. No changes to assignments, checkout or DND state.
alter table public.housekeeping_automation_settings
  add column breakfast_signal_enabled boolean not null default true,
  add column breakfast_signal_window_minutes integer not null default 30
    check (breakfast_signal_window_minutes between 15 and 60);

create table public.housekeeping_breakfast_signals (
  id uuid primary key default gen_random_uuid(),
  organization_slug text not null,
  hotel_id text not null,
  room_id uuid not null references public.rooms(id) on delete cascade,
  room_number text not null,
  signal_date date not null,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  window_ends_at timestamptz not null,
  guests_seen integer not null check (guests_seen > 0),
  guests_expected integer check (guests_expected > 0),
  locations text[] not null default '{}',
  attendance_ids uuid[] not null default '{}',
  closed_at timestamptz,
  closed_by uuid,
  closed_reason text check (closed_reason in ('guest_in_room','undone','cleaned')),
  notified_user_id uuid,
  notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (hotel_id, room_id, signal_date)
);
create index housekeeping_breakfast_signals_org_date_idx
  on public.housekeeping_breakfast_signals (organization_slug, signal_date);
alter table public.housekeeping_breakfast_signals enable row level security;
revoke all on public.housekeeping_breakfast_signals from public, anon, authenticated;
grant select (id, organization_slug, hotel_id, room_id, room_number, signal_date, first_seen_at,
  last_seen_at, window_ends_at, guests_seen, guests_expected, closed_at)
  on public.housekeeping_breakfast_signals to authenticated;
grant select, insert, update, delete on public.housekeeping_breakfast_signals to service_role;

create policy breakfast_signals_assigned_read on public.housekeeping_breakfast_signals
for select to authenticated using (
  organization_slug = public.get_user_organization_slug((select auth.uid()))
  and signal_date = (now() at time zone 'Europe/Budapest')::date
  and exists (
    select 1 from public.room_assignments a
    where a.room_id = housekeeping_breakfast_signals.room_id
      and a.organization_slug = housekeeping_breakfast_signals.organization_slug
      and a.assignment_date = housekeeping_breakfast_signals.signal_date
      and a.assigned_to = (select auth.uid())
      and a.status <> 'cancelled'
  )
);
create policy breakfast_signals_manager_read on public.housekeeping_breakfast_signals
for select to authenticated using (
  organization_slug = public.get_user_organization_slug((select auth.uid()))
  and public.get_user_role((select auth.uid()))::text in
    ('manager','housekeeping_manager','supervisor','top_management','top_management_manager','admin')
  and public.user_can_access_hotel((select auth.uid()), hotel_id)
);

-- Return only the service-side eligibility result, never expose it directly to anon.
-- The attendance row, not request arguments, is the authoritative event.
create function public.record_breakfast_signal(
  _hotel_id text, _room_number text, _served_count integer, _location text, _attendance_id uuid
) returns table(signal_id uuid, promotable boolean, user_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  v_mark public.breakfast_attendance%rowtype;
  v_room public.rooms%rowtype;
  v_signal public.housekeeping_breakfast_signals%rowtype;
  v_org text;
  v_name text;
  v_enabled boolean;
  v_minutes integer;
  v_room_ids uuid[];
  v_expected integer;
  v_today date := (now() at time zone 'Europe/Budapest')::date;
  v_users uuid[];
begin
  select * into v_mark from public.breakfast_attendance a where a.id = _attendance_id;
  if not found or v_mark.hotel_id is distinct from _hotel_id
    or v_mark.room_number is distinct from _room_number
    or v_mark.location is distinct from _location
    or v_mark.served_count is distinct from _served_count
    or v_mark.stay_date is distinct from v_today or coalesce(v_mark.served_count,0) <= 0
    or (v_mark.created_at at time zone 'Europe/Budapest')::date <> v_today then return; end if;

  -- Same canonical slug/display-name identity contract as src/lib/hotelKeys.ts,
  -- resolved from the existing configuration in the attendance tenant.
  select o.slug, h.hotel_name into v_org, v_name
  from public.hotel_configurations h join public.organizations o on o.id = h.organization_id
  where h.hotel_id = v_mark.hotel_id and o.slug = v_mark.organization_slug
    and h.breakfast_enabled is true and h.is_active is distinct from false;
  if not found then return; end if;
  -- Prefer canonical setting; older properties may store the display name.
  select s.breakfast_signal_enabled, s.breakfast_signal_window_minutes into v_enabled, v_minutes
  from public.housekeeping_automation_settings s
  where s.organization_slug = v_org and s.hotel_id in (_hotel_id, v_name)
  order by (s.hotel_id = _hotel_id) desc limit 1;
  if not coalesce(v_enabled,true) then return; end if;
  v_minutes := coalesce(v_minutes,30);

  select array_agg(r.id) into v_room_ids from public.rooms r
  where r.organization_slug = v_org and r.hotel in (_hotel_id, v_name)
    and r.room_number = v_mark.room_number;
  if coalesce(cardinality(v_room_ids),0) <> 1 then return; end if;
  select * into v_room from public.rooms r where r.id = v_room_ids[1];

  -- Current-day live snapshot takes precedence over legacy roster.
  select nullif(s.pax,0) into v_expected from public.daily_overview_snapshots s
  where s.hotel_id = _hotel_id and s.organization_slug = v_org
    and s.business_date = v_today and s.room_number = v_mark.room_number
  order by (s.source = 'previo') desc, s.captured_at desc limit 1;
  if coalesce(v_expected,0) <= 0 then
    select nullif(b.pax,0) into v_expected from public.breakfast_roster b
    where b.hotel_id = _hotel_id and b.organization_slug = v_org
      and b.stay_date = v_today and b.room_number = v_mark.room_number
    order by b.uploaded_at desc limit 1;
  end if;
  if coalesce(v_expected,0) <= 0 then v_expected := null; end if;

  -- Atomic, idempotent on the attendance ID. Out-of-order events never
  -- shorten the latest window or reopen a later door dismissal.
  insert into public.housekeeping_breakfast_signals as s (
    organization_slug,hotel_id,room_id,room_number,signal_date,first_seen_at,last_seen_at,
    window_ends_at,guests_seen,guests_expected,locations,attendance_ids
  ) values (
    v_org,_hotel_id,v_room.id,v_room.room_number,v_today,v_mark.created_at,v_mark.created_at,
    v_mark.created_at + make_interval(mins => v_minutes),v_mark.served_count,v_expected,
    array[v_mark.location],array[v_mark.id]
  )
  on conflict (hotel_id,room_id,signal_date) do update set
    first_seen_at = least(s.first_seen_at,excluded.first_seen_at),
    last_seen_at = greatest(s.last_seen_at,excluded.last_seen_at),
    window_ends_at = case when excluded.last_seen_at >= s.last_seen_at then excluded.window_ends_at else s.window_ends_at end,
    guests_seen = s.guests_seen + excluded.guests_seen,
    guests_expected = coalesce(excluded.guests_expected,s.guests_expected),
    locations = case when excluded.locations[1] = any(s.locations) then s.locations else s.locations || excluded.locations end,
    attendance_ids = s.attendance_ids || excluded.attendance_ids,
    closed_at = case when excluded.last_seen_at > s.closed_at then null else s.closed_at end,
    closed_by = case when excluded.last_seen_at > s.closed_at then null else s.closed_by end,
    closed_reason = case when excluded.last_seen_at > s.closed_at then null else s.closed_reason end,
    updated_at = now()
  where s.organization_slug = excluded.organization_slug
    and not (excluded.attendance_ids[1] = any(s.attendance_ids))
  returning * into v_signal;
  if not found then return; end if;

  -- Conservative eligibility: only an assigned daily clean, never a checkout,
  -- DND, hold, retry or declined-service room. No changes to the assignment.
  if v_signal.closed_at is null and v_signal.window_ends_at > now()
     and not coalesce(v_room.is_dnd,false)
     and coalesce(v_room.status,'') not in ('dnd','out_of_order','out_of_service','maintenance')
     and not coalesce(v_room.is_checkout_room,false)
     and coalesce(v_room.pms_metadata->>'scheduledDepartureToday','false') <> 'true'
     and coalesce(v_room.notes,'') not like '%[NO_SERVICE]%'
     and coalesce(v_room.notes,'') not like '%[NO_BOARD_NO_CLEANING]%' then
    select array_agg(distinct a.assigned_to) into v_users
    from public.room_assignments a join public.profiles p on p.id = a.assigned_to
    where a.room_id = v_room.id and a.organization_slug = v_org
      and p.organization_slug = v_org and p.deleted_at is null
      and a.assignment_date = v_today and a.status = 'assigned'
      and a.assignment_type = 'daily_cleaning'
      and not coalesce(a.is_dnd,false) and not a.pms_hold
      and coalesce(a.service_result,'') not in ('guest_declined','cleaned')
      and coalesce(a.notes,'') not like '%[NO_SERVICE]%'
      and coalesce(a.notes,'') not like '%[NO_BOARD_NO_CLEANING]%';
  end if;
  return query select v_signal.id, coalesce(cardinality(v_users),0) = 1,
    case when cardinality(v_users) = 1 then v_users[1] else null::uuid end;
end;
$$;
revoke all on function public.record_breakfast_signal(text,text,integer,text,uuid) from public, anon, authenticated;
grant execute on function public.record_breakfast_signal(text,text,integer,text,uuid) to service_role;

create function public.close_breakfast_signal(_signal_id uuid, _reason text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or _reason is distinct from 'guest_in_room' then return false; end if;
  update public.housekeeping_breakfast_signals s
  set closed_at = now(), closed_by = auth.uid(), closed_reason = _reason, updated_at = now()
  where s.id = _signal_id and s.closed_at is null and s.window_ends_at > now()
    and s.signal_date = (now() at time zone 'Europe/Budapest')::date
    and s.organization_slug = public.get_user_organization_slug(auth.uid())
    and exists (select 1 from public.room_assignments a
      where a.room_id = s.room_id and a.organization_slug = s.organization_slug
        and a.assignment_date = s.signal_date and a.assigned_to = auth.uid()
        and a.status = 'assigned' and a.assignment_type = 'daily_cleaning');
  return found;
end;
$$;
revoke all on function public.close_breakfast_signal(uuid,text) from public, anon, authenticated;
grant execute on function public.close_breakfast_signal(uuid,text) to authenticated;

alter publication supabase_realtime add table public.housekeeping_breakfast_signals;

-- Rollback (owner-approved, only before enabling, deletes signal history):
-- alter publication supabase_realtime drop table public.housekeeping_breakfast_signals;
-- drop function public.close_breakfast_signal(uuid,text);
-- drop function public.record_breakfast_signal(text,text,integer,text,uuid);
-- drop table public.housekeeping_breakfast_signals;
-- alter table public.housekeeping_automation_settings drop column breakfast_signal_enabled,
--   drop column breakfast_signal_window_minutes;
