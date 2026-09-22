-- Issue #325: Ottofiori ONLY. Do not change other tenants, hotels, reservations
-- or existing housekeeping assignments. The existing trigger only ever set a
-- checkout TRUE when a departure snapshot existed; it never cleared FALSE when
-- a no-show disappeared and a different guest was due in the same room.
CREATE OR REPLACE FUNCTION public.hc_ottofiori_checkout_decision(
  p_departing boolean, p_stayover boolean, p_new_arrival boolean,
  p_snapshot_fresh boolean, p_no_show boolean, p_not_arrived boolean,
  p_occupied boolean, p_checked_out boolean,
  p_manual_daily boolean, p_manual_checkout boolean
) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $decision$
 SELECT CASE
   WHEN p_manual_daily IS TRUE THEN 'daily'
   WHEN p_manual_checkout IS TRUE THEN 'checkout'
   WHEN p_no_show IS TRUE AND p_checked_out IS NOT TRUE THEN 'daily'
   WHEN p_checked_out IS TRUE THEN 'checkout'
   WHEN p_snapshot_fresh IS TRUE AND p_departing IS TRUE
        AND p_not_arrived IS TRUE AND p_occupied IS NOT TRUE THEN 'daily'
   WHEN p_snapshot_fresh IS TRUE AND p_departing IS TRUE THEN 'checkout'
   WHEN p_snapshot_fresh IS TRUE AND p_stayover IS TRUE THEN 'daily'
   WHEN p_snapshot_fresh IS TRUE AND p_new_arrival IS TRUE THEN 'daily'
   WHEN p_not_arrived IS TRUE AND p_occupied IS NOT TRUE THEN 'daily'
   ELSE 'keep' -- absent or failed PMS response is not proof of a checkout
 END
$decision$;

CREATE OR REPLACE FUNCTION public.hc_ottofiori_reconcile_checkout_on_pms_refresh()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'public', 'pg_temp' AS $guard$
DECLARE
  work_date date := (now() AT TIME ZONE 'Europe/Budapest')::date;
  snapshot_at timestamptz;
  snapshot_count integer := 0;
  fresh boolean := false;
  departing boolean := false;
  stayover boolean := false;
  incoming boolean := false;
  next_arrival_date date;
  next_departure_date date;
  manual_day date;
  choice text;
