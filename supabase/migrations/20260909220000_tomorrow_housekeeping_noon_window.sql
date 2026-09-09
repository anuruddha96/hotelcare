-- Tomorrow housekeeping planning is an afternoon workflow.
-- Signed-in users may create or modify tomorrow's plan only from 12:00
-- Europe/Budapest time. Service-role/background release work remains unaffected,
-- so an approved plan can still be revalidated and released at 08:00.

create or replace function public.enforce_tomorrow_housekeeping_noon_window()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_budapest_now timestamp without time zone := timezone('Europe/Budapest', now());
  v_plan_date date;
  v_plan_id uuid;
begin
  -- Background/service operations must remain able to release and maintain plans
  -- in the morning. The restriction is for interactive authenticated planning.
  if coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role'
     or auth.uid() is null then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_table_name = 'next_day_housekeeping_plans' then
    if tg_op = 'DELETE' then
      v_plan_date := old.plan_date;
    else
      v_plan_date := new.plan_date;
    end if;
  else
    if tg_op = 'DELETE' then
      v_plan_id := old.plan_id;
    else
      v_plan_id := new.plan_id;
    end if;

    select p.plan_date
      into v_plan_date
    from public.next_day_housekeeping_plans p
    where p.id = v_plan_id;
  end if;

  if v_plan_date = v_budapest_now::date + 1
     and v_budapest_now::time < time '12:00:00' then
    raise exception 'Tomorrow housekeeping planning is available from 12:00 Europe/Budapest time.'
      using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_tomorrow_housekeeping_noon_window() from public, anon, authenticated;

drop trigger if exists trg_next_day_housekeeping_plan_noon_window
  on public.next_day_housekeeping_plans;
create trigger trg_next_day_housekeeping_plan_noon_window
before insert or update or delete on public.next_day_housekeeping_plans
for each row execute function public.enforce_tomorrow_housekeeping_noon_window();

drop trigger if exists trg_next_day_housekeeping_plan_staff_noon_window
  on public.next_day_housekeeping_plan_staff;
create trigger trg_next_day_housekeeping_plan_staff_noon_window
before insert or update or delete on public.next_day_housekeeping_plan_staff
for each row execute function public.enforce_tomorrow_housekeeping_noon_window();

drop trigger if exists trg_next_day_housekeeping_plan_items_noon_window
  on public.next_day_housekeeping_plan_items;
create trigger trg_next_day_housekeeping_plan_items_noon_window
before insert or update or delete on public.next_day_housekeeping_plan_items
for each row execute function public.enforce_tomorrow_housekeeping_noon_window();
