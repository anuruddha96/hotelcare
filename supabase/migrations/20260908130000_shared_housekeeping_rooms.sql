-- Shared housekeeping rooms
-- A room keeps ONE canonical room_assignments row. assigned_to remains the
-- primary cleaner; shared_with is the optional second cleaner. This prevents
-- linen/minibar/status data from forking into two independent room jobs.

alter table public.room_assignments
  add column if not exists shared_with uuid references auth.users(id) on delete set null,
  add column if not exists shared_assigned_at timestamptz,
  add column if not exists shared_assigned_by uuid references auth.users(id) on delete set null,
  add column if not exists started_by uuid references auth.users(id) on delete set null,
  add column if not exists completed_by uuid references auth.users(id) on delete set null;

create index if not exists idx_room_assignments_shared_with_date
  on public.room_assignments (shared_with, assignment_date)
  where shared_with is not null;

-- Never allow the same user to occupy both seats on a shared room.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'room_assignments_shared_with_different_user'
      and conrelid = 'public.room_assignments'::regclass
  ) then
    alter table public.room_assignments
      add constraint room_assignments_shared_with_different_user
      check (shared_with is null or shared_with is distinct from assigned_to);
  end if;
end $$;

-- Secondary cleaners need the same canonical row in their own app. Existing
-- manager / primary-housekeeper policies remain untouched; permissive policies
-- are ORed by Postgres with those policies.
drop policy if exists "Shared housekeepers can view their room assignments" on public.room_assignments;
create policy "Shared housekeepers can view their room assignments"
  on public.room_assignments
  for select
  to authenticated
  using (shared_with = auth.uid());

drop policy if exists "Shared housekeepers can update their room assignments" on public.room_assignments;
create policy "Shared housekeepers can update their room assignments"
  on public.room_assignments
  for update
  to authenticated
  using (shared_with = auth.uid())
  with check (shared_with = auth.uid());

-- Stamp the actor who first starts the canonical room job and the actor who
-- confirms/completes it. Both cleaners therefore see one status timeline.
create or replace function public.stamp_shared_housekeeping_actors()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'in_progress' and old.status is distinct from 'in_progress' then
    new.started_by := coalesce(old.started_by, auth.uid());
  elsif new.started_by is null then
    new.started_by := old.started_by;
  end if;

  if new.status = 'completed' and old.status is distinct from 'completed' then
    new.completed_by := auth.uid();
  elsif new.status is distinct from 'completed' and old.status = 'completed' then
    -- A manager reopening the room starts a new confirmation opportunity.
    new.completed_by := null;
  elsif new.completed_by is null then
    new.completed_by := old.completed_by;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_stamp_shared_housekeeping_actors on public.room_assignments;
create trigger trg_stamp_shared_housekeeping_actors
before update on public.room_assignments
for each row execute function public.stamp_shared_housekeeping_actors();

