-- Hotel Memories only. Persist the manager-editable policy in this property's
-- configuration; neither housekeeping completion nor Previo sync proves that
-- towels or bed linen were physically changed.
UPDATE public.hotel_configurations
SET settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{memories_service_cycle}',
    '{"enabled":true,"towel_first_night":3,"towel_repeat_nights":4,"change_first_night":5,"change_repeat_nights":5,"final_night_towel_only":true}'::jsonb, true),
    updated_at = now()
WHERE hotel_id = 'memories-budapest'
  AND NOT (coalesce(settings, '{}'::jsonb) ? 'memories_service_cycle');

-- Only a manager authorised for this property can update its service cadence.
-- RLS on hotel_configurations intentionally gives direct UPDATE only to admins;
-- do not expand that permission to support this small feature.
CREATE OR REPLACE FUNCTION public.hc_save_memories_service_cycle(
  p_towel_first_night integer, p_towel_repeat_nights integer,
  p_change_first_night integer, p_change_repeat_nights integer,
  p_final_night_towel_only boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE
  v_org text;
  v_old jsonb;
  v_new jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  SELECT o.slug, h.settings -> 'memories_service_cycle'
  INTO v_org, v_old
  FROM public.hotel_configurations h
  JOIN public.organizations o ON o.id = h.organization_id
  WHERE h.hotel_id = 'memories-budapest' AND h.is_active = true;
  IF v_org IS NULL OR NOT public.can_manage_next_day_housekeeping_plan(v_org, 'memories-budapest') THEN
    RAISE EXCEPTION 'Not authorised for Hotel Memories Budapest';
  END IF;
  IF p_towel_first_night NOT BETWEEN 1 AND 90
     OR p_towel_repeat_nights NOT BETWEEN 1 AND 90
     OR p_change_first_night NOT BETWEEN 1 AND 90
     OR p_change_repeat_nights NOT BETWEEN 1 AND 90
     OR p_final_night_towel_only IS NULL THEN
    RAISE EXCEPTION 'Enter positive service nights from 1 to 90';
  END IF;
  v_new := jsonb_build_object('enabled', true,
    'towel_first_night', p_towel_first_night,
    'towel_repeat_nights', p_towel_repeat_nights,
    'change_first_night', p_change_first_night,
    'change_repeat_nights', p_change_repeat_nights,
    'final_night_towel_only', p_final_night_towel_only);
  UPDATE public.hotel_configurations
  SET settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{memories_service_cycle}', v_new, true),
      updated_at = now()
  WHERE hotel_id = 'memories-budapest';
  INSERT INTO public.pms_change_events(hotel_id, event_type, source, before, after, category)
  VALUES ('memories-budapest', 'housekeeping_service_policy_changed', 'manager',
    v_old, v_new, 'housekeeping');
  RETURN v_new;
END;
$fn$;
REVOKE ALL ON FUNCTION public.hc_save_memories_service_cycle(integer,integer,integer,integer,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hc_save_memories_service_cycle(integer,integer,integer,integer,boolean) TO authenticated;

-- This runs AFTER the legacy fabricated-service guard and after checkout/manual
-- classification triggers. It does not touch assignments, actual completion
-- dates, status, historical snapshots, or other hotels' policies.
CREATE OR REPLACE FUNCTION public.hc_apply_memories_service_cycle()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE
  v_meta jsonb := coalesce(NEW.pms_metadata, '{}'::jsonb);
  v_old_meta jsonb := coalesce(OLD.pms_metadata, '{}'::jsonb);
  v_today text := (now() AT TIME ZONE 'Europe/Budapest')::date::text;
  v_policy jsonb;
  v_org text;
  v_night integer;
  v_total integer;
  v_towel boolean := false;
  v_change boolean := false;
  v_last_night boolean;
  v_source_changed boolean;
  v_stay_changed boolean;
  v_previous_computed boolean;
BEGIN
  IF NEW.hotel NOT IN ('memories-budapest', 'Hotel Memories Budapest')
     OR NEW.organization_slug IS NULL THEN RETURN NEW; END IF;
  -- Both APIs and spreadsheet imports must identify the same local workday.
  IF v_meta ->> 'lastPmsRefreshDate' IS DISTINCT FROM v_today
     OR (v_meta ->> 'pmsSyncDate' IS DISTINCT FROM v_today
         AND v_meta ->> 'pmsUploadDate' IS DISTINCT FROM v_today)
     OR coalesce(v_meta ->> 'currentNight', '') !~ '^[0-9]{1,2}$'
     OR coalesce(v_meta ->> 'totalNights', '') !~ '^[0-9]{1,2}$'
  THEN RETURN NEW; END IF;
  v_night := (v_meta ->> 'currentNight')::integer;
  v_total := (v_meta ->> 'totalNights')::integer;
  IF v_night < 1 OR v_total < 1 OR v_night > v_total OR v_total > 90 THEN RETURN NEW; END IF;

  v_source_changed := v_meta IS DISTINCT FROM v_old_meta;
  IF NOT v_source_changed THEN RETURN NEW; END IF; -- leave direct manager/staff flag edits alone
  v_stay_changed := v_meta ->> 'pmsSyncDate' IS DISTINCT FROM v_old_meta ->> 'pmsSyncDate'
    OR v_meta ->> 'pmsUploadDate' IS DISTINCT FROM v_old_meta ->> 'pmsUploadDate'
    OR v_meta ->> 'currentNight' IS DISTINCT FROM v_old_meta ->> 'currentNight'
    OR v_meta ->> 'totalNights' IS DISTINCT FROM v_old_meta ->> 'totalNights'
    OR v_meta ->> 'scheduledDepartureTomorrow' IS DISTINCT FROM v_old_meta ->> 'scheduledDepartureTomorrow'
    OR v_meta ->> 'scheduledDepartureToday' IS DISTINCT FROM v_old_meta ->> 'scheduledDepartureToday'
    OR v_meta ->> 'isNoShow' IS DISTINCT FROM v_old_meta ->> 'isNoShow'
    OR v_meta ->> 'isCancelled' IS DISTINCT FROM v_old_meta ->> 'isCancelled'
    OR v_meta ->> 'arrivalToday' IS DISTINCT FROM v_old_meta ->> 'arrivalToday'
    OR NEW.is_checkout_room IS DISTINCT FROM OLD.is_checkout_room;
  -- Ordinary repeated live syncs retain supervisor/staff edits from this day.
  -- Spreadsheet service flags are always re-evaluated from this same policy
  -- whenever its own note/status data changes, never the XLS hard-coded cycle.
  IF NOT v_stay_changed
     AND v_meta ->> 'pmsUploadDate' IS DISTINCT FROM v_today
  THEN RETURN NEW; END IF;

  SELECT h.settings -> 'memories_service_cycle', o.slug
  INTO v_policy, v_org
  FROM public.hotel_configurations h
  JOIN public.organizations o ON o.id = h.organization_id
  WHERE h.hotel_id = 'memories-budapest' AND h.is_active = true;
  IF v_org IS DISTINCT FROM NEW.organization_slug
     OR coalesce(v_policy ->> 'enabled','false') <> 'true'
     OR coalesce(v_policy ->> 'towel_first_night','') !~ '^[0-9]{1,2}$'
     OR coalesce(v_policy ->> 'towel_repeat_nights','') !~ '^[0-9]{1,2}$'
     OR coalesce(v_policy ->> 'change_first_night','') !~ '^[0-9]{1,2}$'
     OR coalesce(v_policy ->> 'change_repeat_nights','') !~ '^[0-9]{1,2}$'
  THEN RETURN NEW; END IF;

  -- No-show, cancellation, unarrived guest and departure do not create an
  -- extra stayover task: checkout cleaning itself covers towels and linen.
  IF NOT coalesce(NEW.is_checkout_room,false)
     AND coalesce(v_meta ->> 'scheduledDepartureToday','false') <> 'true'
     AND coalesce(v_meta ->> 'isNoShow','false') <> 'true'
     AND coalesce(v_meta ->> 'isCancelled','false') <> 'true'
     AND coalesce(v_meta ->> 'notArrived','false') <> 'true'
     AND coalesce(v_meta ->> 'occupiedToday','false') = 'true'
  THEN
    v_towel := v_night >= (v_policy ->> 'towel_first_night')::integer
      AND (v_night - (v_policy ->> 'towel_first_night')::integer)
        % (v_policy ->> 'towel_repeat_nights')::integer = 0;
    v_change := v_night >= (v_policy ->> 'change_first_night')::integer
      AND (v_night - (v_policy ->> 'change_first_night')::integer)
        % (v_policy ->> 'change_repeat_nights')::integer = 0;
    -- A full Change Room includes towel service; show only the larger task.
    IF v_change THEN v_towel := false; END IF;
    v_last_night := v_night = v_total
      AND coalesce(v_meta ->> 'scheduledDepartureTomorrow','false') = 'true';
    IF v_change AND v_last_night
       AND coalesce(v_policy ->> 'final_night_towel_only','false') = 'true'
    THEN v_change := false; v_towel := true; END IF;
  END IF;

  -- Explicit dated room requests, if present, supersede a calculated cycle.
  -- Otherwise a new Budapest business day discards yesterday's mutable flags.
  IF v_meta ->> 'memoriesServiceManualOverrideDate' = v_today THEN RETURN NEW; END IF;
  IF NEW.towel_change_required IS DISTINCT FROM v_towel
     OR NEW.linen_change_required IS DISTINCT FROM v_change THEN
    INSERT INTO public.pms_change_events(hotel_id,room_id,room_label,event_type,source,before,after,category)
    VALUES ('memories-budapest', NEW.id, NEW.room_number,
      'housekeeping_service_cycle_reconciled','automatic_service_cycle',
      jsonb_build_object('towel', NEW.towel_change_required, 'change_room', NEW.linen_change_required),
      jsonb_build_object('towel', v_towel, 'change_room', v_change, 'night', v_night,
                         'total_nights', v_total, 'business_date', v_today), 'housekeeping');
  END IF;
  NEW.towel_change_required := v_towel;
  NEW.linen_change_required := v_change;
  RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS zzzzzzzzzz_hc_memories_service_cycle ON public.rooms;
CREATE TRIGGER zzzzzzzzzz_hc_memories_service_cycle
BEFORE UPDATE OF pms_metadata, guest_nights_stayed, is_checkout_room, towel_change_required, linen_change_required
ON public.rooms FOR EACH ROW EXECUTE FUNCTION public.hc_apply_memories_service_cycle();
