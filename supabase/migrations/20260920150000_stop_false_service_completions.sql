-- A PMS schedule is not evidence that towels/linen were changed. The old
-- completion trigger reintroduced generic 3/5-night flags and stamped service
-- dates whenever *any* assignment was completed (including No Service/DND).
-- Disable it. Service completion must be recorded by an explicit, audited
-- service-confirmation action, not guessed from ordinary room cleaning.
DROP TRIGGER IF EXISTS check_towel_linen_on_completion ON public.room_assignments;

-- pmsRefresh currently includes last_towel_change/last_linen_change in its
-- room UPDATE whenever a service falls on its legacy hard-coded schedule.
-- Protect the persisted room from those fictitious completions. The guard
-- runs AFTER the existing property-specific and manual-instruction triggers;
-- Gozsdu's separate, deliberately configured 2/4-night service engine stays
-- responsible for its own towel/change-room flags.
CREATE OR REPLACE FUNCTION public.hc_guard_pms_service_fabrication()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $function$
DECLARE
  old_meta jsonb := coalesce(OLD.pms_metadata, '{}'::jsonb);
  new_meta jsonb := coalesce(NEW.pms_metadata, '{}'::jsonb);
  business_day text := (now() AT TIME ZONE 'Europe/Budapest')::date::text;
  is_snapshot boolean := false;
  is_gozsdu boolean := false;
BEGIN
  -- Only a fresh, authoritative PMS-shaped update is eligible. Pure manager
  -- changes to flags/dates and arbitrary metadata edits are not intercepted.
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

  -- Never turn "due today" into "performed today". In particular, the
  -- review trigger downstream must see the previous completion information,
  -- not a service date manufactured by this same sync transaction.
  NEW.last_towel_change := OLD.last_towel_change;
  NEW.last_linen_change := OLD.last_linen_change;

  is_gozsdu := lower(btrim(coalesce(NEW.hotel, ''))) IN
    ('gozsdu-court', 'gozsdu court budapest');
  IF NOT is_gozsdu THEN
    -- The shared frontend's 3/5 cycle is NOT a hotel-specific instruction.
    -- Retain existing manual/pending requirements instead of inventing new
    -- ones or clearing a manager's pending request with another PMS refresh.
    NEW.towel_change_required := OLD.towel_change_required;
    NEW.linen_change_required := OLD.linen_change_required;
    -- Do not carry the previous occupant's requests into a new arrival.
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

DROP TRIGGER IF EXISTS zzzzzzz_hc_guard_pms_service_fabrication ON public.rooms;
CREATE TRIGGER zzzzzzz_hc_guard_pms_service_fabrication
BEFORE UPDATE OF pms_metadata, guest_nights_stayed, towel_change_required,
  linen_change_required, last_towel_change, last_linen_change
ON public.rooms FOR EACH ROW
EXECUTE FUNCTION public.hc_guard_pms_service_fabrication();
