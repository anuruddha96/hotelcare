-- Property-level housekeeping service-cycle configuration.
-- Keeps manager overrides for the current business date, but prevents stale
-- towel/change-room flags from leaking into a new stay after a PMS refresh.

CREATE OR REPLACE FUNCTION public.hc_apply_configured_housekeeping_service_cycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_policy jsonb;
  v_manual jsonb;
  v_business_date date := (statement_timestamp() AT TIME ZONE 'Europe/Budapest')::date;
  v_night integer := COALESCE(NEW.guest_nights_stayed, 0);
  v_towel_first integer;
  v_towel_repeat integer;
  v_change_first integer;
  v_change_repeat integer;
  v_final_towel_only boolean;
  v_towel boolean := false;
  v_change boolean := false;
  v_departure date;
BEGIN
  SELECT h.settings -> 'housekeeping_service_cycle'
    INTO v_policy
  FROM public.hotel_configurations h
  WHERE h.is_active = true
    AND (h.hotel_id = NEW.hotel OR h.hotel_name = NEW.hotel)
  LIMIT 1;

  IF v_policy IS NULL OR COALESCE((v_policy ->> 'enabled')::boolean, true) = false THEN
    RETURN NEW;
  END IF;

  -- A manager's explicit T / Change Room choice for today wins over automation.
  v_manual := COALESCE(NEW.pms_metadata, '{}'::jsonb) -> 'hotelcareManualServiceOverride';
  IF v_manual IS NOT NULL AND v_manual ->> 'businessDate' = v_business_date::text THEN
    RETURN NEW;
  END IF;

  IF NEW.is_checkout_room = true THEN
    NEW.towel_change_required := false;
    NEW.linen_change_required := false;
    RETURN NEW;
  END IF;

  v_towel_first := GREATEST(1, LEAST(90, COALESCE((v_policy ->> 'towel_first_night')::integer, 3)));
  v_towel_repeat := GREATEST(1, LEAST(90, COALESCE((v_policy ->> 'towel_repeat_nights')::integer, 4)));
  v_change_first := GREATEST(1, LEAST(90, COALESCE((v_policy ->> 'change_first_night')::integer, 5)));
  v_change_repeat := GREATEST(1, LEAST(90, COALESCE((v_policy ->> 'change_repeat_nights')::integer, 5)));
  v_final_towel_only := COALESCE((v_policy ->> 'final_night_towel_only')::boolean, true);

  IF v_night >= v_towel_first THEN
    v_towel := ((v_night - v_towel_first) % v_towel_repeat) = 0;
  END IF;
  IF v_night >= v_change_first THEN
    v_change := ((v_night - v_change_first) % v_change_repeat) = 0;
  END IF;

  -- Change Room / full clean includes towels, so do not show both badges.
  IF v_change THEN v_towel := false; END IF;

  BEGIN
    v_departure := NULLIF(NEW.pms_metadata ->> 'departureDate', '')::date;
  EXCEPTION WHEN others THEN
    v_departure := NULL;
  END;
  IF v_change AND v_final_towel_only AND v_departure = v_business_date + 1 THEN
    v_change := false;
    v_towel := true;
  END IF;

  NEW.towel_change_required := v_towel;
  NEW.linen_change_required := v_change;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS hc_apply_configured_housekeeping_service_cycle ON public.rooms;
CREATE TRIGGER hc_apply_configured_housekeeping_service_cycle
BEFORE UPDATE OF guest_nights_stayed, is_checkout_room, pms_metadata ON public.rooms
FOR EACH ROW
EXECUTE FUNCTION public.hc_apply_configured_housekeeping_service_cycle();

