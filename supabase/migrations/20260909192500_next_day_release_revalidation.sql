-- Revalidate approved next-day housekeeping plans immediately before release.
-- The original direct DB cron is replaced with a protected Edge worker that
-- refreshes Previo, records a room-by-room validation result, and only then
-- invokes the transactional release function.

alter table public.next_day_housekeeping_plans
  add column if not exists release_revalidation_status text not null default 'pending',
  add column if not exists release_revalidation_attempted_at timestamptz,
  add column if not exists release_revalidated_at timestamptz,
  add column if not exists release_revalidation_attempt_count integer not null default 0,
  add column if not exists release_revalidation_result jsonb not null default '{}'::jsonb;

alter table public.next_day_housekeeping_plans
  drop constraint if exists next_day_housekeeping_plans_release_revalidation_status_check;
alter table public.next_day_housekeeping_plans
  add constraint next_day_housekeeping_plans_release_revalidation_status_check
  check (release_revalidation_status in ('pending','running','passed','failed'));

create index if not exists next_day_housekeeping_plans_revalidation_due_idx
  on public.next_day_housekeeping_plans (scheduled_release_at, release_revalidation_attempted_at)
  where status = 'approved' and auto_release = true;

-- Any material manager-side re-approval invalidates a previous morning
-- revalidation. The next server release must refresh PMS again.
create or replace function public.reset_next_day_release_revalidation_on_plan_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'approved' and (
    old.status is distinct from new.status
    or old.pms_synced_at is distinct from new.pms_synced_at
    or old.approved_at is distinct from new.approved_at
    or old.auto_release is distinct from new.auto_release
  ) then
    new.release_revalidation_status := 'pending';
    new.release_revalidation_attempted_at := null;
    new.release_revalidated_at := null;
    new.release_revalidation_attempt_count := 0;
    new.release_revalidation_result := '{}'::jsonb;
  end if;
  return new;
end;
$$;

drop trigger if exists reset_next_day_release_revalidation_on_plan_change_trigger
  on public.next_day_housekeeping_plans;
create trigger reset_next_day_release_revalidation_on_plan_change_trigger
before update of status, pms_synced_at, approved_at, auto_release
on public.next_day_housekeeping_plans
for each row execute function public.reset_next_day_release_revalidation_on_plan_change();

-- Atomically claim due plans for the server worker. A crashed worker can be
-- reclaimed after 10 minutes. Retry for up to eight hours after the intended
-- release time so a temporary Previo outage does not permanently strand work.
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

revoke all on function public.claim_due_next_day_housekeeping_release_plans(integer) from public;
revoke all on function public.claim_due_next_day_housekeeping_release_plans(integer) from anon;
revoke all on function public.claim_due_next_day_housekeeping_release_plans(integer) from authenticated;
grant execute on function public.claim_due_next_day_housekeeping_release_plans(integer) to service_role;

