-- Make Engine V2 activity reflect the actual publishable queue, not synthetic
-- candidates that database safety deliberately dropped.

create or replace function public.normalize_engine_v2_activity_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_mode text;
  v_dates integer;
  v_up integer;
  v_down integer;
  v_held integer;
  v_cells integer;
  v_push uuid;
  v_accepted integer := 0;
  v_push_failed integer := 0;
begin
  if new.notification_type <> 'engine_v2_run' or new.automation_run_id is null then
    return new;
  end if;

  select r.status, r.mode, r.dates_evaluated, r.dates_increased,
         r.dates_decreased, r.dates_held, r.cells_queued, r.push_run_id
    into v_status, v_mode, v_dates, v_up, v_down, v_held, v_cells, v_push
    from public.revenue_automation_runs r
   where r.id = new.automation_run_id;

  if not found then
    return new;
  end if;

  if v_push is not null then
    select coalesce(p.accepted_count, 0), coalesce(p.failed_count, 0)
      into v_accepted, v_push_failed
      from public.revenue_rate_push_runs p
     where p.id = v_push;
  end if;

  new.push_run_id := coalesce(new.push_run_id, v_push);
  new.actions_count := coalesce(v_up, 0) + coalesce(v_down, 0);
  new.pushed_count := greatest(coalesce(new.pushed_count, 0), coalesce(v_accepted, 0));
  new.failed_count := greatest(coalesce(new.failed_count, 0), coalesce(v_push_failed, 0));

  if v_status = 'completed' then
    if coalesce(v_mode, 'shadow') = 'shadow' then
      new.summary := format(
        'Run completed: %s dates checked, %s increased, %s decreased, %s held. Shadow test only — no prices were sent to Previo.',
        coalesce(v_dates,0), coalesce(v_up,0), coalesce(v_down,0), coalesce(v_held,0)
      );
    elsif coalesce(v_cells, 0) = 0 then
      new.summary := format(
        'Run completed: %s dates checked, %s increased, %s decreased, %s held. No prices needed to be sent to Previo.',
        coalesce(v_dates,0), coalesce(v_up,0), coalesce(v_down,0), coalesce(v_held,0)
      );
    else
      new.summary := format(
        'Run completed: %s dates checked, %s increased, %s decreased, %s held. %s price cells queued safely for Previo.',
        coalesce(v_dates,0), coalesce(v_up,0), coalesce(v_down,0), coalesce(v_held,0), coalesce(v_cells,0)
      );
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_normalize_engine_v2_activity_notification
  on public.revenue_automation_notifications;
create trigger trg_normalize_engine_v2_activity_notification
before insert or update of summary, actions_count, pushed_count, failed_count, push_run_id
on public.revenue_automation_notifications
for each row
execute function public.normalize_engine_v2_activity_notification();
