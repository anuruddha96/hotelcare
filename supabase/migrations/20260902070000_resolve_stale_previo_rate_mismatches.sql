-- Prevent stale historical rate requests from painting current Rate & Pickup
-- cells red after a newer price has already been confirmed in Previo.
--
-- Root cause: revenue reconciliation can revisit an old `pushed/different`
-- draft. If a newer draft for the same cell is already confirmed, the old
-- request is no longer an active problem and must be treated as superseded.

create or replace function public.guard_stale_revenue_rate_mismatch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_newer_confirmed uuid;
begin
  if new.confirmation_status <> 'different' then
    return new;
  end if;

  select n.id
    into v_newer_confirmed
  from public.revenue_rate_drafts n
  where n.hotel_id = new.hotel_id
    and n.stay_date = new.stay_date
    and n.room_type_name = new.room_type_name
    and n.occupancy = new.occupancy
    and n.id <> new.id
    and n.created_at > new.created_at
    and n.status = 'pushed'
    and n.confirmation_status = 'confirmed'
    and n.superseded_at is null
  order by n.created_at desc
  limit 1;

  if v_newer_confirmed is not null then
    new.confirmation_status := 'superseded';
    new.superseded_at := coalesce(new.superseded_at, now());
    new.superseded_by := v_newer_confirmed;
    new.push_error := null;
    new.reconcile_state := null;
    new.reconcile_next_at := null;
    new.reconcile_error := null;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_stale_revenue_rate_mismatch on public.revenue_rate_drafts;
create trigger trg_guard_stale_revenue_rate_mismatch
before insert or update on public.revenue_rate_drafts
for each row
execute function public.guard_stale_revenue_rate_mismatch();

-- When a newer price is confirmed, immediately close any older mismatch for
-- the same hotel/date/room/occupancy. This makes the red state self-healing
-- without waiting for another full Revenue sync.
create or replace function public.resolve_older_rate_mismatches_after_confirmation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.confirmation_status <> 'confirmed'
     or (tg_op = 'UPDATE' and old.confirmation_status is not distinct from new.confirmation_status) then
    return new;
  end if;

  update public.revenue_rate_drafts d
  set confirmation_status = 'superseded',
      superseded_at = coalesce(d.superseded_at, now()),
      superseded_by = new.id,
      push_error = null,
      reconcile_state = null,
      reconcile_next_at = null,
      reconcile_error = null,
      last_checked_at = coalesce(d.last_checked_at, now())
  where d.hotel_id = new.hotel_id
    and d.stay_date = new.stay_date
    and d.room_type_name = new.room_type_name
    and d.occupancy = new.occupancy
    and d.id <> new.id
    and d.created_at < new.created_at
    and d.confirmation_status = 'different'
    and d.superseded_at is null;

  -- Keep the audit record for history, but mark it resolved so UI origin
  -- helpers no longer show it as an active red warning.
  update public.rate_change_audit a
  set payload = coalesce(a.payload, '{}'::jsonb) || jsonb_build_object(
        'resolved_at', now(),
        'resolution_reason', 'superseded_by_newer_confirmed_price',
        'superseded_by_draft_id', new.id::text
      )
  where a.hotel_id = new.hotel_id
    and a.stay_date = new.stay_date
    and a.source = 'previo_different'
    and a.payload->>'room_type_name' = new.room_type_name
    and coalesce(a.payload->>'occupancy', '') ~ '^[0-9]+$'
    and (a.payload->>'occupancy')::integer = new.occupancy
    and not (coalesce(a.payload, '{}'::jsonb) ? 'resolved_at')
    and exists (
      select 1
      from public.revenue_rate_drafts d
      where d.hotel_id = new.hotel_id
        and d.stay_date = new.stay_date
        and d.room_type_name = new.room_type_name
        and d.occupancy = new.occupancy
        and d.created_at < new.created_at
        and d.confirmation_status = 'superseded'
        and d.superseded_by = new.id
        and d.push_run_id::text = a.payload->>'push_run_id'
    );

  return new;
