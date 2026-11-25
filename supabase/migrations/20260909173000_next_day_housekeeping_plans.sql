-- Next-day housekeeping planning foundation.
-- Keeps tomorrow's plan separate from live room_assignments until release time.

create table if not exists public.next_day_housekeeping_plans (
  id uuid primary key default gen_random_uuid(),
  organization_slug text not null default public.pi_user_org(),
  hotel_id text not null,
  plan_date date not null,
  status text not null default 'draft' check (status in ('draft','approved','releasing','released','cancelled','failed')),
  auto_release boolean not null default true,
  release_time time without time zone not null default '08:00'::time,
  release_timezone text not null default 'Europe/Budapest',
  scheduled_release_at timestamptz,
  pms_synced_at timestamptz,
  pms_sync_snapshot jsonb not null default '{}'::jsonb,
  algorithm_version text,
  generation_context jsonb not null default '{}'::jsonb,
  created_by uuid not null references public.profiles(id),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  release_attempted_at timestamptz,
  released_at timestamptz,
  release_result jsonb not null default '{}'::jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_slug, hotel_id, plan_date)
);

create table if not exists public.next_day_housekeeping_plan_staff (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.next_day_housekeeping_plans(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  selected boolean not null default true,
  source text not null default 'schedule' check (source in ('schedule','manual','copied')),
  shift_snapshot jsonb not null default '{}'::jsonb,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id, user_id)
);

create table if not exists public.next_day_housekeeping_plan_items (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.next_day_housekeeping_plans(id) on delete cascade,
  room_id uuid not null references public.rooms(id),
  assigned_to uuid not null references public.profiles(id),
  assignment_type public.assignment_type not null default 'daily_cleaning'::public.assignment_type,
  priority integer not null default 1,
  estimated_duration integer,
  notes text,
  source text not null default 'auto' check (source in ('auto','manager','manual','learned')),
  recommendation_score numeric(7,4),
  recommendation_context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id, room_id, assigned_to)
);

create index if not exists next_day_housekeeping_plans_due_idx
  on public.next_day_housekeeping_plans (scheduled_release_at)
  where status = 'approved' and auto_release = true;

create index if not exists next_day_housekeeping_plan_items_plan_idx
  on public.next_day_housekeeping_plan_items (plan_id, room_id);

create index if not exists next_day_housekeeping_plan_staff_plan_idx
  on public.next_day_housekeeping_plan_staff (plan_id, selected);

-- Reuse HotelCare's standard updated_at trigger function.
drop trigger if exists update_next_day_housekeeping_plans_updated_at on public.next_day_housekeeping_plans;
create trigger update_next_day_housekeeping_plans_updated_at
before update on public.next_day_housekeeping_plans
for each row execute function public.update_updated_at_column();

drop trigger if exists update_next_day_housekeeping_plan_staff_updated_at on public.next_day_housekeeping_plan_staff;
create trigger update_next_day_housekeeping_plan_staff_updated_at
before update on public.next_day_housekeeping_plan_staff
for each row execute function public.update_updated_at_column();

drop trigger if exists update_next_day_housekeeping_plan_items_updated_at on public.next_day_housekeeping_plan_items;
create trigger update_next_day_housekeeping_plan_items_updated_at
before update on public.next_day_housekeeping_plan_items
for each row execute function public.update_updated_at_column();

