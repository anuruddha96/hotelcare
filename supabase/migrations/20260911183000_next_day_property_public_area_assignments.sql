-- Property-configured public areas must participate in tomorrow housekeeping planning.
-- Keep these assignments separate from room-plan generation so managers can add/change
-- them without losing them when the room algorithm is regenerated. They materialize
-- into general_tasks only when the approved next-day plan is actually released.

create table if not exists public.next_day_housekeeping_public_area_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_slug text not null,
  hotel_id text not null,
  plan_date date not null,
  public_area_id uuid not null references public.hotel_public_areas(id) on delete cascade,
  assigned_to uuid not null references public.profiles(id),
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint next_day_hk_public_area_assignment_unique
    unique (organization_slug, hotel_id, plan_date, public_area_id)
);

create index if not exists idx_next_day_hk_public_area_assignments_lookup
  on public.next_day_housekeeping_public_area_assignments
    (organization_slug, hotel_id, plan_date);

create index if not exists idx_next_day_hk_public_area_assignments_staff
  on public.next_day_housekeeping_public_area_assignments (assigned_to, plan_date);

alter table public.next_day_housekeeping_public_area_assignments enable row level security;

drop policy if exists "Managers can view next-day property public areas"
  on public.next_day_housekeeping_public_area_assignments;
create policy "Managers can view next-day property public areas"
  on public.next_day_housekeeping_public_area_assignments
  for select to authenticated
  using (public.can_manage_next_day_housekeeping_plan(organization_slug, hotel_id));

drop policy if exists "Managers can create next-day property public areas"
  on public.next_day_housekeeping_public_area_assignments;
create policy "Managers can create next-day property public areas"
  on public.next_day_housekeeping_public_area_assignments
  for insert to authenticated
  with check (public.can_manage_next_day_housekeeping_plan(organization_slug, hotel_id));

drop policy if exists "Managers can update next-day property public areas"
  on public.next_day_housekeeping_public_area_assignments;
create policy "Managers can update next-day property public areas"
  on public.next_day_housekeeping_public_area_assignments
  for update to authenticated
  using (public.can_manage_next_day_housekeeping_plan(organization_slug, hotel_id))
  with check (public.can_manage_next_day_housekeeping_plan(organization_slug, hotel_id));

drop policy if exists "Managers can delete next-day property public areas"
  on public.next_day_housekeeping_public_area_assignments;
create policy "Managers can delete next-day property public areas"
  on public.next_day_housekeeping_public_area_assignments
  for delete to authenticated
  using (public.can_manage_next_day_housekeeping_plan(organization_slug, hotel_id));

create or replace function public.validate_next_day_property_public_area_assignment()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_area_hotel text;
  v_plan_status text;
  v_claim_role text := current_setting('request.jwt.claim.role', true);
begin
  if new.plan_date < (now() at time zone 'Europe/Budapest')::date then
    raise exception 'Tomorrow public-area assignments cannot target a past date';
  end if;

  if auth.uid() is not null and coalesce(v_claim_role, '') <> 'service_role' then
    if not public.can_manage_next_day_housekeeping_plan(new.organization_slug, new.hotel_id) then
      raise exception 'Not authorized to manage tomorrow public-area assignments for this hotel';
    end if;

    if tg_op = 'INSERT' and new.created_by is distinct from auth.uid() then
      raise exception 'created_by must match the signed-in user';
    end if;
    new.updated_by := auth.uid();
  end if;

  select area.hotel_name
    into v_area_hotel
  from public.hotel_public_areas area
  where area.id = new.public_area_id;

  if v_area_hotel is null then
    raise exception 'Public area does not exist';
  end if;

  if not exists (
    select 1
    from public.hotel_configurations hc
    where (hc.hotel_id = new.hotel_id or hc.hotel_name = new.hotel_id)
      and lower(trim(hc.hotel_name)) = lower(trim(v_area_hotel))
  ) and lower(trim(new.hotel_id)) <> lower(trim(v_area_hotel)) then
    raise exception 'Public area belongs to another hotel';
  end if;

  if not exists (
    select 1
    from public.profiles person
    where person.id = new.assigned_to
      and person.organization_slug = new.organization_slug
      and person.deleted_at is null
      and (
        person.role::text in ('housekeeping','housekeeping_manager','supervisor')
        or coalesce(person.acts_as_housekeeper, false)
      )
      and (
        person.assigned_hotel = new.hotel_id
        or person.hotel_id = new.hotel_id
        or exists (
          select 1
          from public.hotel_configurations hc
          where (hc.hotel_id = new.hotel_id or hc.hotel_name = new.hotel_id)
            and (
              person.assigned_hotel = hc.hotel_id
              or person.assigned_hotel = hc.hotel_name
              or person.hotel_id = hc.hotel_id
              or person.hotel_id = hc.hotel_name
            )
        )
      )
  ) then
    raise exception 'Public-area assignee is not an eligible housekeeper for this hotel';
  end if;

  if exists (
    select 1
    from public.staff_schedules schedule
    where schedule.organization_slug = new.organization_slug
      and schedule.hotel_id = new.hotel_id
      and schedule.user_id = new.assigned_to
      and schedule.work_date = new.plan_date
      and schedule.status = 'off'
  ) then
    raise exception 'A worker scheduled Off cannot receive tomorrow public-area work';
  end if;

  select plan.status
    into v_plan_status
  from public.next_day_housekeeping_plans plan
  where plan.organization_slug = new.organization_slug
    and plan.hotel_id = new.hotel_id
    and plan.plan_date = new.plan_date
  limit 1;

  if v_plan_status in ('releasing', 'released') then
    raise exception 'Tomorrow public-area assignments cannot change after release starts';
  end if;

  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists validate_next_day_property_public_area_assignment
  on public.next_day_housekeeping_public_area_assignments;
