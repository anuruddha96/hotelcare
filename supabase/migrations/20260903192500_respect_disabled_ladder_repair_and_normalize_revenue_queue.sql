-- Revenue queue hardening after the Ottofiori statement-timeout incident.
--
-- 1) If proactive ladder repair is disabled for a hotel, drop those synthetic
--    repair drafts before they enter the large revenue_rate_drafts table.
-- 2) Skip orphaned automation push-items when a draft was intentionally dropped.
-- 3) Store the number of actually publishable cells on Revenue Engine runs.
-- 4) Close queue shells that no longer contain anything publishable.

create or replace function public.block_automatic_ladder_repair_drafts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proactive_enabled boolean := false;
begin
  if coalesce(new.intent_source, '') <> 'ladder_repair' then
    return new;
  end if;

  select coalesce(bool_or(r.proactive_ladder_repair_enabled is true), false)
    into v_proactive_enabled
    from public.revenue_pickup_automation_rules r
   where r.hotel_id = new.hotel_id
     and r.is_enabled is true;

  -- V2 historically built a full-horizon ladder sweep even when the property
  -- had proactive ladder repair switched off. Do not persist that no-op work.
  if v_proactive_enabled is not true then
    return null;
  end if;

  -- Preserve the existing production safety behaviour for opt-in properties:
  -- proactive repair remains blocked from publishing until explicitly approved.
  new.status := 'superseded';
  new.confirmation_status := 'superseded';
  new.superseded_at := coalesce(new.superseded_at, now());
  new.reconcile_state := null;
  new.reconcile_next_at := null;
  new.push_error := 'Automatic ladder repair blocked: occupancy-ladder cleanup must not create demand-blind price increases.';
  return new;
end;
$$;

create or replace function public.skip_orphaned_automation_push_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.draft_id is not null then
    return new;
  end if;

  if exists (
    select 1
      from public.revenue_rate_push_runs r
     where r.id = new.run_id
       and r.source = 'automation'
  ) then
    return null;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_skip_orphaned_automation_push_item
  on public.revenue_rate_push_items;
create trigger trg_skip_orphaned_automation_push_item
before insert on public.revenue_rate_push_items
for each row
execute function public.skip_orphaned_automation_push_item();

create or replace function public.normalize_revenue_automation_cells_queued()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actual integer;
begin
  if new.push_run_id is null then
    return new;
  end if;

  if new.status in ('completed', 'timed_out', 'failed') then
    select count(*)::integer
      into v_actual
      from public.revenue_rate_drafts d
     where d.push_run_id = new.push_run_id
       and d.superseded_at is null
       and d.status not in ('superseded', 'cancelled');
    new.cells_queued := coalesce(v_actual, 0);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_normalize_revenue_automation_cells_queued
  on public.revenue_automation_runs;
create trigger trg_normalize_revenue_automation_cells_queued
before insert or update of status, push_run_id, cells_queued
on public.revenue_automation_runs
for each row
execute function public.normalize_revenue_automation_cells_queued();

create or replace function public.close_empty_revenue_push_runs()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  with closed as (
    update public.revenue_rate_push_runs r
       set status = 'completed',
           requested_count = (
             select count(*)::integer
               from public.revenue_rate_drafts d
              where d.push_run_id = r.id
                and d.superseded_at is null
                and d.status not in ('superseded', 'cancelled')
           ),
           finished_at = coalesce(r.finished_at, now()),
           updated_at = now()
     where r.status in ('queued', 'processing')
       and not exists (
         select 1
           from public.revenue_rate_drafts d
          where d.push_run_id = r.id
            and d.superseded_at is null
            and d.status in ('draft', 'failed', 'sending')
       )
       and not exists (
         select 1
           from public.revenue_rate_drafts d
          where d.push_run_id = r.id
            and d.status = 'pushed'
            and coalesce(d.confirmation_status, '') <> 'confirmed'
       )
    returning 1
  )
  select count(*) into v_count from closed;
  return v_count;
end;
$$;

revoke all on function public.close_empty_revenue_push_runs() from public;
grant execute on function public.close_empty_revenue_push_runs() to service_role;

-- Idempotently keep the lightweight queue-shell cleanup scheduled.
do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id
    from cron.job
   where jobname = 'revenue-empty-push-run-cleanup'
   limit 1;

  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;

  perform cron.schedule(
    'revenue-empty-push-run-cleanup',
    '* * * * *',
    'select public.close_empty_revenue_push_runs();'
  );
end;
$$;