-- Release is now allowed only after a fresh server-side PMS validation. The
-- validation result stores the eligible room ids and any assignment-type
-- changes caused by overnight extensions/departures. This preserves the
-- manager's chosen housekeeper while publishing the current cleaning type.
create or replace function public.release_next_day_housekeeping_plan(p_plan_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan public.next_day_housekeeping_plans%rowtype;
  v_planned_count integer := 0;
  v_validated_room_count integer := 0;
  v_inserted_count integer := 0;
  v_conflict_room_count integer := 0;
  v_pms_skipped_room_count integer := 0;
  v_type_change_count integer := 0;
  v_result jsonb;
begin
  select * into v_plan
  from public.next_day_housekeeping_plans
  where id = p_plan_id
  for update;

  if not found then
    raise exception 'Next-day housekeeping plan not found';
  end if;

  if auth.uid() is not null
     and not public.can_manage_next_day_housekeeping_plan(v_plan.organization_slug, v_plan.hotel_id) then
    raise exception 'Not authorized to release this next-day housekeeping plan';
  end if;

  if v_plan.status = 'released' then
    return coalesce(v_plan.release_result, '{}'::jsonb) || jsonb_build_object('already_released', true);
  end if;

  if v_plan.status <> 'approved' then
    raise exception 'Only approved next-day housekeeping plans can be released (current status: %)', v_plan.status;
  end if;

  if v_plan.release_revalidation_status <> 'passed'
     or v_plan.release_revalidated_at is null
     or v_plan.release_revalidated_at < now() - interval '30 minutes' then
    raise exception 'A fresh server-side PMS revalidation is required before release';
  end if;

  if jsonb_typeof(v_plan.release_revalidation_result -> 'eligible_room_ids') <> 'array' then
    raise exception 'PMS revalidation result is missing eligible_room_ids';
  end if;

  update public.next_day_housekeeping_plans
  set status = 'releasing', release_attempted_at = now(), last_error = null
  where id = p_plan_id;

  select count(*) into v_planned_count
  from public.next_day_housekeeping_plan_items
  where plan_id = p_plan_id;

  select count(*) into v_validated_room_count
  from jsonb_array_elements_text(v_plan.release_revalidation_result -> 'eligible_room_ids');

  v_pms_skipped_room_count := greatest(0, v_planned_count - v_validated_room_count);
  v_type_change_count := coalesce(
    jsonb_array_length(v_plan.release_revalidation_result -> 'type_changes'),
    0
  );

  select count(distinct i.room_id) into v_conflict_room_count
  from public.next_day_housekeeping_plan_items i
  where i.plan_id = p_plan_id
    and i.room_id in (
      select value::uuid
      from jsonb_array_elements_text(v_plan.release_revalidation_result -> 'eligible_room_ids') value
    )
    and exists (
      select 1 from public.room_assignments ra
      where ra.room_id = i.room_id
        and ra.assignment_date = v_plan.plan_date
        and ra.status <> 'cancelled'::public.assignment_status
    );

  with validated_rooms as materialized (
    select value::uuid as room_id
    from jsonb_array_elements_text(v_plan.release_revalidation_result -> 'eligible_room_ids') value
  ), eligible_rooms as materialized (
    select distinct i.room_id
    from public.next_day_housekeeping_plan_items i
    join validated_rooms vr on vr.room_id = i.room_id
    where i.plan_id = p_plan_id
      and not exists (
        select 1 from public.room_assignments ra
        where ra.room_id = i.room_id
          and ra.assignment_date = v_plan.plan_date
          and ra.status <> 'cancelled'::public.assignment_status
      )
  ), inserted as (
    insert into public.room_assignments (
      room_id,
      assigned_to,
      assigned_by,
      assignment_date,
      assignment_type,
      status,
      priority,
      estimated_duration,
      notes,
      organization_slug
    )
    select
      i.room_id,
      i.assigned_to,
      coalesce(v_plan.approved_by, v_plan.created_by),
      v_plan.plan_date,
      coalesce(
        nullif(v_plan.release_revalidation_result -> 'assignment_type_overrides' ->> i.room_id::text, '')::public.assignment_type,
        i.assignment_type
      ),
      'assigned'::public.assignment_status,
      i.priority,
      i.estimated_duration,
      i.notes,
      v_plan.organization_slug
    from public.next_day_housekeeping_plan_items i
    join eligible_rooms er on er.room_id = i.room_id
    where i.plan_id = p_plan_id
    returning id
  )
  select count(*) into v_inserted_count from inserted;

  v_result := jsonb_build_object(
    'plan_id', p_plan_id,
    'plan_date', v_plan.plan_date,
    'planned_assignments', v_planned_count,
    'pms_validated_rooms', v_validated_room_count,
    'pms_skipped_rooms', v_pms_skipped_room_count,
    'overnight_type_changes', v_type_change_count,
    'released_assignments', v_inserted_count,
    'skipped_rooms_with_live_changes', v_conflict_room_count,
    'release_revalidation', v_plan.release_revalidation_result,
    'released_at', now()
  );

  update public.next_day_housekeeping_plans
  set status = 'released',
      released_at = now(),
      release_result = v_result,
      last_error = null
  where id = p_plan_id;

  return v_result;
exception when others then
  raise;
end;
$$;

-- Browser/user calls cannot bypass the morning revalidation worker anymore.
revoke execute on function public.release_next_day_housekeeping_plan(uuid) from authenticated;
grant execute on function public.release_next_day_housekeeping_plan(uuid) to service_role;

-- The old direct DB scheduler would now fail the fresh-PMS requirement anyway,
-- but unschedule it explicitly so there is only one release path.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from cron.job where jobname = 'hotelcare-release-next-day-housekeeping') then
    perform cron.unschedule('hotelcare-release-next-day-housekeeping');
  end if;
end
$$;

-- Random worker secret generated inside Vault; never committed in source.
do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'housekeeping_release_worker_secret') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'housekeeping_release_worker_secret',
      'HotelCare next-day housekeeping release worker cron secret',
      null
    );
  end if;
end
$$;

create or replace function public.get_housekeeping_release_worker_secret()
returns text
language sql
security definer
set search_path = public, vault
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = 'housekeeping_release_worker_secret'
  limit 1;
$$;

revoke all on function public.get_housekeeping_release_worker_secret() from public;
revoke all on function public.get_housekeeping_release_worker_secret() from anon;
revoke all on function public.get_housekeeping_release_worker_secret() from authenticated;
grant execute on function public.get_housekeeping_release_worker_secret() to service_role;

-- Protected Edge worker performs the Previo refresh/reconciliation, then calls
-- the guarded release RPC. Every five minutes gives prompt retries on outages.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from pg_extension where extname = 'pg_net') then
    if exists (select 1 from cron.job where jobname = 'hotelcare-next-day-housekeeping-release-worker') then
      perform cron.unschedule('hotelcare-next-day-housekeeping-release-worker');
    end if;
    perform cron.schedule(
      'hotelcare-next-day-housekeeping-release-worker',
      '*/5 * * * *',
      $cron$
        select net.http_post(
          url := 'https://pcmszqqklkolvvlabohq.supabase.co/functions/v1/housekeeping-next-day-release-worker',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-worker-secret', public.get_housekeeping_release_worker_secret()
          ),
          body := jsonb_build_object('trigger', 'cron', 'scheduled_at', now())
        ) as request_id;
      $cron$
    );
  end if;
end
$$;