end;
$$;

drop trigger if exists trg_resolve_older_rate_mismatches_after_confirmation on public.revenue_rate_drafts;
create trigger trg_resolve_older_rate_mismatches_after_confirmation
after insert or update on public.revenue_rate_drafts
for each row
execute function public.resolve_older_rate_mismatches_after_confirmation();

-- A mismatch audit may be inserted just after the draft trigger above has
-- already identified it as stale. Mark such an audit row resolved before it is
-- stored, so it can never flash red for even one refresh.
create or replace function public.resolve_stale_previo_mismatch_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_superseding uuid;
begin
  if new.source <> 'previo_different' or new.payload is null then
    return new;
  end if;

  select d.superseded_by
    into v_superseding
  from public.revenue_rate_drafts d
  where d.hotel_id = new.hotel_id
    and d.stay_date = new.stay_date
    and d.room_type_name = new.payload->>'room_type_name'
    and coalesce(new.payload->>'occupancy', '') ~ '^[0-9]+$'
    and d.occupancy = (new.payload->>'occupancy')::integer
    and d.push_run_id::text = new.payload->>'push_run_id'
    and d.confirmation_status = 'superseded'
    and d.superseded_by is not null
  order by d.created_at desc
  limit 1;

  if v_superseding is not null then
    new.payload := coalesce(new.payload, '{}'::jsonb) || jsonb_build_object(
      'resolved_at', now(),
      'resolution_reason', 'superseded_by_newer_confirmed_price',
      'superseded_by_draft_id', v_superseding::text
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_resolve_stale_previo_mismatch_audit on public.rate_change_audit;
create trigger trg_resolve_stale_previo_mismatch_audit
before insert on public.rate_change_audit
for each row
execute function public.resolve_stale_previo_mismatch_audit();

-- One-time cleanup for false red cells already present before this invariant
-- existed. Only close a mismatch when a strictly newer, successfully confirmed
-- draft exists for the exact same cell.
with stale as (
  select d.id as stale_id,
         newer.id as newer_id
  from public.revenue_rate_drafts d
  join lateral (
    select n.id, n.created_at
    from public.revenue_rate_drafts n
    where n.hotel_id = d.hotel_id
      and n.stay_date = d.stay_date
      and n.room_type_name = d.room_type_name
      and n.occupancy = d.occupancy
      and n.id <> d.id
      and n.created_at > d.created_at
      and n.status = 'pushed'
      and n.confirmation_status = 'confirmed'
      and n.superseded_at is null
    order by n.created_at desc
    limit 1
  ) newer on true
  where d.status = 'pushed'
    and d.confirmation_status = 'different'
    and d.superseded_at is null
), resolved as (
  update public.revenue_rate_drafts d
  set confirmation_status = 'superseded',
      superseded_at = now(),
      superseded_by = stale.newer_id,
      push_error = null,
      reconcile_state = null,
      reconcile_next_at = null,
      reconcile_error = null,
      last_checked_at = now()
  from stale
  where d.id = stale.stale_id
  returning d.hotel_id, d.stay_date, d.room_type_name, d.occupancy,
            d.push_run_id, d.superseded_by
)
update public.rate_change_audit a
set payload = coalesce(a.payload, '{}'::jsonb) || jsonb_build_object(
      'resolved_at', now(),
      'resolution_reason', 'superseded_by_newer_confirmed_price',
      'superseded_by_draft_id', resolved.superseded_by::text
    )
from resolved
where a.hotel_id = resolved.hotel_id
  and a.stay_date = resolved.stay_date
  and a.source = 'previo_different'
  and a.payload->>'room_type_name' = resolved.room_type_name
  and coalesce(a.payload->>'occupancy', '') ~ '^[0-9]+$'
  and (a.payload->>'occupancy')::integer = resolved.occupancy
  and a.payload->>'push_run_id' = resolved.push_run_id::text
  and not (coalesce(a.payload, '{}'::jsonb) ? 'resolved_at');
