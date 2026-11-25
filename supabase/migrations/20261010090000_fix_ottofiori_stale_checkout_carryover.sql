-- Prevent Oct 9 checkout flags from overriding today's Previo occupancy
-- at Ottofiori. Preserve same-Budapest-day checkout evidence, explicit manager
-- room-type overrides, and actual scheduled departures. Other hotels untouched.
CREATE OR REPLACE FUNCTION public.hc_ottofiori_reconcile_checkout_on_pms_refresh()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  checkout_day date;
  confirmed_checkout_today boolean := false;
  stale_checkout_marker boolean := false;
BEGIN
  IF NEW.hotel IS DISTINCT FROM 'Hotel Ottofiori'
     OR NEW.room_number !~ '^[0-9]{3}$' OR NEW.pms_metadata IS NULL
     OR NEW.pms_metadata ->> 'pmsSyncDate' IS DISTINCT FROM work_date::text
     OR NEW.pms_metadata ->> 'lastPmsRefreshDate' IS DISTINCT FROM work_date::text
  THEN RETURN NEW; END IF;

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
    fresh := snapshot_count >= 15;
  END IF;

  IF fresh THEN
    SELECT coalesce(bool_or(s.status='departing' AND s.departure_date=work_date),false),
           coalesce(bool_or(s.status='ongoing' AND s.departure_date>work_date),false)
      INTO departing,stayover FROM public.daily_overview_snapshots s
    WHERE s.hotel_id='ottofiori' AND s.source='previo'
      AND s.business_date=work_date AND s.captured_at=snapshot_at
      AND s.room_number=NEW.room_number;

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

  -- A checkout boolean from the previous day is not proof of today's departure.
  -- Interpret the physical checkout instant using the Budapest business date.
  IF coalesce(NEW.pms_metadata->>'checkedOutAt','') ~
     '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' THEN
    BEGIN
      checkout_day := ((NEW.pms_metadata->>'checkedOutAt')::timestamptz
                       AT TIME ZONE 'Europe/Budapest')::date;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
      checkout_day := NULL;
    END;
  END IF;
  confirmed_checkout_today := coalesce(checkout_day=work_date,false)
      OR (NEW.pms_metadata->>'checkedOutToday'='true'
          AND NEW.pms_metadata->>'readyToCleanDate'=work_date::text);
  stale_checkout_marker := NEW.pms_metadata->>'checkedOutToday'='true'
      AND NOT confirmed_checkout_today;

  choice := public.hc_ottofiori_checkout_decision(
    departing,stayover,incoming,fresh,
    NEW.pms_metadata->>'isNoShow'='true' OR NEW.pms_metadata->>'manual_no_show'='true',
    NEW.pms_metadata->>'notArrived'='true',
    NEW.pms_metadata->>'occupiedToday'='true',
    confirmed_checkout_today,
    manual_day=work_date AND NEW.pms_metadata->>'manual_daily'='true',
    manual_day=work_date AND NEW.pms_metadata->>'manual_checkout'='true');

  IF choice='daily' THEN
    NEW.is_checkout_room := false;
    IF stale_checkout_marker THEN
      NEW.checkout_time := NULL;
      NEW.pms_metadata := NEW.pms_metadata
        - 'checkedOutToday' - 'checkedOutAt' - 'readyToClean' - 'readyToCleanDate';
    END IF;
    NEW.pms_metadata := (NEW.pms_metadata
      - 'dailyOverviewDepartureDate' - 'dailyOverviewDepartureSource')
      || jsonb_build_object('scheduledDepartureToday',false);
    IF incoming AND NOT departing AND NEW.pms_metadata->>'checkedOutToday' IS DISTINCT FROM 'true' THEN
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
    -- Still due to depart today, but yesterday's checkout is not current RTC.
    IF stale_checkout_marker THEN
      NEW.checkout_time := NULL;
      NEW.pms_metadata := NEW.pms_metadata
        - 'checkedOutToday' - 'checkedOutAt' - 'readyToClean' - 'readyToCleanDate';
    END IF;
    NEW.pms_metadata := NEW.pms_metadata || jsonb_build_object(
      'scheduledDepartureToday',true,'scheduledDepartureTomorrow',false,
      'stayThroughToday',false);
  END IF;
  RETURN NEW;
END;
$function$;
