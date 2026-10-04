-- SLNT Team B operational simplification: planned work becomes real assignments.
-- RD Hotels and SLNT Team A are untouched.
begin;

create or replace function public.materialize_slnt_team_b_planned_assignments(
  p_service_date date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
  v_actor uuid := auth.uid();
  v_created integer := 0;
  v_linked integer := 0;
begin
  if v_actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if not public.can_manage_next_day_housekeeping_plan('slnt','slnt-group') then
    raise exception 'Manager permission required' using errcode='42501';
  end if;

  select id into v_team_id from public.housekeeping_teams
   where organization_slug='slnt' and hotel_id='slnt-group' and code='team-b' and is_active limit 1;
  if v_team_id is null then raise exception 'Active SLNT Team B is not configured'; end if;

  -- Only materialize a planned cleaner who is actually selected for this day.
  insert into public.room_assignments (
    room_id, assigned_to, assigned_by, assignment_date, assignment_type,
    status, priority, estimated_duration, notes, organization_slug
  )
  select t.room_id, t.planned_candidate_user_id, v_actor, t.service_date,
         t.assignment_type, 'assigned'::public.assignment_status, t.priority,
         t.estimated_duration, t.notes, 'slnt'
  from public.housekeeping_team_tasks t
  join public.housekeeping_team_day_staff ds
    on ds.team_id=t.team_id and ds.service_date=t.service_date
   and ds.user_id=t.planned_candidate_user_id
  join public.rooms r on r.id=t.room_id
  where t.team_id=v_team_id and t.service_date=p_service_date
    and t.status='queued' and t.claimed_by is null
    and t.planned_candidate_user_id is not null
    and r.organization_slug='slnt' and r.status is distinct from 'out_of_order'
    and not exists (
      select 1 from public.room_assignments ra
       where ra.room_id=t.room_id and ra.assignment_date=t.service_date
         and ra.status <> 'cancelled'::public.assignment_status
    );
  get diagnostics v_created = row_count;

  update public.housekeeping_team_tasks t
     set status='claimed',
         claimed_by=t.planned_candidate_user_id,
         claimed_at=coalesce(t.claimed_at,now()),
         room_assignment_id=ra.id,
         updated_at=now()
    from public.room_assignments ra
   where t.team_id=v_team_id and t.service_date=p_service_date
     and t.status='queued' and t.planned_candidate_user_id is not null
     and ra.room_id=t.room_id and ra.assignment_date=t.service_date
     and ra.assigned_to=t.planned_candidate_user_id
     and ra.status <> 'cancelled'::public.assignment_status;
  get diagnostics v_linked = row_count;

  return jsonb_build_object(
    'service_date',p_service_date,
    'assignments_created',v_created,
    'tasks_materialized',v_linked,
    'unassigned_count',(select count(*) from public.housekeeping_team_tasks
      where team_id=v_team_id and service_date=p_service_date and status='queued')
  );
end;
$$;

revoke all on function public.materialize_slnt_team_b_planned_assignments(date) from public;
grant execute on function public.materialize_slnt_team_b_planned_assignments(date) to authenticated;

-- Preserve planned assignments on release. The shared queue is now only the
-- exception path for rooms that have no valid planned cleaner.
create or replace function public.materialize_slnt_team_b_queue_after_plan_release()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
  v_actor uuid;
begin
  if new.organization_slug <> 'slnt' or new.status <> 'released' or old.status='released' then return new; end if;
  select id into v_team_id from public.housekeeping_teams
   where organization_slug='slnt' and code='team-b' and is_active limit 1;
  if v_team_id is null then return new; end if;

  insert into public.housekeeping_team_tasks (
    organization_slug,hotel_id,team_id,room_id,service_date,assignment_type,
    priority,estimated_duration,notes,status,source_plan_item_id,planned_candidate_user_id,
    claimed_by,claimed_at,room_assignment_id
  )
  select new.organization_slug,new.hotel_id,v_team_id,i.room_id,new.plan_date,i.assignment_type,
         i.priority,i.estimated_duration,i.notes,
         case when ra.id is null then 'queued' else 'claimed' end,
         i.id,i.assigned_to,
         case when ra.id is null then null else i.assigned_to end,
         case when ra.id is null then null else now() end,
         ra.id
    from public.next_day_housekeeping_plan_items i
    join public.housekeeping_team_rooms tr on tr.team_id=v_team_id and tr.room_id=i.room_id and tr.is_active
    left join public.room_assignments ra on ra.room_id=i.room_id
      and ra.assigned_to=i.assigned_to and ra.assignment_date=new.plan_date
      and ra.assignment_type=i.assignment_type and ra.status='assigned'::public.assignment_status
   where i.plan_id=new.id
  on conflict (team_id,service_date,room_id) do update set
    assignment_type=excluded.assignment_type, priority=excluded.priority,
    estimated_duration=excluded.estimated_duration, notes=excluded.notes,
    source_plan_item_id=excluded.source_plan_item_id,
    planned_candidate_user_id=excluded.planned_candidate_user_id,
    status=case when public.housekeeping_team_tasks.status='claimed' then 'claimed' else excluded.status end,
    claimed_by=coalesce(public.housekeeping_team_tasks.claimed_by,excluded.claimed_by),
    claimed_at=coalesce(public.housekeeping_team_tasks.claimed_at,excluded.claimed_at),
    room_assignment_id=coalesce(public.housekeeping_team_tasks.room_assignment_id,excluded.room_assignment_id),
    updated_at=now();

  update public.next_day_housekeeping_plans
     set release_result=coalesce(release_result,'{}'::jsonb)||jsonb_build_object(
       'team_b_shared_queue',false,
       'team_b_assignment_mode','planned_first_exception_queue',
       'queued_team_b_tasks',(select count(*) from public.housekeeping_team_tasks
          where team_id=v_team_id and service_date=new.plan_date and status='queued')
     ), updated_at=now()
   where id=new.id;
  return new;
end;
$$;

comment on function public.materialize_slnt_team_b_planned_assignments(date) is
 'SLNT-only: converts valid Team B planned cleaners into normal room assignments; leaves only exceptions in the shared queue.';
commit;