-- Atomic assign/share operation used by drag & drop. It deliberately keeps
-- assigned_to unchanged when a room already has a primary cleaner. The second
-- drop fills shared_with instead, including while cleaning is already active.
create or replace function public.assign_or_share_housekeeping_room(
  p_room_id uuid,
  p_staff_id uuid,
  p_assignment_date date,
  p_assigned_by uuid,
  p_organization_slug text default null,
  p_is_checkout_room boolean default false,
  p_ready_to_clean boolean default null,
  p_priority integer default null
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_assignment public.room_assignments%rowtype;
begin
  select *
    into v_assignment
    from public.room_assignments
   where room_id = p_room_id
     and assignment_date = p_assignment_date
   for update;

  if not found then
    insert into public.room_assignments (
      room_id,
      assigned_to,
      assigned_by,
      assignment_date,
      assignment_type,
      status,
      organization_slug,
      ready_to_clean,
      priority
    ) values (
      p_room_id,
      p_staff_id,
      p_assigned_by,
      p_assignment_date,
      case when p_is_checkout_room then 'checkout_cleaning' else 'daily_cleaning' end,
      'assigned',
      p_organization_slug,
      coalesce(p_ready_to_clean, false),
      coalesce(p_priority, 0)
    )
    returning * into v_assignment;

    return jsonb_build_object(
      'ok', true,
      'mode', 'primary',
      'assignment_id', v_assignment.id,
      'assigned_to', v_assignment.assigned_to,
      'shared_with', v_assignment.shared_with
    );
  end if;

  if v_assignment.assigned_to = p_staff_id or v_assignment.shared_with = p_staff_id then
    return jsonb_build_object(
      'ok', true,
      'mode', 'existing',
      'assignment_id', v_assignment.id,
      'assigned_to', v_assignment.assigned_to,
      'shared_with', v_assignment.shared_with
    );
  end if;

  if v_assignment.shared_with is not null then
    return jsonb_build_object(
      'ok', false,
      'code', 'shared_assignment_full',
      'assignment_id', v_assignment.id,
      'assigned_to', v_assignment.assigned_to,
      'shared_with', v_assignment.shared_with
    );
  end if;

  update public.room_assignments
     set shared_with = p_staff_id,
         shared_assigned_at = now(),
         shared_assigned_by = p_assigned_by
   where id = v_assignment.id
   returning * into v_assignment;

  return jsonb_build_object(
    'ok', true,
    'mode', 'shared',
    'assignment_id', v_assignment.id,
    'assigned_to', v_assignment.assigned_to,
    'shared_with', v_assignment.shared_with
  );
end;
$$;

grant execute on function public.assign_or_share_housekeeping_room(uuid, uuid, date, uuid, text, boolean, boolean, integer)
  to authenticated;

-- Canonical dirty-linen record for an assigned room. Existing duplicate rows
-- (if two cleaners happened to enter the same room historically) are collapsed
-- before the unique index is added; the highest recorded count is retained.
with ranked as (
  select id,
         max(count) over (partition by assignment_id, linen_item_id) as max_count,
         row_number() over (partition by assignment_id, linen_item_id order by id) as rn
    from public.dirty_linen_counts
   where assignment_id is not null
)
update public.dirty_linen_counts d
   set count = r.max_count
  from ranked r
 where d.id = r.id
   and r.rn = 1;

with ranked as (
  select id,
         row_number() over (partition by assignment_id, linen_item_id order by id) as rn
    from public.dirty_linen_counts
   where assignment_id is not null
)
delete from public.dirty_linen_counts d
 using ranked r
 where d.id = r.id
   and r.rn > 1;

create unique index if not exists uq_dirty_linen_assignment_item
  on public.dirty_linen_counts (assignment_id, linen_item_id)
  where assignment_id is not null;

alter table public.dirty_linen_counts
  add column if not exists updated_by uuid references auth.users(id) on delete set null;

create or replace function public.upsert_shared_dirty_linen(
  p_assignment_id uuid,
  p_linen_item_id uuid,
  p_count integer
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_assignment public.room_assignments%rowtype;
  v_actor uuid := auth.uid();
  v_existing_id uuid;
begin
  select *
    into v_assignment
    from public.room_assignments
   where id = p_assignment_id
   for update;

  if not found then
    raise exception 'Housekeeping assignment not found';
  end if;

  if v_actor is null or (v_assignment.assigned_to <> v_actor and v_assignment.shared_with is distinct from v_actor) then
    raise exception 'You are not assigned to this room';
  end if;

  -- Only after the final room confirmation do we stop the partner from writing
  -- the same final data again. Draft/in-progress edits remain collaborative.
  if v_assignment.status = 'completed'
     and v_assignment.completed_by is not null
     and v_assignment.completed_by <> v_actor then
    return jsonb_build_object(
      'ok', false,
      'code', 'already_confirmed',
      'confirmed_by', v_assignment.completed_by
    );
  end if;

  if coalesce(p_count, 0) <= 0 then
    delete from public.dirty_linen_counts
     where assignment_id = p_assignment_id
       and linen_item_id = p_linen_item_id;

    return jsonb_build_object('ok', true, 'deleted', true);
  end if;

  insert into public.dirty_linen_counts (
    housekeeper_id,
    room_id,
    assignment_id,
    linen_item_id,
    count,
    work_date,
    updated_by
  ) values (
    v_actor,
    v_assignment.room_id,
    v_assignment.id,
    p_linen_item_id,
    p_count,
    v_assignment.assignment_date,
    v_actor
  )
  on conflict (assignment_id, linen_item_id) where assignment_id is not null
  do update set
    count = excluded.count,
    updated_by = excluded.updated_by;

  select id into v_existing_id
    from public.dirty_linen_counts
   where assignment_id = p_assignment_id
     and linen_item_id = p_linen_item_id;

  return jsonb_build_object('ok', true, 'id', v_existing_id);
end;
$$;

grant execute on function public.upsert_shared_dirty_linen(uuid, uuid, integer)
  to authenticated;

comment on column public.room_assignments.shared_with is
  'Optional second housekeeper sharing the same canonical room cleaning job.';
comment on column public.room_assignments.started_by is
  'Housekeeper who first opened/started the canonical shared room job.';
comment on column public.room_assignments.completed_by is
  'Housekeeper who performed the final confirmed completion of the canonical room job.';
