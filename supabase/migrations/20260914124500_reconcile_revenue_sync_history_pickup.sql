-- The Previo edge function can observe transient PMS object rows before the
-- booking-night integrity trigger removes them. pickup_snapshots is already
-- reconciled to the authoritative rooms_sold delta; make sync history use the
-- same truth so diagnostics and API summaries cannot keep reporting phantom
-- +100 style pickup after the durable data was corrected.
--
-- This is metadata reconciliation only. It does not write prices, inventory,
-- restrictions, availability, automation settings, or PMS data.

create or replace function public.reconcile_revenue_sync_history_pickup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_previous_sync timestamptz;
  v_window_start timestamptz;
  v_gained integer := 0;
  v_lost integer := 0;
  v_net integer := 0;
  v_raw_gained integer := 0;
  v_raw_lost integer := 0;
  v_raw_net integer := 0;
  v_from date;
  v_to date;
  v_booking_nights integer;
begin
  if new.sync_type is distinct from 'revenue_sync'
     or new.hotel_id is null
     or new.hotel_id = 'slnt-group'
     or new.data is null then
    return new;
  end if;

  select max(h.created_at)
    into v_previous_sync
  from public.pms_sync_history h
  where h.hotel_id = new.hotel_id
    and h.sync_type = 'revenue_sync'
    and h.id is distinct from new.id
    and h.created_at < new.created_at;

  -- On an established property this is exactly the previous revenue-sync
  -- boundary. The small fallback is only for the first history row.
  v_window_start := coalesce(v_previous_sync, new.created_at - interval '15 minutes');

  select
    coalesce(sum(p.bookings_current), 0)::integer,
    coalesce(sum(p.bookings_last_year), 0)::integer,
    coalesce(sum(p.delta), 0)::integer
  into v_gained, v_lost, v_net
  from public.pickup_snapshots p
  where p.hotel_id = new.hotel_id
    and p.source = 'previo_sync_diff'
    and p.captured_at > v_window_start
    and p.captured_at <= new.created_at;

  -- Preserve what the edge function originally believed for forensic audit,
  -- but expose the integrity-reconciled values as the normal summary fields.
  v_raw_gained := coalesce(
    nullif(new.data->>'rawPickupGained', '')::integer,
    nullif(new.data->>'pickupGained', '')::integer,
    0
  );
  v_raw_lost := coalesce(
    nullif(new.data->>'rawPickupLost', '')::integer,
    nullif(new.data->>'pickupLost', '')::integer,
    0
  );
  v_raw_net := coalesce(
    nullif(new.data->>'rawPickupNet', '')::integer,
    nullif(new.data->>'pickupNet', '')::integer,
    0
  );

  new.data := new.data || jsonb_build_object(
    'rawPickupGained', v_raw_gained,
    'rawPickupLost', v_raw_lost,
    'rawPickupNet', v_raw_net,
    'pickupGained', v_gained,
    'pickupLost', v_lost,
    'pickupNet', v_net,
    'pickupReconciled', true,
    'pickupReconciledSource', 'integrity_checked_inventory_delta'
  );

  -- Keep bookingNights consistent with the rows that survived revenue
  -- integrity filtering as well. If the date payload is malformed, leave the
  -- existing diagnostic field untouched rather than guessing.
  begin
    v_from := nullif(new.data->>'from', '')::date;
    v_to := coalesce(
      nullif(new.data->>'farTo', '')::date,
      nullif(new.data->>'to', '')::date
    );
  exception when others then
    v_from := null;
    v_to := null;
  end;

  if v_from is not null and v_to is not null and v_to >= v_from then
    select count(*)::integer
      into v_booking_nights
    from public.revenue_booking_nights b
    where b.hotel_id = new.hotel_id
      and b.stay_date between v_from and v_to;

    new.data := new.data || jsonb_build_object(
      'bookingNights', coalesce(v_booking_nights, 0),
      'bookingNightsReconciled', true
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_reconcile_revenue_sync_history_pickup on public.pms_sync_history;
create trigger trg_reconcile_revenue_sync_history_pickup
before insert or update of data, sync_status, error_message on public.pms_sync_history
for each row execute function public.reconcile_revenue_sync_history_pickup();

-- Repair the recent diagnostic trail so current investigations no longer show
-- phantom pickup. The trigger above preserves each row's original raw values.
update public.pms_sync_history
set data = data
where sync_type = 'revenue_sync'
  and hotel_id <> 'slnt-group'
  and created_at >= now() - interval '72 hours';