CREATE OR REPLACE FUNCTION public.hc_save_housekeeping_service_cycle(
  p_hotel_id text,
  p_towel_first_night integer,
  p_towel_repeat_nights integer,
  p_change_first_night integer,
  p_change_repeat_nights integer,
  p_final_night_towel_only boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_org text;
  v_name text;
  v_old jsonb;
  v_new jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;

  SELECT o.slug, h.hotel_name, h.settings -> 'housekeeping_service_cycle'
    INTO v_org, v_name, v_old
  FROM public.hotel_configurations h
  JOIN public.organizations o ON o.id = h.organization_id
  WHERE h.hotel_id = p_hotel_id AND h.is_active = true
  LIMIT 1;

  IF v_org IS NULL OR NOT public.can_manage_next_day_housekeeping_plan(v_org, p_hotel_id) THEN
    RAISE EXCEPTION 'Not authorised for this hotel';
  END IF;

  IF p_towel_first_night NOT BETWEEN 1 AND 90
     OR p_towel_repeat_nights NOT BETWEEN 1 AND 90
     OR p_change_first_night NOT BETWEEN 1 AND 90
     OR p_change_repeat_nights NOT BETWEEN 1 AND 90
     OR p_final_night_towel_only IS NULL THEN
    RAISE EXCEPTION 'Enter positive service nights from 1 to 90';
  END IF;

  v_new := jsonb_build_object(
    'enabled', true,
    'towel_first_night', p_towel_first_night,
    'towel_repeat_nights', p_towel_repeat_nights,
    'change_first_night', p_change_first_night,
    'change_repeat_nights', p_change_repeat_nights,
    'final_night_towel_only', p_final_night_towel_only
  );

  UPDATE public.hotel_configurations
  SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{housekeeping_service_cycle}', v_new, true),
      updated_at = now()
  WHERE hotel_id = p_hotel_id AND is_active = true;

  INSERT INTO public.pms_change_events(hotel_id, event_type, source, before, after, category)
  VALUES (p_hotel_id, 'housekeeping_service_policy_changed', 'manager', v_old, v_new, 'housekeeping');

  -- Re-evaluate live rooms immediately. Today's explicit manual override is
  -- protected by the trigger above; otherwise stale service flags are cleared.
  UPDATE public.rooms
  SET pms_metadata = COALESCE(pms_metadata, '{}'::jsonb)
  WHERE organization_slug = v_org
    AND (hotel = p_hotel_id OR hotel = v_name);

  RETURN v_new;
END;
$function$;

REVOKE ALL ON FUNCTION public.hc_save_housekeeping_service_cycle(text, integer, integer, integer, integer, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hc_save_housekeeping_service_cycle(text, integer, integer, integer, integer, boolean) TO authenticated;

-- Ottofiori: first towel service is stay night 3 (not stay night 2).
UPDATE public.hotel_configurations
SET settings = jsonb_set(
      COALESCE(settings, '{}'::jsonb),
      '{housekeeping_service_cycle}',
      COALESCE(settings -> 'housekeeping_service_cycle', '{}'::jsonb)
        || jsonb_build_object(
          'enabled', true,
          'towel_first_night', 3,
          'towel_repeat_nights', COALESCE((settings -> 'housekeeping_service_cycle' ->> 'towel_repeat_nights')::integer, 4),
          'change_first_night', COALESCE((settings -> 'housekeeping_service_cycle' ->> 'change_first_night')::integer, 5),
          'change_repeat_nights', COALESCE((settings -> 'housekeeping_service_cycle' ->> 'change_repeat_nights')::integer, 5),
          'final_night_towel_only', COALESCE((settings -> 'housekeeping_service_cycle' ->> 'final_night_towel_only')::boolean, true)
        ),
      true
    ),
    updated_at = now()
WHERE hotel_id = 'ottofiori' AND is_active = true;

-- Recalculate Ottofiori now so a stay on night 2 cannot retain an old T badge.
UPDATE public.rooms r
SET pms_metadata = COALESCE(r.pms_metadata, '{}'::jsonb)
FROM public.hotel_configurations h
JOIN public.organizations o ON o.id = h.organization_id
WHERE h.hotel_id = 'ottofiori'
  AND h.is_active = true
  AND r.organization_slug = o.slug
  AND (r.hotel = h.hotel_id OR r.hotel = h.hotel_name);
