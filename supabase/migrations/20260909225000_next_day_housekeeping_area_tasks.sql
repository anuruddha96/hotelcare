-- Persist tomorrow public-area work alongside the delayed housekeeping plan.
-- These rows remain invisible to housekeepers until the parent plan is released.

create table if not exists public.next_day_housekeeping_plan_area_tasks (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.next_day_housekeeping_plans(id) on delete cascade,
  task_key text not null,
  task_name text not null,
  task_type text not null default 'general_cleaning',
  assigned_to uuid not null references public.profiles(id),
  source text not null default 'manual' check (source in ('mapped','manual')),
  section_id uuid null references public.hotel_housekeeping_sections(id) on delete set null,
  section_task_id uuid null references public.hotel_housekeeping_section_tasks(id) on delete set null,
  estimated_duration integer null check (estimated_duration is null or estimated_duration > 0),
  sort_order integer not null default 0,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id, task_key)
);

create index if not exists next_day_plan_area_tasks_plan_idx
  on public.next_day_housekeeping_plan_area_tasks(plan_id, assigned_to);

alter table public.next_day_housekeeping_plan_area_tasks enable row level security;

drop policy if exists "Eligible planners can view next-day area tasks"
  on public.next_day_housekeeping_plan_area_tasks;
create policy "Eligible planners can view next-day area tasks"
  on public.next_day_housekeeping_plan_area_tasks
  for select to authenticated
  using (
    exists (
      select 1
      from public.next_day_housekeeping_plans p
      where p.id = next_day_housekeeping_plan_area_tasks.plan_id
        and public.can_manage_next_day_housekeeping_plan(p.organization_slug, p.hotel_id)
    )
  );

drop policy if exists "Eligible planners can create next-day area tasks"
  on public.next_day_housekeeping_plan_area_tasks;
create policy "Eligible planners can create next-day area tasks"
  on public.next_day_housekeeping_plan_area_tasks
  for insert to authenticated
  with check (
    exists (
      select 1
      from public.next_day_housekeeping_plans p
      where p.id = next_day_housekeeping_plan_area_tasks.plan_id
        and p.status = 'draft'
        and public.can_manage_next_day_housekeeping_plan(p.organization_slug, p.hotel_id)
    )
  );

drop policy if exists "Eligible planners can update next-day area tasks"
  on public.next_day_housekeeping_plan_area_tasks;
create policy "Eligible planners can update next-day area tasks"
  on public.next_day_housekeeping_plan_area_tasks
  for update to authenticated
  using (
    exists (
      select 1
      from public.next_day_housekeeping_plans p
      where p.id = next_day_housekeeping_plan_area_tasks.plan_id
        and p.status = 'draft'
        and public.can_manage_next_day_housekeeping_plan(p.organization_slug, p.hotel_id)
    )
  )
  with check (
    exists (
      select 1
      from public.next_day_housekeeping_plans p
      where p.id = next_day_housekeeping_plan_area_tasks.plan_id
        and p.status = 'draft'
        and public.can_manage_next_day_housekeeping_plan(p.organization_slug, p.hotel_id)
    )
  );

drop policy if exists "Eligible planners can delete next-day area tasks"
  on public.next_day_housekeeping_plan_area_tasks;
create policy "Eligible planners can delete next-day area tasks"
  on public.next_day_housekeeping_plan_area_tasks
  for delete to authenticated
  using (
    exists (
      select 1
      from public.next_day_housekeeping_plans p
      where p.id = next_day_housekeeping_plan_area_tasks.plan_id
        and p.status = 'draft'
        and public.can_manage_next_day_housekeeping_plan(p.organization_slug, p.hotel_id)
    )
  );

create or replace function public.validate_next_day_housekeeping_area_task()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan public.next_day_housekeeping_plans%rowtype;
  v_section_hotel text;
begin
  select * into v_plan
  from public.next_day_housekeeping_plans
  where id = new.plan_id;

  if not found then
    raise exception 'Next-day housekeeping plan does not exist';
  end if;

  if coalesce(auth.role(), '') <> 'service_role' then
    if (now() at time zone 'Europe/Budapest')::time < time '12:00' then
      raise exception 'Tomorrow housekeeping planning is available after 12:00 Europe/Budapest';
    end if;
    if v_plan.status <> 'draft' then
      raise exception 'Tomorrow public-area work can only be edited while the plan is a draft';
    end if;
    if not public.can_manage_next_day_housekeeping_plan(v_plan.organization_slug, v_plan.hotel_id) then
      raise exception 'Not authorized to manage this tomorrow housekeeping plan';
    end if;
    if new.created_by is distinct from auth.uid() then
      raise exception 'created_by must match the signed-in user';
    end if;
  end if;

  if length(trim(coalesce(new.task_key, ''))) = 0 or length(new.task_key) > 160 then
    raise exception 'Invalid public-area task key';
  end if;
  if length(trim(coalesce(new.task_name, ''))) = 0 or length(new.task_name) > 240 then
    raise exception 'Invalid public-area task name';
  end if;
  if length(trim(coalesce(new.task_type, ''))) = 0 or length(new.task_type) > 120 then
    raise exception 'Invalid public-area task type';
  end if;

  if not exists (
    select 1
    from public.next_day_housekeeping_plan_staff s
    where s.plan_id = new.plan_id
      and s.user_id = new.assigned_to
      and s.selected = true
  ) then
    raise exception 'Public-area assignee must be selected for the tomorrow plan';
  end if;

  if new.section_task_id is not null then
    select hs.hotel_name into v_section_hotel
    from public.hotel_housekeeping_section_tasks ht
    join public.hotel_housekeeping_sections hs on hs.id = ht.section_id
    where ht.id = new.section_task_id
      and (new.section_id is null or new.section_id = ht.section_id);

    if v_section_hotel is null then
      raise exception 'Mapped public-area task is not valid';
    end if;

    if not exists (
      select 1
      from public.hotel_configurations hc
      where hc.hotel_id = v_plan.hotel_id
        and lower(trim(hc.hotel_name)) = lower(trim(v_section_hotel))
    ) and lower(trim(v_plan.hotel_id)) <> lower(trim(v_section_hotel)) then
      raise exception 'Mapped public-area task belongs to another hotel';
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.validate_next_day_housekeeping_area_task() from public, anon, authenticated;

create trigger validate_next_day_housekeeping_area_task_before_write
before insert or update on public.next_day_housekeeping_plan_area_tasks
for each row execute function public.validate_next_day_housekeeping_area_task();

-- Preserve a stable link from a released general task to its plan row so the
-- release trigger is idempotent even if a worker retries the final status write.
alter table public.general_tasks
  add column if not exists next_day_plan_area_task_id uuid null
  references public.next_day_housekeeping_plan_area_tasks(id) on delete set null;

create unique index if not exists general_tasks_next_day_plan_area_task_uidx
  on public.general_tasks(next_day_plan_area_task_id)
  where next_day_plan_area_task_id is not null;

create or replace function public.materialize_released_next_day_area_tasks()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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
    case when a.source = 'mapped' then 'Mapped public-area work from approved tomorrow housekeeping plan' else 'Public-area work from approved tomorrow housekeeping plan' end,
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

  return new;
end;
$$;

revoke all on function public.materialize_released_next_day_area_tasks() from public, anon, authenticated;

create trigger materialize_released_next_day_area_tasks_after_release
after update of status on public.next_day_housekeeping_plans
for each row execute function public.materialize_released_next_day_area_tasks();

grant select, insert, update, delete on public.next_day_housekeeping_plan_area_tasks to authenticated;
grant all on public.next_day_housekeeping_plan_area_tasks to service_role;