-- Scope manager access exactly to the user's organization and hotel, while allowing
-- organization-wide admin/top-management and super-admin access.
create or replace function public.can_manage_next_day_housekeeping_plan(
  p_organization_slug text,
  p_hotel_id text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_super_admin(auth.uid())
    or (
      auth.uid() is not null
      and p_organization_slug = public.get_user_organization_slug(auth.uid())
      and (
        public.get_user_role(auth.uid()) in (
          'admin'::public.user_role,
          'top_management'::public.user_role,
          'top_management_manager'::public.user_role
        )
        or (
          public.get_user_role(auth.uid()) in (
            'manager'::public.user_role,
            'housekeeping_manager'::public.user_role,
            'supervisor'::public.user_role,
            'reception_manager'::public.user_role
          )
          and exists (
            select 1
            from public.profiles p
            where p.id = auth.uid()
              and (
                p.assigned_hotel = p_hotel_id
                or exists (
                  select 1
                  from public.hotel_configurations hc
                  where (p.assigned_hotel = hc.hotel_id or p.assigned_hotel = hc.hotel_name)
                    and (p_hotel_id = hc.hotel_id or p_hotel_id = hc.hotel_name)
                )
              )
          )
        )
      )
    );
$$;

revoke all on function public.can_manage_next_day_housekeeping_plan(text,text) from public;
grant execute on function public.can_manage_next_day_housekeeping_plan(text,text) to authenticated;

-- Keep the concrete UTC release timestamp synchronized with the hotel's local
-- release clock. The timezone is stored on each plan for DST-safe scheduling.
create or replace function public.prepare_next_day_housekeeping_plan()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.plan_date < current_date then
    raise exception 'Next-day housekeeping plans cannot target a past date';
  end if;

  begin
    perform now() at time zone new.release_timezone;
  exception when invalid_parameter_value then
    raise exception 'Invalid release timezone: %', new.release_timezone;
  end;

  new.scheduled_release_at :=
    (new.plan_date::timestamp + new.release_time) at time zone new.release_timezone;

  if new.status = 'approved' then
    if new.pms_synced_at is null then
      raise exception 'A fresh PMS sync is required before approving a next-day housekeeping plan';
    end if;

    if new.approved_by is null then
      new.approved_by := auth.uid();
    end if;

    if new.approved_at is null then
      new.approved_at := now();
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists prepare_next_day_housekeeping_plan_trigger on public.next_day_housekeeping_plans;
create trigger prepare_next_day_housekeeping_plan_trigger
before insert or update of plan_date, release_time, release_timezone, status, pms_synced_at, approved_by
on public.next_day_housekeeping_plans
for each row execute function public.prepare_next_day_housekeeping_plan();

alter table public.next_day_housekeeping_plans enable row level security;
alter table public.next_day_housekeeping_plan_staff enable row level security;
alter table public.next_day_housekeeping_plan_items enable row level security;

create policy "Managers can view next-day housekeeping plans"
on public.next_day_housekeeping_plans
for select to authenticated
using (public.can_manage_next_day_housekeeping_plan(organization_slug, hotel_id));

create policy "Managers can create next-day housekeeping plans"
on public.next_day_housekeeping_plans
for insert to authenticated
with check (
  created_by = auth.uid()
  and public.can_manage_next_day_housekeeping_plan(organization_slug, hotel_id)
);

create policy "Managers can update next-day housekeeping plans"
on public.next_day_housekeeping_plans
for update to authenticated
using (public.can_manage_next_day_housekeeping_plan(organization_slug, hotel_id))
with check (public.can_manage_next_day_housekeeping_plan(organization_slug, hotel_id));

create policy "Managers can delete draft next-day housekeeping plans"
on public.next_day_housekeeping_plans
for delete to authenticated
using (
  status in ('draft','cancelled','failed')
  and public.can_manage_next_day_housekeeping_plan(organization_slug, hotel_id)
);

create policy "Managers can view next-day plan staff"
on public.next_day_housekeeping_plan_staff
for select to authenticated
using (
  exists (
    select 1 from public.next_day_housekeeping_plans p
    where p.id = plan_id
      and public.can_manage_next_day_housekeeping_plan(p.organization_slug, p.hotel_id)
  )
);

create policy "Managers can create next-day plan staff"
on public.next_day_housekeeping_plan_staff
for insert to authenticated
with check (
  created_by = auth.uid()
  and exists (
    select 1 from public.next_day_housekeeping_plans p
    where p.id = plan_id
      and public.can_manage_next_day_housekeeping_plan(p.organization_slug, p.hotel_id)
  )
);

create policy "Managers can update next-day plan staff"
on public.next_day_housekeeping_plan_staff
for update to authenticated
using (
  exists (
    select 1 from public.next_day_housekeeping_plans p
    where p.id = plan_id
      and public.can_manage_next_day_housekeeping_plan(p.organization_slug, p.hotel_id)
  )
)
with check (
  exists (
    select 1 from public.next_day_housekeeping_plans p
    where p.id = plan_id
      and public.can_manage_next_day_housekeeping_plan(p.organization_slug, p.hotel_id)
  )
);

create policy "Managers can delete next-day plan staff"
on public.next_day_housekeeping_plan_staff
for delete to authenticated
using (
  exists (
    select 1 from public.next_day_housekeeping_plans p
    where p.id = plan_id
      and public.can_manage_next_day_housekeeping_plan(p.organization_slug, p.hotel_id)
  )
);

create policy "Managers can view next-day plan items"
on public.next_day_housekeeping_plan_items
for select to authenticated
using (
  exists (
    select 1 from public.next_day_housekeeping_plans p
    where p.id = plan_id
      and public.can_manage_next_day_housekeeping_plan(p.organization_slug, p.hotel_id)
  )
);

create policy "Managers can create next-day plan items"
on public.next_day_housekeeping_plan_items
for insert to authenticated
with check (
  exists (
    select 1 from public.next_day_housekeeping_plans p
    join public.rooms r on r.id = room_id
    join public.profiles assignee on assignee.id = assigned_to
    where p.id = plan_id
      and r.organization_slug = p.organization_slug
      and (r.hotel = p.hotel_id or public.get_hotel_name_from_id(r.hotel) = p.hotel_id or public.get_hotel_name_from_id(p.hotel_id) = r.hotel)
      and assignee.organization_slug = p.organization_slug
      and public.can_manage_next_day_housekeeping_plan(p.organization_slug, p.hotel_id)
  )
);

create policy "Managers can update next-day plan items"
on public.next_day_housekeeping_plan_items
for update to authenticated
using (
  exists (
    select 1 from public.next_day_housekeeping_plans p
    where p.id = plan_id
      and public.can_manage_next_day_housekeeping_plan(p.organization_slug, p.hotel_id)
  )
)
with check (
  exists (
    select 1 from public.next_day_housekeeping_plans p
    join public.rooms r on r.id = room_id
    join public.profiles assignee on assignee.id = assigned_to
    where p.id = plan_id
      and r.organization_slug = p.organization_slug
      and assignee.organization_slug = p.organization_slug
      and public.can_manage_next_day_housekeeping_plan(p.organization_slug, p.hotel_id)
  )
);

create policy "Managers can delete next-day plan items"
on public.next_day_housekeeping_plan_items
for delete to authenticated
using (
  exists (
    select 1 from public.next_day_housekeeping_plans p
    where p.id = plan_id
      and public.can_manage_next_day_housekeeping_plan(p.organization_slug, p.hotel_id)
  )
);

-- Transactional/idempotent release. If a room acquired any live assignment after
-- the plan was built, all planned rows for that room are skipped. This preserves
-- manual morning changes while still allowing planned shared-room assignments.
create or replace function public.release_next_day_housekeeping_plan(p_plan_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan public.next_day_housekeeping_plans%rowtype;
  v_planned_count integer := 0;
  v_inserted_count integer := 0;
  v_conflict_room_count integer := 0;
  v_result jsonb;
begin
  select * into v_plan
  from public.next_day_housekeeping_plans
  where id = p_plan_id
  for update;

  if not found then
    raise exception 'Next-day housekeeping plan not found';
  end if;

  if auth.uid() is not null
     and not public.can_manage_next_day_housekeeping_plan(v_plan.organization_slug, v_plan.hotel_id) then
    raise exception 'Not authorized to release this next-day housekeeping plan';
  end if;

  if v_plan.status = 'released' then
    return coalesce(v_plan.release_result, '{}'::jsonb) || jsonb_build_object('already_released', true);
  end if;

  if v_plan.status <> 'approved' then
    raise exception 'Only approved next-day housekeeping plans can be released (current status: %)', v_plan.status;
  end if;

  if v_plan.pms_synced_at is null then
    raise exception 'PMS sync is required before release';
  end if;

  update public.next_day_housekeeping_plans
  set status = 'releasing', release_attempted_at = now(), last_error = null
  where id = p_plan_id;

  select count(*) into v_planned_count
  from public.next_day_housekeeping_plan_items
  where plan_id = p_plan_id;

  select count(distinct i.room_id) into v_conflict_room_count
  from public.next_day_housekeeping_plan_items i
  where i.plan_id = p_plan_id
    and exists (
      select 1 from public.room_assignments ra
      where ra.room_id = i.room_id
        and ra.assignment_date = v_plan.plan_date
        and ra.status <> 'cancelled'::public.assignment_status
    );

  with eligible_rooms as materialized (
    select distinct i.room_id
    from public.next_day_housekeeping_plan_items i
    where i.plan_id = p_plan_id
      and not exists (
        select 1 from public.room_assignments ra
        where ra.room_id = i.room_id
          and ra.assignment_date = v_plan.plan_date
          and ra.status <> 'cancelled'::public.assignment_status
      )
  ), inserted as (
    insert into public.room_assignments (
      room_id,
      assigned_to,
      assigned_by,
      assignment_date,
      assignment_type,
      status,
      priority,
      estimated_duration,
      notes,
      organization_slug
    )
    select
      i.room_id,
      i.assigned_to,
      coalesce(v_plan.approved_by, v_plan.created_by),
      v_plan.plan_date,
      i.assignment_type,
      'assigned'::public.assignment_status,
      i.priority,
      i.estimated_duration,
      i.notes,
      v_plan.organization_slug
    from public.next_day_housekeeping_plan_items i
    join eligible_rooms er on er.room_id = i.room_id
    where i.plan_id = p_plan_id
    returning id
  )
  select count(*) into v_inserted_count from inserted;

  v_result := jsonb_build_object(
    'plan_id', p_plan_id,
    'plan_date', v_plan.plan_date,
    'planned_assignments', v_planned_count,
    'released_assignments', v_inserted_count,
    'skipped_rooms_with_live_changes', v_conflict_room_count,
    'released_at', now()
  );

  update public.next_day_housekeeping_plans
  set status = 'released',
      released_at = now(),
      release_result = v_result,
      last_error = null
  where id = p_plan_id;

  return v_result;
exception when others then
  -- PostgreSQL rolls back the assignment inserts on failure. The caller receives
  -- the error; a later scheduler run can retry an approved plan safely.
  raise;
end;
$$;

revoke all on function public.release_next_day_housekeeping_plan(uuid) from public;
grant execute on function public.release_next_day_housekeeping_plan(uuid) to authenticated;
grant execute on function public.release_next_day_housekeeping_plan(uuid) to service_role;

create or replace function public.release_due_next_day_housekeeping_plans()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan record;
  v_results jsonb := '[]'::jsonb;
  v_one jsonb;
begin
  for v_plan in
    select id
    from public.next_day_housekeeping_plans
    where status = 'approved'
      and auto_release = true
      and scheduled_release_at <= now()
    order by scheduled_release_at, created_at
    for update skip locked
  loop
    begin
      v_one := public.release_next_day_housekeeping_plan(v_plan.id);
      v_results := v_results || jsonb_build_array(v_one);
    exception when others then
      update public.next_day_housekeeping_plans
      set last_error = sqlerrm,
          release_attempted_at = now()
      where id = v_plan.id
        and status = 'approved';

      v_results := v_results || jsonb_build_array(
        jsonb_build_object('plan_id', v_plan.id, 'error', sqlerrm)
      );
    end;
  end loop;

  return v_results;
end;
$$;

revoke all on function public.release_due_next_day_housekeeping_plans() from public;
revoke all on function public.release_due_next_day_housekeeping_plans() from anon;
revoke all on function public.release_due_next_day_housekeeping_plans() from authenticated;
grant execute on function public.release_due_next_day_housekeeping_plans() to service_role;

-- pg_cron is already enabled in HotelCare. Poll every five minutes; each plan
-- carries its exact timezone-aware scheduled_release_at, so 08:00 local release
-- remains DST-safe and does not depend on a browser session.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'hotelcare-release-next-day-housekeeping',
      '*/5 * * * *',
      'select public.release_due_next_day_housekeeping_plans();'
    );
  end if;
end
$$;