create trigger validate_next_day_property_public_area_assignment
before insert or update on public.next_day_housekeeping_public_area_assignments
for each row execute function public.validate_next_day_property_public_area_assignment();

-- Link released operational tasks back to the staged property-area assignment so
-- materialization stays idempotent and audit-friendly.
alter table public.general_tasks
  add column if not exists next_day_property_area_assignment_id uuid
  references public.next_day_housekeeping_public_area_assignments(id) on delete set null;

create unique index if not exists uq_general_tasks_next_day_property_area_assignment
  on public.general_tasks (next_day_property_area_assignment_id)
  where next_day_property_area_assignment_id is not null;

-- Extend the existing release materializer: mapped/one-off plan tasks continue to
-- work exactly as before, and property-configured areas are released from the new
-- staging table at the same moment. They are therefore invisible to housekeepers
-- until the approved plan is released.
create or replace function public.materialize_released_next_day_area_tasks()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_hotel_name text;
begin
  if new.status <> 'released' or old.status = 'released' then
    return new;
  end if;

  select coalesce(hc.hotel_name, new.hotel_id)
    into v_hotel_name
  from (select 1) seed
  left join public.hotel_configurations hc on hc.hotel_id = new.hotel_id
  limit 1;

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
    housekeeping_section_task_id,
    next_day_plan_area_task_id
  )
  select
    a.task_name,
    case when a.source = 'mapped'
      then 'Mapped public-area work from approved tomorrow housekeeping plan'
      else 'Public-area work from approved tomorrow housekeeping plan'
    end,
    a.task_type,
    a.assigned_to,
    coalesce(new.approved_by, new.created_by),
    new.plan_date,
    'assigned',
    1,
    a.estimated_duration,
    coalesce(v_hotel_name, new.hotel_id),
    new.organization_slug,
    a.section_id,
    a.section_task_id,
    a.id
  from public.next_day_housekeeping_plan_area_tasks a
  where a.plan_id = new.id
  on conflict (next_day_plan_area_task_id) where next_day_plan_area_task_id is not null
  do nothing;

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
    next_day_property_area_assignment_id
  )
  select
    area.name,
    coalesce(area.description, 'Property public-area work from approved tomorrow housekeeping plan'),
    area.task_type,
    assignment.assigned_to,
    coalesce(new.approved_by, new.created_by, assignment.updated_by, assignment.created_by),
    new.plan_date,
    'assigned',
    1,
    null,
    coalesce(v_hotel_name, new.hotel_id),
    new.organization_slug,
    assignment.id
  from public.next_day_housekeeping_public_area_assignments assignment
  join public.hotel_public_areas area on area.id = assignment.public_area_id
  where assignment.organization_slug = new.organization_slug
    and assignment.hotel_id = new.hotel_id
    and assignment.plan_date = new.plan_date
    and not exists (
      select 1
      from public.next_day_housekeeping_plan_area_tasks planned
      where planned.plan_id = new.id
        and planned.assigned_to = assignment.assigned_to
        and (
          lower(trim(planned.task_name)) = lower(trim(area.name))
          or lower(trim(planned.task_type)) = lower(trim(area.task_type))
        )
    )
  on conflict (next_day_property_area_assignment_id)
    where next_day_property_area_assignment_id is not null
  do nothing;

  return new;
end;
$function$;
