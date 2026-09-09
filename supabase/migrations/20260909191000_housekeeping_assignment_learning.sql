-- Hotel-specific housekeeping assignment learning.
--
-- Learning is deliberately based on explicit manager corrections only. We do
-- not treat an untouched automatic suggestion as evidence, which avoids a
-- self-reinforcing model that simply learns its own previous guesses.
-- Historical room-pair affinity remains a separate signal in the planner.

create table if not exists public.housekeeping_assignment_learning_events (
  id uuid primary key default gen_random_uuid(),
  organization_slug text not null,
  hotel_id text not null,
  source_type text not null default 'next_day_plan'
    check (source_type in ('next_day_plan')),
  plan_id uuid not null references public.next_day_housekeeping_plans(id) on delete cascade,
  plan_item_id uuid not null unique references public.next_day_housekeeping_plan_items(id) on delete cascade,
  plan_date date not null,
  room_id uuid not null references public.rooms(id),
  room_number text not null,
  room_kind text not null check (room_kind in ('checkout','daily')),
  floor_number integer,
  wing text,
  housekeeping_section_id uuid,
  housekeeping_section_name text,
  suggested_staff_id uuid not null references public.profiles(id),
  final_staff_id uuid not null references public.profiles(id),
  changed_by uuid not null references public.profiles(id),
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists housekeeping_assignment_learning_events_hotel_idx
  on public.housekeeping_assignment_learning_events
  (organization_slug, hotel_id, plan_date desc);

create index if not exists housekeeping_assignment_learning_events_staff_idx
  on public.housekeeping_assignment_learning_events
  (organization_slug, hotel_id, final_staff_id, plan_date desc);

create table if not exists public.housekeeping_assignment_learning_profiles (
  organization_slug text not null,
  hotel_id text not null,
  model_version text not null default 'manager-correction-v1',
  sample_count integer not null default 0,
  correction_count integer not null default 0,
  confidence_score numeric(5,4) not null default 0,
  staff_preferences jsonb not null default '{}'::jsonb,
  diagnostics jsonb not null default '{}'::jsonb,
  last_correction_at timestamptz,
  refreshed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_slug, hotel_id)
);

-- Reuse HotelCare's normal updated_at function.
drop trigger if exists update_housekeeping_assignment_learning_events_updated_at
  on public.housekeeping_assignment_learning_events;
create trigger update_housekeeping_assignment_learning_events_updated_at
before update on public.housekeeping_assignment_learning_events
for each row execute function public.update_updated_at_column();

drop trigger if exists update_housekeeping_assignment_learning_profiles_updated_at
  on public.housekeeping_assignment_learning_profiles;
create trigger update_housekeeping_assignment_learning_profiles_updated_at
before update on public.housekeeping_assignment_learning_profiles
for each row execute function public.update_updated_at_column();

alter table public.housekeeping_assignment_learning_events enable row level security;
alter table public.housekeeping_assignment_learning_profiles enable row level security;

create policy "Managers can view housekeeping learning events"
on public.housekeeping_assignment_learning_events
for select to authenticated
using (public.can_manage_next_day_housekeeping_plan(organization_slug, hotel_id));

create policy "Managers can view housekeeping learning profiles"
on public.housekeeping_assignment_learning_profiles
for select to authenticated
using (public.can_manage_next_day_housekeeping_plan(organization_slug, hotel_id));

-- The client never writes learning rows directly. A trigger records an event
-- only when a manager actually changes the algorithm's proposed housekeeper.
create or replace function public.capture_housekeeping_assignment_learning_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan public.next_day_housekeeping_plans%rowtype;
  v_room public.rooms%rowtype;
  v_suggested uuid;
  v_section_id uuid;
  v_floor integer;
  v_actor uuid;
  v_changed boolean;
