-- Planned housekeeping must never be materialized from a stale HotelCare room
-- state. Standard Previo properties get a server-side room-state preflight a
-- few minutes before release; the existing release worker still performs its
-- independent exact-date reservation revalidation afterwards.

alter table public.next_day_housekeeping_plans
  add column if not exists pre_release_pms_sync_status text not null default 'pending',
  add column if not exists pre_release_pms_sync_attempted_at timestamptz,
  add column if not exists pre_release_pms_synced_at timestamptz,
  add column if not exists pre_release_pms_sync_attempt_count integer not null default 0,
  add column if not exists pre_release_pms_sync_result jsonb not null default '{}'::jsonb;

do $$
begin
  alter table public.next_day_housekeeping_plans
    add constraint next_day_housekeeping_pre_release_pms_sync_status_check
    check (pre_release_pms_sync_status in ('pending','running','passed','failed'));
exception
  when duplicate_object then null;
end $$;

create or replace function public.claim_due_next_day_housekeeping_pms_preflight_plans(
  p_limit integer default 10
)
returns setof public.next_day_housekeeping_plans
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with picked as (
    select p.id
    from public.next_day_housekeeping_plans p
    where p.status = 'approved'
      and p.auto_release = true
      and p.scheduled_release_at is not null
      -- Preflight normally runs ~2 minutes before the configured half-hour
      -- release. The historical window lets a delayed plan recover safely.
      and p.scheduled_release_at <= now() + interval '4 minutes'
      and p.scheduled_release_at > now() - interval '8 hours'
      and p.pre_release_pms_sync_attempt_count < 60
      and exists (
        select 1
        from public.pms_configurations pc
        where pc.hotel_id = p.hotel_id
          and pc.pms_type = 'previo'
          and pc.is_active = true
          and coalesce(pc.sync_enabled, true) = true
      )
      and (
        p.pre_release_pms_sync_status in ('pending','failed')
        or (
          p.pre_release_pms_sync_status = 'running'
          and p.pre_release_pms_sync_attempted_at < now() - interval '10 minutes'
        )
        or (
          p.pre_release_pms_sync_status = 'passed'
          and (
            p.pre_release_pms_synced_at is null
            or p.pre_release_pms_synced_at < now() - interval '10 minutes'
          )
        )
      )
    order by p.scheduled_release_at, p.created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 10), 50))
  ), claimed as (
    update public.next_day_housekeeping_plans p
    set pre_release_pms_sync_status = 'running',
        pre_release_pms_sync_attempted_at = now(),
        pre_release_pms_sync_attempt_count = p.pre_release_pms_sync_attempt_count + 1
    from picked
    where p.id = picked.id
    returning p.*
  )
  select * from claimed;
end;
$$;

-- Preserve the existing release claim logic, but standard Previo hotels are
-- now fail-closed until the full room-state preflight succeeded recently.
create or replace function public.claim_due_next_day_housekeeping_release_plans(
  p_limit integer default 10
)
returns setof public.next_day_housekeeping_plans
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with picked as (
    select p.id
    from public.next_day_housekeeping_plans p
    where p.status = 'approved'
      and p.auto_release = true
      and p.scheduled_release_at <= now()
      and p.scheduled_release_at > now() - interval '8 hours'
      and p.release_revalidation_attempt_count < 60
      and (
        -- Portfolio properties without a standard pms_configurations row keep
        -- their existing direct-account live revalidation path.
        not exists (
          select 1
          from public.pms_configurations pc
          where pc.hotel_id = p.hotel_id
            and pc.pms_type = 'previo'
            and pc.is_active = true
            and coalesce(pc.sync_enabled, true) = true
        )
        or (
          p.pre_release_pms_sync_status = 'passed'
          and p.pre_release_pms_synced_at >= now() - interval '10 minutes'
        )
      )
      and (
        p.release_revalidation_status in ('pending','failed')
        or (
          p.release_revalidation_status = 'running'
          and p.release_revalidation_attempted_at < now() - interval '10 minutes'
        )
      )
    order by p.scheduled_release_at, p.created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 10), 50))
  ), claimed as (
    update public.next_day_housekeeping_plans p
    set release_revalidation_status = 'running',
        release_revalidation_attempted_at = now(),
        release_revalidation_attempt_count = p.release_revalidation_attempt_count + 1,
        last_error = null
    from picked
    where p.id = picked.id
    returning p.*
  )
  select * from claimed;
end;
$$;

revoke all on function public.claim_due_next_day_housekeeping_pms_preflight_plans(integer)
  from public, anon, authenticated;
grant execute on function public.claim_due_next_day_housekeeping_pms_preflight_plans(integer)
  to service_role;

revoke all on function public.claim_due_next_day_housekeeping_release_plans(integer)
  from public, anon, authenticated;
grant execute on function public.claim_due_next_day_housekeeping_release_plans(integer)
  to service_role;

-- Avoid duplicate schedules when a migration is replayed in a branch/reset.
do $$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid
  from cron.job
  where jobname = 'hotelcare-housekeeping-pms-preflight';
  if v_jobid is not null then perform cron.unschedule(v_jobid); end if;

  select jobid into v_jobid
  from cron.job
  where jobname = 'hotelcare-housekeeping-pms-morning-warmup';
  if v_jobid is not null then perform cron.unschedule(v_jobid); end if;
end $$;

-- :03/:08/.../:58 means the full room-state sync finishes shortly before the
-- existing :00/:05/... release worker has a chance to claim a due plan.
select cron.schedule(
  'hotelcare-housekeeping-pms-preflight',
  '3-58/5 * * * *',
  $cron$
    select net.http_post(
      url := 'https://pcmszqqklkolvvlabohq.supabase.co/functions/v1/housekeeping-pms-preflight-worker',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-worker-secret', public.get_housekeeping_release_worker_secret()
      ),
      body := jsonb_build_object('mode', 'preflight', 'scheduled_at', now()),
      timeout_milliseconds := 30000
    ) as request_id;
  $cron$
);

-- Run only in UTC hours that can contain 06:00-08:59 Europe/Budapest across
-- DST. The worker itself checks Budapest local time and syncs one hotel per
-- five-minute slot, beginning at 06:00.
select cron.schedule(
  'hotelcare-housekeeping-pms-morning-warmup',
  '*/5 4-7 * * *',
  $cron$
    select net.http_post(
      url := 'https://pcmszqqklkolvvlabohq.supabase.co/functions/v1/housekeeping-pms-preflight-worker',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-worker-secret', public.get_housekeeping_release_worker_secret()
      ),
      body := jsonb_build_object('mode', 'warmup', 'scheduled_at', now()),
      timeout_milliseconds := 30000
    ) as request_id;
  $cron$
);
