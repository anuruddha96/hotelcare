-- Gozsdu stayover cycle is the default. A manager's dated service selection
-- must take precedence over that default on the same Budapest business date.
-- This prevents e.g. ST-109 being shown as a linen change after a towel-only
-- selection and after subsequent PMS refreshes. No other hotels are modified.
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
  override_service text;
  manual_override_applied boolean := false;
  work_date date := (now() AT TIME ZONE 'Europe/Budapest')::date;
BEGIN
  IF lower(trim(coalesce(new.hotel, ''))) NOT IN ('gozsdu-court', 'gozsdu court budapest') THEN
    RETURN new;
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

  -- Dated, explicit service decisions override the automatic stayover cycle.
  -- Ignore expired/future overrides and never override actual departures.
  IF NOT coalesce(new.is_checkout_room, false) AND NOT scheduled_departure_today THEN
    override := jsonb_extract_path(metadata, 'hotelcareHousekeepingOverrides', work_date::text);
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
    metadata,
    '{gozsduHousekeeping}',
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
    ),
    true
  );
  RETURN new;
END;
$function$;