begin
  v_changed := coalesce((new.recommendation_context ->> 'manager_changed')::boolean, false);

  if new.source <> 'manager' or not v_changed then
    delete from public.housekeeping_assignment_learning_events
    where plan_item_id = new.id;
    return new;
  end if;

  begin
    v_suggested := nullif(new.recommendation_context ->> 'suggested_staff_id', '')::uuid;
  exception when invalid_text_representation then
    v_suggested := null;
  end;

  if v_suggested is null or v_suggested = new.assigned_to then
    delete from public.housekeeping_assignment_learning_events
    where plan_item_id = new.id;
    return new;
  end if;

  select * into v_plan
  from public.next_day_housekeeping_plans
  where id = new.plan_id;

  select * into v_room
  from public.rooms
  where id = new.room_id;

  begin
    v_section_id := nullif(new.recommendation_context ->> 'housekeeping_section_id', '')::uuid;
  exception when invalid_text_representation then
    v_section_id := null;
  end;

  begin
    v_floor := nullif(new.recommendation_context ->> 'floor_number', '')::integer;
  exception when invalid_text_representation then
    v_floor := null;
  end;

  v_actor := coalesce(auth.uid(), v_plan.approved_by, v_plan.created_by);
  if v_actor is null then
    return new;
  end if;

  insert into public.housekeeping_assignment_learning_events (
    organization_slug,
    hotel_id,
    plan_id,
    plan_item_id,
    plan_date,
    room_id,
    room_number,
    room_kind,
    floor_number,
    wing,
    housekeeping_section_id,
    housekeeping_section_name,
    suggested_staff_id,
    final_staff_id,
    changed_by,
    context
  ) values (
    v_plan.organization_slug,
    v_plan.hotel_id,
    v_plan.id,
    new.id,
    v_plan.plan_date,
    new.room_id,
    coalesce(new.recommendation_context ->> 'room_number', v_room.room_number),
    case when new.assignment_type = 'checkout_cleaning'::public.assignment_type then 'checkout' else 'daily' end,
    coalesce(v_floor, v_room.floor_number),
    v_room.wing,
    v_section_id,
    nullif(new.recommendation_context ->> 'housekeeping_section_name', ''),
    v_suggested,
    new.assigned_to,
    v_actor,
    new.recommendation_context
  )
  on conflict (plan_item_id) do update set
    organization_slug = excluded.organization_slug,
    hotel_id = excluded.hotel_id,
    plan_id = excluded.plan_id,
    plan_date = excluded.plan_date,
    room_id = excluded.room_id,
    room_number = excluded.room_number,
    room_kind = excluded.room_kind,
    floor_number = excluded.floor_number,
    wing = excluded.wing,
    housekeeping_section_id = excluded.housekeeping_section_id,
    housekeeping_section_name = excluded.housekeeping_section_name,
    suggested_staff_id = excluded.suggested_staff_id,
    final_staff_id = excluded.final_staff_id,
    changed_by = excluded.changed_by,
    context = excluded.context,
    updated_at = now();

  return new;
end;
$$;

revoke all on function public.capture_housekeeping_assignment_learning_event() from public;

drop trigger if exists capture_housekeeping_assignment_learning_event_trigger
  on public.next_day_housekeeping_plan_items;
create trigger capture_housekeeping_assignment_learning_event_trigger
after insert or update of source, assigned_to, recommendation_context
on public.next_day_housekeeping_plan_items
for each row execute function public.capture_housekeeping_assignment_learning_event();

-- Rebuild one hotel's compact preference model from the latest 120 days.
-- Strong tokens require repeated explicit manager corrections and must have a
-- positive net signal after subtracting corrections away from the same staff.
create or replace function public.refresh_housekeeping_assignment_learning_profile(
  p_organization_slug text,
  p_hotel_id text
)
returns public.housekeeping_assignment_learning_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sample_count integer := 0;
  v_correction_count integer := 0;
  v_confidence numeric(5,4) := 0;
  v_preferences jsonb := '{}'::jsonb;
  v_diagnostics jsonb := '{}'::jsonb;
  v_last_correction timestamptz;
  v_result public.housekeeping_assignment_learning_profiles;
