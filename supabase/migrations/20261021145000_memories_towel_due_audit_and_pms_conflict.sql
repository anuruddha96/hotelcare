-- Hotel Memories Budapest ONLY (2026-10-21).
-- Keep a confirmed continuing stay on its configured T/C cycle even when a
-- stale Previo notArrived/arrivalToday flag conflicts with occupiedToday.
-- Do not touch non-Memories properties, guest status, manual notes, actual
-- completion timestamps, existing manager approvals, or historical final_state.
SET lock_timeout = '2s';
SET statement_timeout = '45s';

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
    OR v_meta ->> 'notArrived' IS DISTINCT FROM v_old_meta ->> 'notArrived'
    OR v_meta ->> 'occupiedToday' IS DISTINCT FROM v_old_meta ->> 'occupiedToday'
    OR v_meta ->> 'stayThroughToday' IS DISTINCT FROM v_old_meta ->> 'stayThroughToday'
    OR v_meta ->> 'arrivalDate' IS DISTINCT FROM v_old_meta ->> 'arrivalDate'
    OR v_meta ->> 'departureDate' IS DISTINCT FROM v_old_meta ->> 'departureDate'
    OR v_meta ->> 'reservationId' IS DISTINCT FROM v_old_meta ->> 'reservationId'
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
     -- Some continuing stays have stale notArrived=true in otherwise occupied
     -- Previo records. Use a confirmed multi-night in-house context only.
     AND (
       coalesce(v_meta ->> 'notArrived','false') <> 'true'
       OR (
         v_night >= 2
         AND coalesce(v_meta ->> 'stayThroughToday','false') = 'true'
         AND coalesce(v_meta ->> 'reservationId','') <> ''
         AND length(coalesce(v_meta ->> 'arrivalDate','')) = 10
         AND substring(v_meta ->> 'arrivalDate' from 5 for 1) = '-'
         AND substring(v_meta ->> 'arrivalDate' from 8 for 1) = '-'
         AND (v_meta ->> 'arrivalDate') < v_today
         AND length(coalesce(v_meta ->> 'departureDate','')) = 10
         AND substring(v_meta ->> 'departureDate' from 5 for 1) = '-'
         AND substring(v_meta ->> 'departureDate' from 8 for 1) = '-'
         AND (v_meta ->> 'departureDate') > v_today
       )
     )
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

-- Provenance is separate from a live room flag and from service completion.
-- Once today's due service was observed, a later PMS update may not erase the
-- fact that the duty was scheduled. The immutable final_state remains intact.
ALTER TABLE public.housekeeping_room_snapshots
  ADD COLUMN IF NOT EXISTS scheduled_service_due jsonb;
COMMENT ON COLUMN public.housekeeping_room_snapshots.scheduled_service_due IS
  'First verified same-day T/C due marker(s), regardless of subsequent PMS recalculation. Does not prove physical service completion or supersede a manager override.';

CREATE OR REPLACE FUNCTION public.hc_capture_memories_scheduled_service_due()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public,pg_temp
AS $body$
DECLARE
  v_day date := (statement_timestamp() AT TIME ZONE 'Europe/Budapest')::date;
BEGIN
  IF lower(btrim(coalesce(NEW.hotel,''))) NOT IN
       ('hotel memories budapest','memories budapest','memories-budapest')
     OR NEW.organization_slug IS NULL
     OR (NOT coalesce(NEW.towel_change_required,false)
         AND NOT coalesce(NEW.linen_change_required,false))
     OR coalesce(NEW.is_checkout_room,false)
     OR NEW.pms_metadata ->> 'isNoShow' = 'true'
     OR NEW.pms_metadata ->> 'isCancelled' = 'true'
     OR coalesce(NEW.pms_metadata ->> 'pmsSyncDate',
                 NEW.pms_metadata ->> 'pmsUploadDate','') <> v_day::text
  THEN RETURN NEW; END IF;

  -- 'Ever due' is a planned-duty audit, NOT a completed towel/linen service.
  -- Update only on the first true flag or an actual T-to-C plan escalation,
  -- avoiding repeat writes on every identical realtime or PMS update.
  UPDATE public.housekeeping_room_snapshots s
  SET scheduled_service_due = jsonb_build_object(
      'towel', coalesce((s.scheduled_service_due->>'towel')::boolean,false)
               OR coalesce(NEW.towel_change_required,false),
      'change_room', coalesce((s.scheduled_service_due->>'change_room')::boolean,false)
               OR coalesce(NEW.linen_change_required,false),
      'first_observed_at', coalesce(s.scheduled_service_due->>'first_observed_at',
                                    statement_timestamp()::text),
      'source', 'same_day_verified_room_duty',
      'business_date', v_day::text,
      'stay_night', coalesce(NEW.pms_metadata->>'currentNight',
                             NEW.guest_nights_stayed::text),
      'reservation_id', NEW.pms_metadata->>'reservationId'
  )
  WHERE s.room_id = NEW.id AND s.business_date = v_day
    AND s.organization_slug = NEW.organization_slug
    AND lower(btrim(coalesce(s.hotel,''))) IN
      ('hotel memories budapest','memories budapest','memories-budapest')
    AND s.final_state IS NULL
    AND (
      (coalesce(NEW.towel_change_required,false)
       AND NOT coalesce((s.scheduled_service_due->>'towel')::boolean,false))
      OR
      (coalesce(NEW.linen_change_required,false)
       AND NOT coalesce((s.scheduled_service_due->>'change_room')::boolean,false))
    );
  RETURN NEW;
END;
$body$;
REVOKE ALL ON FUNCTION public.hc_capture_memories_scheduled_service_due()
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hc_capture_memories_scheduled_service_due()
  TO service_role;

DROP TRIGGER IF EXISTS zzzzzz_hc_capture_memories_scheduled_service_due ON public.rooms;
CREATE TRIGGER zzzzzz_hc_capture_memories_scheduled_service_due
AFTER INSERT OR UPDATE OF pms_metadata,towel_change_required,linen_change_required
ON public.rooms
FOR EACH ROW EXECUTE FUNCTION public.hc_capture_memories_scheduled_service_due();

-- Today's flags that are already true must be recorded immediately. Do not
-- rewrite room state, past final_state, or an assignment's service result.
UPDATE public.housekeeping_room_snapshots s
SET scheduled_service_due = jsonb_build_object(
  'towel', coalesce(r.towel_change_required,false),
  'change_room', coalesce(r.linen_change_required,false),
  'first_observed_at',statement_timestamp()::text,
  'source','deployment_observation',
  'business_date',s.business_date::text,
  'stay_night',r.pms_metadata->>'currentNight',
  'reservation_id',r.pms_metadata->>'reservationId'
)
FROM public.rooms r
WHERE s.room_id=r.id
  AND s.business_date=(statement_timestamp() AT TIME ZONE 'Europe/Budapest')::date
  AND s.final_state IS NULL
  AND s.scheduled_service_due IS NULL
  AND s.organization_slug=r.organization_slug
  AND lower(btrim(coalesce(r.hotel,''))) IN
      ('hotel memories budapest','memories budapest','memories-budapest')
  AND lower(btrim(coalesce(s.hotel,''))) IN
      ('hotel memories budapest','memories budapest','memories-budapest')
  AND NOT coalesce(r.is_checkout_room,false)
  AND coalesce(r.pms_metadata->>'isNoShow','false') <> 'true'
  AND coalesce(r.pms_metadata->>'isCancelled','false') <> 'true'
  AND (coalesce(r.towel_change_required,false) OR coalesce(r.linen_change_required,false));
