-- Prevent reservation-ingestion artifacts from becoming pickup events.
--
-- The revenue sync writes its integrity-corrected revenue_daily_snapshots row
-- before pickup_snapshots. For Previo movement rows, derive the movement from
-- the actual stored rooms_sold state rather than trusting an in-memory diff of
-- raw PMS objects. This is intentionally read/reconciliation logic only: it
-- never changes rates, restrictions, room availability, or automation rules.

create or replace function public.reconcile_previo_pickup_snapshot_to_inventory()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_sold integer;
  v_previous_sold integer;
  v_current_at timestamptz;
  v_delta integer;
begin
  if new.source <> 'previo_sync_diff' then
    return new;
  end if;

  select s.rooms_sold, s.captured_at
    into v_current_sold, v_current_at
  from public.revenue_daily_snapshots s
  where s.hotel_id = new.hotel_id
    and s.stay_date = new.stay_date
    and s.captured_at = new.captured_at
  order by s.captured_at desc
  limit 1;

  -- If the integrity-corrected snapshot was skipped as redundant, inventory
  -- did not change and there is no pickup event to publish.
  if not found then
    new.bookings_current := 0;
    new.bookings_last_year := 0;
    new.delta := 0;
    return new;
  end if;

  select s.rooms_sold
    into v_previous_sold
  from public.revenue_daily_snapshots s
  where s.hotel_id = new.hotel_id
    and s.stay_date = new.stay_date
    and s.captured_at < v_current_at
  order by s.captured_at desc
  limit 1;

  -- A first capture establishes the baseline; it is not new pickup.
  if not found then
    new.bookings_current := 0;
    new.bookings_last_year := 0;
    new.delta := 0;
    return new;
  end if;

  v_delta := coalesce(v_current_sold, 0) - coalesce(v_previous_sold, 0);
  new.bookings_current := greatest(v_delta, 0);
  new.bookings_last_year := greatest(-v_delta, 0);
  new.delta := v_delta;
  return new;
end;
$$;

drop trigger if exists tr_pickup_snapshot_reconcile_inventory on public.pickup_snapshots;
create trigger tr_pickup_snapshot_reconcile_inventory
before insert on public.pickup_snapshots
for each row execute function public.reconcile_previo_pickup_snapshot_to_inventory();

create or replace function public.skip_zero_previo_pickup_snapshot()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- previo_sync_diff rows are movement events. Zero carries no event and does
  -- not belong in the movement feed once it has been reconciled above.
  if new.source = 'previo_sync_diff' and coalesce(new.delta, 0) = 0 then
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_skip_zero_previo_pickup_snapshot on public.pickup_snapshots;
create trigger trg_skip_zero_previo_pickup_snapshot
before insert on public.pickup_snapshots
for each row execute function public.skip_zero_previo_pickup_snapshot();
