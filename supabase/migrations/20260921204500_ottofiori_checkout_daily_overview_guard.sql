-- Hotel Ottofiori: the Previo room roster can expose an incoming arrival for a
-- room whose previous guest is departing on the same business date. The roster
-- alone must not turn that room from Checkout into Daily. Reconcile only this
-- property's authenticated, date-scoped Previo daily-overview departure data.
-- This intentionally DOES NOT mark the guest physically checked out, release
-- Ready to Clean, change cleaning status, or modify assignments.
CREATE OR REPLACE FUNCTION public.hc_ottofiori_reconcile_checkout_on_pms_refresh()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  work_date date := (now() AT TIME ZONE 'Europe/Budapest')::date;
  most_recent_snapshot timestamptz;
  has_departure boolean := false;
BEGIN
  -- Do not change the shared PMS behavior or any other hotel/tenant.
  IF NEW.hotel IS DISTINCT FROM 'Hotel Ottofiori'
     OR NEW.room_number !~ '^[0-9]{3}$'
     OR NEW.pms_metadata IS NULL
     OR NEW.pms_metadata ->> 'pmsSyncDate' IS DISTINCT FROM work_date::text
     OR NEW.pms_metadata ->> 'lastPmsRefreshDate' IS DISTINCT FROM work_date::text
  THEN
    RETURN NEW;
  END IF;

  -- A manager's same-day decisions remain authoritative. The existing
  -- new-business-day reset removes these manual flags before fresh PMS sync.
  IF NEW.pms_metadata ->> 'manual_daily' = 'true'
     OR NEW.pms_metadata ->> 'manual_checkout' = 'false'
     OR NEW.pms_metadata ->> 'manual_no_show' = 'true'
  THEN
    RETURN NEW;
  END IF;

  -- Check the most recent *whole-hotel* snapshot, not an old row for the room
  -- that might have been cancelled or extended in a later snapshot. Date,
  -- hotel and source are explicit; never inherit 21 September into the 22nd.
  SELECT max(s.captured_at)
    INTO most_recent_snapshot
  FROM public.daily_overview_snapshots AS s
  WHERE s.hotel_id = 'ottofiori'
    AND s.source = 'previo'
    AND s.business_date = work_date
    AND s.captured_at BETWEEN now() - interval '30 hours' AND now() + interval '5 minutes';

  IF most_recent_snapshot IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.daily_overview_snapshots AS s
    WHERE s.hotel_id = 'ottofiori'
      AND s.source = 'previo'
      AND s.business_date = work_date
      AND s.captured_at = most_recent_snapshot
      AND s.room_number = NEW.room_number
      AND s.departure_date = work_date
  ) INTO has_departure;

  IF has_departure THEN
    NEW.is_checkout_room := true;
    NEW.pms_metadata := NEW.pms_metadata || jsonb_build_object(
      'scheduledDepartureToday', true,
      'scheduledDepartureTomorrow', false,
      'stayThroughToday', false,
      'dailyOverviewDepartureDate', work_date::text,
      'dailyOverviewDepartureSource', 'previo'
    );
    -- Do NOT set checkedOutToday, checkedOutAt, checkout_time or readyToClean:
    -- these require a separate confirmed physical checkout event.
  ELSE
    -- Do not retain reconciliation markers from an outdated overview when
    -- the latest source no longer identifies a departure for this room.
    NEW.pms_metadata := NEW.pms_metadata
      - 'dailyOverviewDepartureDate' - 'dailyOverviewDepartureSource';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS zz_ottofiori_reconcile_checkout_on_pms_refresh ON public.rooms;
CREATE TRIGGER zz_ottofiori_reconcile_checkout_on_pms_refresh
BEFORE UPDATE OF is_checkout_room, pms_metadata ON public.rooms
FOR EACH ROW
EXECUTE FUNCTION public.hc_ottofiori_reconcile_checkout_on_pms_refresh();