BEGIN
  IF NEW.hotel IS DISTINCT FROM 'Hotel Ottofiori'
     OR NEW.room_number !~ '^[0-9]{3}$' OR NEW.pms_metadata IS NULL
     OR NEW.pms_metadata ->> 'pmsSyncDate' IS DISTINCT FROM work_date::text
     OR NEW.pms_metadata ->> 'lastPmsRefreshDate' IS DISTINCT FROM work_date::text
  THEN RETURN NEW; END IF;

  -- Only a manager move explicitly made TODAY can override the PMS outcome.
  IF coalesce(NEW.pms_metadata ->> 'manual_moved_at', '') ~
       '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN
    BEGIN
      manual_day := ((NEW.pms_metadata ->> 'manual_moved_at')::timestamptz
                     AT TIME ZONE 'Europe/Budapest')::date;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
      manual_day := NULL;
    END;
  END IF;

  SELECT max(s.captured_at) INTO snapshot_at
  FROM public.daily_overview_snapshots s
  WHERE s.hotel_id='ottofiori' AND s.source='previo'
    AND s.business_date=work_date
    AND s.captured_at BETWEEN now()-interval '2 hours' AND now()+interval '5 minutes';
  IF snapshot_at IS NOT NULL THEN
    SELECT count(*) INTO snapshot_count FROM public.daily_overview_snapshots s
    WHERE s.hotel_id='ottofiori' AND s.source='previo'
      AND s.business_date=work_date AND s.captured_at=snapshot_at;
    -- Do not react to an in-flight delete/insert or short partial XML payload.
    fresh := snapshot_count >= 15; -- Ottofiori physical inventory: 21
  END IF;

  IF fresh THEN
    SELECT coalesce(bool_or(s.status='departing' AND s.departure_date=work_date),false),
           coalesce(bool_or(s.status='ongoing' AND s.departure_date>work_date),false)
      INTO departing,stayover FROM public.daily_overview_snapshots s
    WHERE s.hotel_id='ottofiori' AND s.source='previo'
      AND s.business_date=work_date AND s.captured_at=snapshot_at
      AND s.room_number=NEW.room_number;

    -- Today's *different* arrival appears on the NEXT business-day snapshot,
    -- even if the no-show for the previous night disappeared from today's.
    SELECT s.arrival_date,s.departure_date
      INTO next_arrival_date,next_departure_date
    FROM public.daily_overview_snapshots s
    WHERE s.hotel_id='ottofiori' AND s.source='previo'
      AND s.business_date=work_date+1 AND s.room_number=NEW.room_number
      AND s.arrival_date=work_date AND s.departure_date>work_date
      AND s.captured_at BETWEEN snapshot_at-interval '2 minutes'
                            AND snapshot_at+interval '2 minutes'
    ORDER BY s.captured_at DESC LIMIT 1;
    incoming := next_arrival_date IS NOT NULL;
  END IF;

  choice := public.hc_ottofiori_checkout_decision(
    departing,stayover,incoming,fresh,
    NEW.pms_metadata->>'isNoShow'='true' OR NEW.pms_metadata->>'manual_no_show'='true',
    NEW.pms_metadata->>'notArrived'='true',
    NEW.pms_metadata->>'occupiedToday'='true',
    NEW.pms_metadata->>'checkedOutToday'='true',
    manual_day=work_date AND NEW.pms_metadata->>'manual_daily'='true',
    manual_day=work_date AND NEW.pms_metadata->>'manual_checkout'='true');

  IF choice='daily' THEN
    NEW.is_checkout_room := false;
    NEW.pms_metadata := (NEW.pms_metadata
      - 'dailyOverviewDepartureDate' - 'dailyOverviewDepartureSource')
      || jsonb_build_object('scheduledDepartureToday',false);
    IF incoming AND NOT departing AND NEW.pms_metadata->>'checkedOutToday' IS DISTINCT FROM 'true' THEN
      -- Room's latest reservation is the incoming guest, NOT the old no-show.
      NEW.pms_metadata := NEW.pms_metadata || jsonb_build_object(
        'arrivalDate',next_arrival_date::text,'departureDate',next_departure_date::text,
        'arrivalToday',true,
        'notArrived',NEW.pms_metadata->>'occupiedToday' IS DISTINCT FROM 'true',
        'scheduledDepartureTomorrow',false,'stayThroughToday',true);
      IF NEW.pms_metadata->>'manual_no_show' IS DISTINCT FROM 'true' THEN
        NEW.pms_metadata := NEW.pms_metadata || jsonb_build_object('isNoShow',false);
      END IF;
    END IF;
  ELSIF choice='checkout' THEN
    NEW.is_checkout_room := true;
    NEW.pms_metadata := NEW.pms_metadata || jsonb_build_object(
      'scheduledDepartureToday',true,'scheduledDepartureTomorrow',false,
      'stayThroughToday',false);
  END IF;
  RETURN NEW;
END;
$guard$;

-- Trigger names determine BEFORE-trigger order in PostgreSQL. This must run
-- after the generic manager-override trigger or stale checkout flags return.
DO $rename$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.rooms'::regclass
       AND tgname='zz_ottofiori_reconcile_checkout_on_pms_refresh')
     AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.rooms'::regclass
       AND tgname='zzzzzzzzzz_hc_ottofiori_checkout_reconciliation') THEN
    ALTER TRIGGER zz_ottofiori_reconcile_checkout_on_pms_refresh ON public.rooms
      RENAME TO zzzzzzzzzz_hc_ottofiori_checkout_reconciliation;
  END IF;
END;
$rename$;
