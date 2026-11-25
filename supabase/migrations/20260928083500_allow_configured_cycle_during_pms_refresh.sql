-- The legacy PMS fabrication guard intentionally preserved old T / Change Room
-- flags for standard hotels. Configured properties now have an authoritative
-- service-cycle trigger, so allow those calculated flags through while keeping
-- the old protection for properties without a configured cycle.

CREATE OR REPLACE FUNCTION public.hc_guard_pms_service_fabrication()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  old_meta jsonb := coalesce(OLD.pms_metadata, '{}'::jsonb);
  new_meta jsonb := coalesce(NEW.pms_metadata, '{}'::jsonb);
  business_day text := (now() AT TIME ZONE 'Europe/Budapest')::date::text;
  is_snapshot boolean := false;
  is_gozsdu boolean := false;
  has_configured_cycle boolean := false;
BEGIN
  is_snapshot := new_meta ->> 'pmsSyncDate' = business_day
    AND new_meta ->> 'lastPmsRefreshDate' = business_day
    AND coalesce(new_meta ->> 'totalNights', '') ~ '^[0-9]{1,4}$'
    AND coalesce(new_meta ->> 'currentNight', '') ~ '^[0-9]{1,4}$'
    AND (
      old_meta -> 'pmsSyncDate' IS DISTINCT FROM new_meta -> 'pmsSyncDate'
      OR old_meta -> 'currentNight' IS DISTINCT FROM new_meta -> 'currentNight'
      OR old_meta -> 'totalNights' IS DISTINCT FROM new_meta -> 'totalNights'
      OR old_meta -> 'scheduledDepartureToday' IS DISTINCT FROM new_meta -> 'scheduledDepartureToday'
      OR old_meta -> 'scheduledDepartureTomorrow' IS DISTINCT FROM new_meta -> 'scheduledDepartureTomorrow'
      OR old_meta -> 'occupiedToday' IS DISTINCT FROM new_meta -> 'occupiedToday'
      OR old_meta -> 'stayThroughToday' IS DISTINCT FROM new_meta -> 'stayThroughToday'
      OR old_meta -> 'reservationStatusId' IS DISTINCT FROM new_meta -> 'reservationStatusId'
      OR old_meta -> 'noteOta' IS DISTINCT FROM new_meta -> 'noteOta'
    );
  IF is_snapshot IS NOT TRUE THEN RETURN NEW; END IF;

  NEW.last_towel_change := OLD.last_towel_change;
  NEW.last_linen_change := OLD.last_linen_change;

  is_gozsdu := lower(btrim(coalesce(NEW.hotel, ''))) IN
    ('gozsdu-court', 'gozsdu court budapest');

  IF NOT is_gozsdu THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.hotel_configurations h
      WHERE h.is_active = true
        AND (h.hotel_id = NEW.hotel OR h.hotel_name = NEW.hotel)
        AND h.settings ? 'housekeeping_service_cycle'
        AND COALESCE((h.settings -> 'housekeeping_service_cycle' ->> 'enabled')::boolean, true) = true
    ) INTO has_configured_cycle;

    IF NOT has_configured_cycle THEN
      NEW.towel_change_required := OLD.towel_change_required;
      NEW.linen_change_required := OLD.linen_change_required;
    END IF;

    -- Cancellation / no-show still clears service regardless of configuration.
    IF new_meta ->> 'isNoShow' = 'true'
       OR new_meta ->> 'isCancelled' = 'true'
       OR (new_meta ->> 'arrivalToday' = 'true'
         AND new_meta ->> 'notArrived' = 'true')
    THEN
      NEW.towel_change_required := false;
      NEW.linen_change_required := false;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
