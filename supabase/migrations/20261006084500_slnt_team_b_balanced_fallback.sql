-- Improve SLNT Team B automatic fallback balancing.
-- Saved manager ownership is preserved. Only rooms with no valid saved owner are
-- balanced, with learned property preference used as a tie-breaker rather than
-- forcing an entire large apartment cluster onto one cleaner.
begin;

create or replace function public.finalize_slnt_team_b_after_full_pms_sync(
  p_service_date date
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_today date := (now() at time zone 'Europe/Budapest')::date;
  v_day_start timestamptz := (p_service_date::timestamp at time zone 'Europe/Budapest');
  v_team_id uuid;
  v_expected_accounts integer := 0;
  v_fresh_accounts integer := 0;
  v_staff_count integer := 0;
  v_staff_source text := 'saved_day_plan';
  v_cancelled integer := 0;
  v_type_changes integer := 0;
  v_candidate_repairs integer := 0;
  v_created integer := 0;
  v_linked integer := 0;
  v_task_id uuid;
  v_property text;
  v_owner uuid;
  v_preferred_owner uuid;
begin
  if p_service_date is null or p_service_date <> v_today then
    raise exception 'SLNT Team B finalization is only allowed for the current Budapest business date.';
  end if;

  if auth.uid() is not null
     and not public.can_manage_next_day_housekeeping_plan('slnt','slnt-group') then
    raise exception 'Manager permission required' using errcode='42501';
  end if;

  select id into v_team_id
  from public.housekeeping_teams
  where organization_slug='slnt'
    and hotel_id='slnt-group'
    and code='team-b'
    and is_active
  limit 1;
  if v_team_id is null then
    raise exception 'Active SLNT Team B is not configured.';
  end if;

  select count(*)::integer,
         count(*) filter (where last_sync_success_at >= v_day_start)::integer
    into v_expected_accounts, v_fresh_accounts
  from public.pms_accounts
  where organization_slug='slnt'
    and hotel_id='slnt-group'
    and pms_type='previo'
    and is_active=true
    and coalesce(sync_paused,false)=false;

  if v_expected_accounts < 2 or v_fresh_accounts < v_expected_accounts then
    return jsonb_build_object(
      'ok', false,
      'status', 'held_for_full_pms_sync',
      'service_date', p_service_date,
      'expected_accounts', v_expected_accounts,
      'fresh_accounts', v_fresh_accounts
    );
  end if;

  select count(*)::integer into v_staff_count
  from public.housekeeping_team_day_staff
  where team_id=v_team_id and service_date=p_service_date;

  if v_staff_count=0 then
    insert into public.housekeeping_team_day_staff(team_id,service_date,user_id,selected_by)
    select v_team_id,p_service_date,m.user_id,null
    from public.housekeeping_team_members m
    join public.staff_schedules s
      on s.organization_slug='slnt'
     and s.user_id=m.user_id
     and s.work_date=p_service_date
     and s.status='published'
    join public.profiles p on p.id=m.user_id
    where m.team_id=v_team_id
      and m.is_active
      and p.deleted_at is null
      and p.organization_slug='slnt'
    on conflict(team_id,service_date,user_id) do nothing;
    get diagnostics v_staff_count = row_count;
    if v_staff_count>0 then v_staff_source := 'published_staff_schedule'; end if;
  end if;

  if not exists (
    select 1 from public.housekeeping_team_day_staff
    where team_id=v_team_id and service_date=p_service_date
  ) then
    insert into public.housekeeping_team_day_staff(team_id,service_date,user_id,selected_by)
    select v_team_id,p_service_date,m.user_id,null
    from public.housekeeping_team_members m
    join public.profiles p on p.id=m.user_id
    where m.team_id=v_team_id
      and m.is_active
      and (m.effective_from is null or m.effective_from<=p_service_date)
      and (m.effective_to is null or m.effective_to>=p_service_date)
      and p.deleted_at is null
      and p.organization_slug='slnt'
      and (p.role::text='housekeeping' or p.acts_as_housekeeper=true)
    on conflict(team_id,service_date,user_id) do nothing;
    v_staff_source := 'active_team_fallback';
  end if;

  select count(*)::integer into v_staff_count
  from public.housekeeping_team_day_staff
  where team_id=v_team_id and service_date=p_service_date;
  if v_staff_count=0 then
    return jsonb_build_object('ok',false,'status','held_no_working_staff','service_date',p_service_date);
  end if;

  update public.housekeeping_team_tasks t
  set status='cancelled', updated_at=now()
  from public.rooms r
  left join public.housekeeping_team_rooms tr
    on tr.team_id=v_team_id and tr.room_id=r.id and tr.is_active
  where t.team_id=v_team_id
    and t.service_date=p_service_date
    and t.room_id=r.id
    and t.status='queued'
    and t.claimed_by is null
    and (
      tr.room_id is null
      or r.status='out_of_order'
      or coalesce((r.pms_metadata->>'excludedFromHousekeeping')::boolean,false)
    );
  get diagnostics v_cancelled = row_count;

  update public.housekeeping_team_tasks t
  set assignment_type=case when coalesce(r.is_checkout_room,false)
      then 'checkout_cleaning'::public.assignment_type
      else 'daily_cleaning'::public.assignment_type end,
      updated_at=now()
  from public.rooms r
  join public.housekeeping_team_rooms tr
    on tr.team_id=v_team_id and tr.room_id=r.id and tr.is_active
  where t.team_id=v_team_id
    and t.service_date=p_service_date
    and t.room_id=r.id
    and t.status='queued'
    and t.claimed_by is null
    and r.status is distinct from 'out_of_order'
    and t.assignment_type is distinct from
      (case when coalesce(r.is_checkout_room,false)
        then 'checkout_cleaning'::public.assignment_type
        else 'daily_cleaning'::public.assignment_type end);
  get diagnostics v_type_changes = row_count;

  update public.housekeeping_team_tasks t
  set planned_candidate_user_id=null, updated_at=now()
  where t.team_id=v_team_id
    and t.service_date=p_service_date
    and t.status='queued'
    and t.claimed_by is null
    and t.planned_candidate_user_id is not null
    and not exists (
      select 1 from public.housekeeping_team_day_staff ds
      where ds.team_id=v_team_id
        and ds.service_date=p_service_date
        and ds.user_id=t.planned_candidate_user_id
    );
  get diagnostics v_candidate_repairs = row_count;

  -- Balance only unresolved rooms. Property preference is a tie-breaker, so a
  -- 20-room property may be split across staff instead of overloading one cleaner.
  for v_task_id, v_property in
    select t.id, public.slnt_team_b_property_key(r.room_number)
    from public.housekeeping_team_tasks t
    join public.rooms r on r.id=t.room_id
    where t.team_id=v_team_id
      and t.service_date=p_service_date
      and t.status='queued'
      and t.claimed_by is null
      and t.planned_candidate_user_id is null
    order by public.slnt_team_b_property_key(r.room_number),
             t.priority asc,
             coalesce(t.estimated_duration,30) desc,
             r.room_number
  loop
    v_preferred_owner := null;
    select pref.user_id into v_preferred_owner
    from public.housekeeping_team_property_preferences pref
    where pref.team_id=v_team_id
      and pref.property_key=v_property
      and exists (
        select 1 from public.housekeeping_team_day_staff ds
        where ds.team_id=v_team_id
          and ds.service_date=p_service_date
          and ds.user_id=pref.user_id
      )
    limit 1;

    select ds.user_id into v_owner
    from public.housekeeping_team_day_staff ds
    left join lateral (
      select coalesce(sum(coalesce(t3.estimated_duration,30)),0)::integer as load_minutes
      from public.housekeeping_team_tasks t3
      where t3.team_id=v_team_id
        and t3.service_date=p_service_date
        and t3.status<>'cancelled'
        and t3.planned_candidate_user_id=ds.user_id
    ) load on true
    where ds.team_id=v_team_id and ds.service_date=p_service_date
    order by load.load_minutes asc,
             case when ds.user_id=v_preferred_owner then 0 else 1 end,
             ds.user_id
    limit 1;

    if v_owner is not null then
      update public.housekeeping_team_tasks
      set planned_candidate_user_id=v_owner, updated_at=now()
      where id=v_task_id
        and status='queued'
        and claimed_by is null
        and planned_candidate_user_id is null;
    end if;
  end loop;

  insert into public.room_assignments(
    room_id,assigned_to,assigned_by,assignment_date,assignment_type,status,
    priority,estimated_duration,notes,organization_slug,ready_to_clean
  )
  select
    t.room_id,
    t.planned_candidate_user_id,
    t.planned_candidate_user_id,
    t.service_date,
    t.assignment_type,
    'assigned'::public.assignment_status,
    t.priority,
    t.estimated_duration,
    case when coalesce(t.notes,'')=''
      then 'Auto-distributed after full SLNT PMS sync.'
      else t.notes end,
    'slnt',
    case when t.assignment_type='checkout_cleaning'::public.assignment_type
      then coalesce((r.pms_metadata->>'checkedOutToday')::boolean,false)
      else true end
  from public.housekeeping_team_tasks t
  join public.rooms r on r.id=t.room_id
  join public.housekeeping_team_rooms tr
    on tr.team_id=v_team_id and tr.room_id=t.room_id and tr.is_active
  join public.housekeeping_team_day_staff ds
    on ds.team_id=v_team_id
   and ds.service_date=t.service_date
   and ds.user_id=t.planned_candidate_user_id
  where t.team_id=v_team_id
    and t.service_date=p_service_date
    and t.status='queued'
    and t.claimed_by is null
    and t.planned_candidate_user_id is not null
    and r.status is distinct from 'out_of_order'
    and not exists (
      select 1 from public.room_assignments ra
      where ra.room_id=t.room_id
        and ra.assignment_date=t.service_date
        and ra.status<>'cancelled'::public.assignment_status
    );
  get diagnostics v_created = row_count;

  update public.housekeeping_team_tasks t
  set status='claimed',
      claimed_by=t.planned_candidate_user_id,
      claimed_at=coalesce(t.claimed_at,now()),
      room_assignment_id=ra.id,
      updated_at=now()
  from public.room_assignments ra
  where t.team_id=v_team_id
    and t.service_date=p_service_date
    and t.status='queued'
    and t.planned_candidate_user_id is not null
    and ra.room_id=t.room_id
    and ra.assignment_date=t.service_date
    and ra.assigned_to=t.planned_candidate_user_id
    and ra.status<>'cancelled'::public.assignment_status;
  get diagnostics v_linked = row_count;

  return jsonb_build_object(
    'ok',true,
    'status','distributed',
    'service_date',p_service_date,
    'staff_source',v_staff_source,
    'staff_count',v_staff_count,
    'inactive_tasks_cancelled',v_cancelled,
    'service_type_changes',v_type_changes,
    'invalid_candidate_repairs',v_candidate_repairs,
    'assignments_created',v_created,
    'tasks_materialized',v_linked,
    'remaining_unassigned',(
      select count(*) from public.housekeeping_team_tasks
      where team_id=v_team_id and service_date=p_service_date and status='queued'
    )
  );
end;
$$;

revoke all on function public.finalize_slnt_team_b_after_full_pms_sync(date) from public;
grant execute on function public.finalize_slnt_team_b_after_full_pms_sync(date) to authenticated;
grant execute on function public.finalize_slnt_team_b_after_full_pms_sync(date) to service_role;

comment on function public.finalize_slnt_team_b_after_full_pms_sync(date) is
  'SLNT-only fail-closed morning finalizer. Preserves valid saved owners and evenly balances only unresolved rooms after both Previo feeds are fresh.';

commit;
