-- The current unified Auto Assign editor predates configurable release times and
-- still submits the historical 08:00 default while saving a reviewed draft.
-- Preserve an already-selected custom time unless it is being changed through
-- the explicit release-time RPC. This prevents Review plan -> Approve from
-- silently resetting a manager's chosen schedule.

create or replace function public.prepare_next_day_housekeeping_plan()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.plan_date < current_date then
    raise exception 'Next-day housekeeping plans cannot target a past date';
  end if;

  begin
    perform now() at time zone new.release_timezone;
  exception when invalid_parameter_value then
    raise exception 'Invalid release timezone: %', new.release_timezone;
  end;

  if tg_op = 'UPDATE'
     and coalesce(current_setting('hotelcare.explicit_release_time_update', true), '') <> '1'
     and old.status = 'draft'
     and new.status = 'draft'
     and old.release_time <> time '08:00'
     and new.release_time = time '08:00' then
    new.release_time := old.release_time;
  end if;

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
$function$;

create or replace function public.update_next_day_housekeeping_release_time(
  p_plan_id uuid,
  p_release_time text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_plan public.next_day_housekeeping_plans%rowtype;
  v_time time without time zone;
  v_scheduled timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if p_release_time not in ('06:00','06:30','07:00','07:30','08:00','08:30') then
    raise exception 'Release time must be between 06:00 and 08:30 in 30-minute steps';
  end if;
  v_time := p_release_time::time;

  select * into v_plan
  from public.next_day_housekeeping_plans
  where id = p_plan_id
  for update;

  if not found then
    raise exception 'Tomorrow housekeeping plan not found';
  end if;

  if not public.can_manage_next_day_housekeeping_plan(v_plan.organization_slug, v_plan.hotel_id) then
    raise exception 'You do not have permission to change this hotel plan';
  end if;

  if v_plan.status not in ('draft','approved') then
    raise exception 'Release time can only be changed before the plan starts releasing';
  end if;

  v_scheduled := (v_plan.plan_date::timestamp + v_time) at time zone v_plan.release_timezone;
  if v_scheduled <= now() then
    raise exception 'The selected release time has already passed';
  end if;

  perform set_config('hotelcare.explicit_release_time_update', '1', true);

  update public.next_day_housekeeping_plans
  set release_time = v_time
  where id = p_plan_id
  returning * into v_plan;

  return jsonb_build_object(
    'id', v_plan.id,
    'release_time', v_plan.release_time::text,
    'scheduled_release_at', v_plan.scheduled_release_at,
    'status', v_plan.status
  );
end;
$function$;

revoke all on function public.update_next_day_housekeeping_release_time(uuid, text) from public, anon;
grant execute on function public.update_next_day_housekeeping_release_time(uuid, text) to authenticated;
