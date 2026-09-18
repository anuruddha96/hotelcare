-- Gozsdu only: Previo sync replaces pms_metadata, sometimes dropping the manager's
-- hotelcareHousekeepingOverrides object. The previous cycle respected the manual
-- override only if it remained present. Keep today's explicit decision when the
-- new metadata omits it, but not for a new arrival, a different PMS room, or a
-- checkout. A fresh explicit override always replaces the previous decision.
CREATE OR REPLACE FUNCTION public.apply_gozsdu_housekeeping_cycle()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  current_night integer := 0;
  total_nights integer := 0;
  remaining_nights integer := 0;
  service_type text := 'none';
  policy_service_type text := 'none';
  metadata jsonb := coalesce(new.pms_metadata, '{}'::jsonb);
  scheduled_departure_today boolean := false;
  override jsonb;
  previous_override jsonb;
  override_service text;
  manual_override_applied boolean := false;
  work_date date := (now() AT TIME ZONE 'Europe/Budapest')::date;
BEGIN
  IF lower(trim(coalesce(new.hotel, ''))) NOT IN ('gozsdu-court', 'gozsdu court budapest') THEN
    RETURN new;
  END IF;

  IF tg_op = 'UPDATE'
     AND old.hotel IS NOT DISTINCT FROM new.hotel
     AND coalesce(metadata ->> 'arrivalToday', 'false') <> 'true'
     AND coalesce(metadata ->> 'scheduledDepartureToday', 'false') <> 'true'
     AND NOT coalesce(new.is_checkout_room, false)
     AND (old.pms_metadata ->> 'roomId') IS NOT DISTINCT FROM (metadata ->> 'roomId')
     AND NOT (coalesce(metadata -> 'hotelcareHousekeepingOverrides', '{}'::jsonb) ? work_date::text)
     AND coalesce(metadata ->> 'hotelcareClearHousekeepingOverrideDate', '') <> work_date::text
  THEN
    previous_override := old.pms_metadata #> array['hotelcareHousekeepingOverrides', work_date::text];
    IF jsonb_typeof(previous_override) = 'object'
       AND previous_override ->> 'bucket' = 'service'
       AND previous_override ->> 'service' IN ('towel_change', 'change_room', 'none') THEN
      -- jsonb_set on a nested path does not create the missing parent object.
      metadata := jsonb_set(
        metadata,
        '{hotelcareHousekeepingOverrides}',
        coalesce(metadata -> 'hotelcareHousekeepingOverrides', '{}'::jsonb)
          || jsonb_build_object(work_date::text, previous_override),
        true
      );
    END IF;
  END IF;

  IF coalesce(new.guest_nights_stayed, 0) > 0 THEN
    current_night := new.guest_nights_stayed;
  ELSIF coalesce(metadata ->> 'currentNight', '') ~ '^\d+$' THEN
    current_night := (metadata ->> 'currentNight')::integer;
  END IF;
  IF coalesce(metadata ->> 'totalNights', '') ~ '^\d+$' THEN
    total_nights := (metadata ->> 'totalNights')::integer;
  END IF;

  scheduled_departure_today := lower(coalesce(metadata ->> 'scheduledDepartureToday', 'false')) IN ('true', '1', 'yes');
  remaining_nights := greatest(total_nights - current_night, 0);
  IF coalesce(new.is_checkout_room, false) OR scheduled_departure_today THEN
    service_type := 'none';
  ELSIF current_night >= 2 AND mod(current_night, 2) = 0 THEN
    IF mod(current_night, 4) = 0 AND remaining_nights > 1 THEN
      service_type := 'change_room';
    ELSE
      service_type := 'towel_change';
    END IF;
  END IF;
  policy_service_type := service_type;

  IF NOT coalesce(new.is_checkout_room, false) AND NOT scheduled_departure_today THEN
    override := metadata #> array['hotelcareHousekeepingOverrides', work_date::text];
    override_service := override ->> 'service';
    IF override ->> 'bucket' = 'service'
       AND override_service IN ('towel_change', 'change_room', 'none') THEN
      service_type := override_service;
      manual_override_applied := true;
    END IF;
  END IF;

  new.towel_change_required := service_type = 'towel_change';
  new.linen_change_required := service_type = 'change_room';
  new.pms_metadata := jsonb_set(
    metadata, '{gozsduHousekeeping}',
    jsonb_build_object(
      'policyVersion', 1,
      'serviceType', service_type,
      'policyServiceType', policy_service_type,
      'serviceSource', CASE WHEN manual_override_applied THEN 'manual' ELSE 'cycle' END,
      'serviceDue', service_type <> 'none',
      'currentNight', current_night,
      'totalNights', total_nights,
      'remainingNightsAfterToday', remaining_nights,
      'propertyGate', 'gozsdu-court'
    ), true
  );
  RETURN new;
END;
$function$;

-- The existing instruction propagation trigger is UPDATE OF towel/linen/notes.
-- PMS refresh only names pms_metadata in SET; even when the BEFORE cycle changes
-- the flags, that column-specific trigger will not fire, leaving a stale
-- manager_instruction_text. Repair this exclusively for Gozsdu PMS updates.
DROP TRIGGER IF EXISTS trg_gozsdu_propagate_pms_service_instruction ON public.rooms;
CREATE TRIGGER trg_gozsdu_propagate_pms_service_instruction
AFTER UPDATE OF pms_metadata ON public.rooms
FOR EACH ROW
WHEN (
  NEW.hotel IN ('gozsdu-court', 'Gozsdu Court Budapest')
  AND (
    OLD.towel_change_required IS DISTINCT FROM NEW.towel_change_required
    OR OLD.linen_change_required IS DISTINCT FROM NEW.linen_change_required
  )
)
EXECUTE FUNCTION public.hc_propagate_room_instruction_to_assignment();