begin
  if auth.uid() is not null
     and not public.can_manage_next_day_housekeeping_plan(p_organization_slug, p_hotel_id) then
    raise exception 'Not allowed to refresh housekeeping learning for this hotel';
  end if;

  select count(*)::integer
  into v_sample_count
  from public.next_day_housekeeping_plan_items i
  join public.next_day_housekeeping_plans p on p.id = i.plan_id
  where p.organization_slug = p_organization_slug
    and p.hotel_id = p_hotel_id
    and p.status in ('approved','released')
    and p.plan_date >= current_date - 120;

  select count(*)::integer, max(e.created_at)
  into v_correction_count, v_last_correction
  from public.housekeeping_assignment_learning_events e
  join public.next_day_housekeeping_plans p on p.id = e.plan_id
  where e.organization_slug = p_organization_slug
    and e.hotel_id = p_hotel_id
    and p.status in ('approved','released')
    and e.plan_date >= current_date - 120;

  -- Confidence grows gradually; it can never reach 1.0 from correction count
  -- alone because hotel operations change and learned preferences stay soft.
  v_confidence := least(
    0.9500::numeric,
    round((v_correction_count::numeric / (v_correction_count + 8.0)), 4)
  );

  with eligible_events as (
    select e.*
    from public.housekeeping_assignment_learning_events e
    join public.next_day_housekeeping_plans p on p.id = e.plan_id
    where e.organization_slug = p_organization_slug
      and e.hotel_id = p_hotel_id
      and p.status in ('approved','released')
      and e.plan_date >= current_date - 120
  ), tokens as (
    select e.id, e.final_staff_id, e.suggested_staff_id, token
    from eligible_events e
    cross join lateral (
      values
        (case when e.housekeeping_section_id is not null then 'section-' || e.housekeeping_section_id::text end),
        (case when e.floor_number is not null then e.floor_number::text end),
        (nullif(e.wing, ''))
    ) as t(token)
    where token is not null
  ), evidence as (
    select final_staff_id as staff_id, token, 1 as weight from tokens
    union all
    select suggested_staff_id as staff_id, token, -1 as weight from tokens
  ), scored as (
    select
      staff_id,
      token,
      sum(case when weight > 0 then 1 else 0 end)::integer as positive_count,
      sum(case when weight < 0 then 1 else 0 end)::integer as negative_count,
      sum(weight)::integer as net_score
    from evidence
    group by staff_id, token
  ), strong as (
    select *,
      row_number() over (
        partition by staff_id
        order by net_score desc, positive_count desc, token
      ) as preference_rank
    from scored
    where positive_count >= 2
      and net_score >= 1
      and (positive_count - negative_count)::numeric / greatest(1, positive_count + negative_count) >= 0.35
  ), per_staff as (
    select
      staff_id,
      jsonb_agg(token order by net_score desc, positive_count desc, token) as preferences
    from strong
    where preference_rank <= 10
    group by staff_id
  )
  select coalesce(jsonb_object_agg(staff_id::text, preferences), '{}'::jsonb)
  into v_preferences
  from per_staff;

  with eligible_events as (
    select e.*
    from public.housekeeping_assignment_learning_events e
    join public.next_day_housekeeping_plans p on p.id = e.plan_id
    where e.organization_slug = p_organization_slug
      and e.hotel_id = p_hotel_id
      and p.status in ('approved','released')
      and e.plan_date >= current_date - 120
  )
  select jsonb_build_object(
    'window_days', 120,
    'explicit_manager_changes_only', true,
    'correction_rate', case when v_sample_count > 0 then round(v_correction_count::numeric / v_sample_count, 4) else 0 end,
    'staff_with_preferences', jsonb_array_length(coalesce((select jsonb_agg(key) from jsonb_object_keys(v_preferences) key), '[]'::jsonb)),
    'checkout_corrections', count(*) filter (where room_kind = 'checkout'),
    'daily_corrections', count(*) filter (where room_kind = 'daily')
  )
  into v_diagnostics
  from eligible_events;

  insert into public.housekeeping_assignment_learning_profiles (
    organization_slug,
    hotel_id,
    model_version,
    sample_count,
    correction_count,
    confidence_score,
    staff_preferences,
    diagnostics,
    last_correction_at,
    refreshed_at
  ) values (
    p_organization_slug,
    p_hotel_id,
    'manager-correction-v1',
    v_sample_count,
    v_correction_count,
    v_confidence,
    coalesce(v_preferences, '{}'::jsonb),
    coalesce(v_diagnostics, '{}'::jsonb),
    v_last_correction,
    now()
  )
  on conflict (organization_slug, hotel_id) do update set
    model_version = excluded.model_version,
    sample_count = excluded.sample_count,
    correction_count = excluded.correction_count,
    confidence_score = excluded.confidence_score,
    staff_preferences = excluded.staff_preferences,
    diagnostics = excluded.diagnostics,
    last_correction_at = excluded.last_correction_at,
    refreshed_at = excluded.refreshed_at,
    updated_at = now()
  returning * into v_result;

  return v_result;
end;
$$;

revoke all on function public.refresh_housekeeping_assignment_learning_profile(text,text) from public;
grant execute on function public.refresh_housekeeping_assignment_learning_profile(text,text) to authenticated;

-- Refresh the hotel model whenever a plan enters or leaves an eligible state.
create or replace function public.refresh_housekeeping_learning_after_plan_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    perform public.refresh_housekeeping_assignment_learning_profile(
      new.organization_slug,
      new.hotel_id
    );
  end if;
  return new;
end;
$$;

revoke all on function public.refresh_housekeeping_learning_after_plan_status_change() from public;

drop trigger if exists refresh_housekeeping_learning_after_plan_status_change_trigger
  on public.next_day_housekeeping_plans;
create trigger refresh_housekeeping_learning_after_plan_status_change_trigger
after update of status on public.next_day_housekeeping_plans
for each row execute function public.refresh_housekeeping_learning_after_plan_status_change();
