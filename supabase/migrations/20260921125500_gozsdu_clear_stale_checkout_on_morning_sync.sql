-- Gozsdu's server morning sync copies pms_metadata from the previous workday.
-- Its authoritative stay-through classification must not retain yesterday's
-- checkout / ready-to-clean signals, while genuine same-day checkouts and
-- manager overrides remain untouched. Scoped to Gozsdu and the server sync.
CREATE OR REPLACE FUNCTION public.hc_gozsdu_clear_stale_morning_checkout()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  work_date date := (now() AT TIME ZONE 'Europe/Budapest')::date;
  meta jsonb := coalesce(NEW.pms_metadata, '{}'::jsonb);
  old_checkout_stamp text := meta ->> 'checkedOutAt';
  old_ready_date text := meta ->> 'readyToCleanDate';
  old_checkout_day date;
BEGIN
  IF NEW.hotel NOT IN ('gozsdu-court', 'Gozsdu Court Budapest')
     OR meta ->> 'lastServerMorningSyncSource' IS DISTINCT FROM 'portfolio_morning_10min'
     OR meta ->> 'lastServerMorningSyncAt' IS NOT DISTINCT FROM OLD.pms_metadata ->> 'lastServerMorningSyncAt'
     OR meta ->> 'pmsSyncDate' IS DISTINCT FROM work_date::text
     OR NEW.is_checkout_room IS DISTINCT FROM false
     OR meta ->> 'stayThroughToday' IS DISTINCT FROM 'true'
     OR meta ->> 'scheduledDepartureToday' IS DISTINCT FROM 'false'
     OR coalesce(meta ->> 'departureDate', '') <= work_date::text
     OR meta ->> 'manual_checkout' = 'true'
  THEN
    RETURN NEW;
  END IF;

  -- A checkout timestamp is an instant; compare its BUDAPEST date, not UTC.
  IF old_checkout_stamp IS NOT NULL THEN
    BEGIN
      old_checkout_day := (old_checkout_stamp::timestamptz AT TIME ZONE 'Europe/Budapest')::date;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
      old_checkout_day := NULL;
    END;
  END IF;
  IF old_checkout_day IS NOT NULL AND old_checkout_day < work_date THEN
    meta := meta - 'checkedOutAt' - 'departureTime';
    meta := jsonb_set(meta, '{checkedOutToday}', 'false'::jsonb, true);
  END IF;
  IF old_ready_date ~ '^\d{4}-\d{2}-\d{2}$' AND old_ready_date < work_date::text THEN
    meta := meta - 'readyToClean' - 'readyToCleanDate' - 'manualReadyToCleanAt';
  END IF;
  IF NEW.checkout_time IS NOT NULL
     AND (NEW.checkout_time AT TIME ZONE 'Europe/Budapest')::date < work_date THEN
    NEW.checkout_time := NULL;
  END IF;
  NEW.pms_metadata := meta;
  RETURN NEW;
END;
$function$;

-- Alphabetically after the existing final manual-room-type guard.
DROP TRIGGER IF EXISTS zzzzzzzzz_hc_gozsdu_clear_stale_morning_checkout ON public.rooms;
CREATE TRIGGER zzzzzzzzz_hc_gozsdu_clear_stale_morning_checkout
BEFORE UPDATE OF is_checkout_room, pms_metadata ON public.rooms
FOR EACH ROW EXECUTE FUNCTION public.hc_gozsdu_clear_stale_morning_checkout();