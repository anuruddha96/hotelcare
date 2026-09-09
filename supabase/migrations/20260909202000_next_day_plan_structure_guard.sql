-- Final shared-plan invariants: every room must have exactly one primary cleaner,
-- no more than one helper, and a worker explicitly scheduled Off cannot be selected.

create or replace function public.validate_next_day_housekeeping_plan_staff()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan public.next_day_housekeeping_plans%rowtype;
begin
  if new.selected and not public.next_day_housekeeping_staff_matches_hotel(new.plan_id, new.user_id) then
    raise exception 'Selected worker is not an eligible housekeeper for this hotel';
  end if;

  if new.selected then
    select * into v_plan
    from public.next_day_housekeeping_plans
    where id = new.plan_id;

    if found and exists (
      select 1
      from public.staff_schedules schedule
      where schedule.organization_slug = v_plan.organization_slug
        and schedule.hotel_id = v_plan.hotel_id
        and schedule.user_id = new.user_id
        and schedule.work_date = v_plan.plan_date
        and schedule.status = 'off'
    ) then
      raise exception 'A worker scheduled Off cannot be selected for tomorrow housekeeping';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.validate_next_day_housekeeping_plan_staff() from public;

create or replace function public.validate_next_day_plan_structure_on_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bad_rooms integer := 0;
begin
  if new.status <> 'approved' or old.status = 'approved' then
    return new;
  end if;

  with room_roles as (
    select
      item.room_id,
      count(*) filter (
        where coalesce(
          nullif(item.recommendation_context ->> 'assignment_role',''),
          case when item.source = 'shared' then 'shared' else 'primary' end
        ) = 'primary'
      ) as primary_count,
      count(*) filter (
        where coalesce(
          nullif(item.recommendation_context ->> 'assignment_role',''),
          case when item.source = 'shared' then 'shared' else 'primary' end
        ) = 'shared'
      ) as shared_count
    from public.next_day_housekeeping_plan_items item
    where item.plan_id = new.id
    group by item.room_id
  )
  select count(*)::integer
  into v_bad_rooms
  from room_roles
  where primary_count <> 1 or shared_count > 1;

  if v_bad_rooms > 0 then
    raise exception 'Every housekeeping room requires exactly one primary cleaner and at most one shared helper';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_next_day_plan_structure_on_approval() from public;

drop trigger if exists zy_validate_next_day_plan_structure_on_approval
  on public.next_day_housekeeping_plans;
create trigger zy_validate_next_day_plan_structure_on_approval
before update of status on public.next_day_housekeeping_plans
for each row execute function public.validate_next_day_plan_structure_on_approval();