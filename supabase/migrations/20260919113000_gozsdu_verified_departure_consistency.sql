-- Gozsdu-only consistency guard: the daily Previo overview can describe a
-- departing guest while the general PMS room feed describes the next arrival.
-- Never treat a scheduled departure as confirmation that the guest checked out.
-- Never apply a partial/stale roster or overwrite a dated manager cleaning plan.
CREATE OR REPLACE FUNCTION public.gozsdu_has_verified_departure(p_room_id uuid, p_day date)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  WITH coverage AS (
    SELECT
      (SELECT count(*) FROM public.rooms r
       WHERE r.hotel IN ('gozsdu-court', 'Gozsdu Court Budapest')) AS rooms,
      (SELECT count(*) FROM public.gozsdu_housekeeping_room_registry) AS registry,
      count(*) AS snapshots,
      count(DISTINCT lower(btrim(s.room_label))) AS distinct_labels,
      count(DISTINCT s.captured_at) AS batches,
      min(s.captured_at) AS captured_at,
      count(*) FILTER (WHERE s.arrival_date IS NULL OR s.departure_date IS NULL
        OR s.arrival_date > p_day OR s.departure_date < p_day
        OR s.arrival_date >= s.departure_date) AS bad_dates,
      count(g.room_id) AS mapped,
      count(DISTINCT g.room_id) AS distinct_rooms
    FROM public.daily_overview_snapshots s
    LEFT JOIN public.gozsdu_housekeeping_room_registry g
      ON lower(btrim(g.pms_room_name)) = lower(btrim(s.room_label))
    LEFT JOIN public.rooms r ON r.id = g.room_id
      AND r.hotel IN ('gozsdu-court', 'Gozsdu Court Budapest')
      AND r.organization_slug = s.organization_slug
    WHERE s.hotel_id = 'gozsdu-court'
      AND s.business_date = p_day AND s.source = 'previo'
  )
  SELECT EXISTS (
    SELECT 1 FROM coverage c
    JOIN public.gozsdu_housekeeping_room_registry g ON g.room_id = p_room_id
    JOIN public.rooms r ON r.id = g.room_id
    JOIN public.daily_overview_snapshots s
      ON s.hotel_id = 'gozsdu-court' AND s.business_date = p_day
      AND s.source = 'previo' AND s.organization_slug = r.organization_slug
      AND lower(btrim(s.room_label)) = lower(btrim(g.pms_room_name))
    WHERE p_day = (now() AT TIME ZONE 'Europe/Budapest')::date
      AND c.rooms > 0 AND c.rooms = c.registry AND c.registry = c.snapshots
      AND c.snapshots = c.distinct_labels AND c.snapshots = c.mapped
      AND c.snapshots = c.distinct_rooms AND c.bad_dates = 0
      AND c.batches = 1 AND c.captured_at BETWEEN now() - interval '1 hour' AND now() + interval '1 minute'
      AND g.service_status = 'operating'
      AND r.hotel IN ('gozsdu-court', 'Gozsdu Court Budapest')
      AND s.departure_date = p_day AND s.status = 'departing'
      AND upper(coalesce(s.housekeeping_dep, '')) = 'DEP'
      AND coalesce(r.pms_metadata->>'manual_daily', 'false') <> 'true'
      AND coalesce(r.pms_metadata #>> ARRAY['hotelcareHousekeepingOverrides', p_day::text, 'bucket'], 'checkout') = 'checkout'
  );
$$;
REVOKE ALL ON FUNCTION public.gozsdu_has_verified_departure(uuid, date) FROM PUBLIC;

-- Applies the exact same Gozsdu-only source decision whenever a later generic
-- PMS refresh tries to replace departure flags with next-arrival information.
CREATE OR REPLACE FUNCTION public.gozsdu_guard_verified_departure_room()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_day date := (now() AT TIME ZONE 'Europe/Budapest')::date;
  v_meta jsonb := coalesce(NEW.pms_metadata, '{}'::jsonb);
  v_arrival date;
  v_departure date;
BEGIN
  IF NEW.hotel NOT IN ('gozsdu-court', 'Gozsdu Court Budapest')
     OR coalesce(v_meta->>'manual_daily', 'false') = 'true'
     OR coalesce(v_meta #>> ARRAY['hotelcareHousekeepingOverrides', v_day::text, 'bucket'], 'checkout') <> 'checkout'
     OR NOT public.gozsdu_has_verified_departure(NEW.id, v_day) THEN
    RETURN NEW;
  END IF;
  SELECT s.arrival_date, s.departure_date INTO v_arrival, v_departure
  FROM public.gozsdu_housekeeping_room_registry g
  JOIN public.daily_overview_snapshots s
    ON lower(btrim(s.room_label)) = lower(btrim(g.pms_room_name))
   AND s.hotel_id = 'gozsdu-court' AND s.business_date = v_day AND s.source = 'previo'
  WHERE g.room_id = NEW.id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  -- Preserve the next-arrival fact separately instead of showing a misleading
  -- "NA" badge on a room whose departing booking is verified by the roster.
  IF v_meta->>'notArrived' = 'true' THEN
    v_meta := jsonb_set(v_meta, '{gozsduIncomingGuestNotArrived}', 'true'::jsonb, true);
  END IF;
  v_meta := v_meta || jsonb_build_object(
    'scheduledDepartureToday', true, 'notArrived', false,
    'currentNight', v_departure - v_arrival,
    'totalNights', v_departure - v_arrival,
    'gozsduVerifiedDepartureDate', v_day::text
  );
  v_meta := jsonb_set(v_meta, '{gozsduHousekeeping}',
    coalesce(v_meta->'gozsduHousekeeping', '{}'::jsonb)
      || jsonb_build_object('serviceType', 'none', 'serviceDue', false,
        'currentNight', v_departure - v_arrival,
        'totalNights', v_departure - v_arrival), true);
  NEW.is_checkout_room := true;
  NEW.guest_nights_stayed := v_departure - v_arrival;
  NEW.towel_change_required := false;
  NEW.linen_change_required := false;
  NEW.pms_metadata := v_meta;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_gozsdu_guard_verified_departure_room ON public.rooms;
CREATE TRIGGER trg_gozsdu_guard_verified_departure_room
BEFORE UPDATE OF is_checkout_room, guest_nights_stayed, pms_metadata ON public.rooms
FOR EACH ROW EXECUTE FUNCTION public.gozsdu_guard_verified_departure_room();

-- An assignment created from the general room feed must not regress to daily
-- when the complete Previo daily overview says checkout. Started/completed
-- work is deliberately not reclassified behind a housekeeper's back.
CREATE OR REPLACE FUNCTION public.gozsdu_guard_verified_departure_assignment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.assignment_type = 'daily_cleaning'
     AND NEW.status IN ('assigned', 'dnd_pending_retry')
     AND public.gozsdu_has_verified_departure(NEW.room_id, NEW.assignment_date) THEN
    NEW.assignment_type := 'checkout_cleaning';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_gozsdu_guard_verified_departure_assignment ON public.room_assignments;
CREATE TRIGGER trg_gozsdu_guard_verified_departure_assignment
BEFORE INSERT OR UPDATE OF assignment_type, room_id, assignment_date, status ON public.room_assignments
FOR EACH ROW EXECUTE FUNCTION public.gozsdu_guard_verified_departure_assignment();

-- A complete refreshed overview must also repair any existing waiting task;
-- a guarded room update reconciles only the affected room and assignment.
CREATE OR REPLACE FUNCTION public.gozsdu_reconcile_snapshot_departure()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE v_room uuid;
BEGIN
  IF NEW.hotel_id <> 'gozsdu-court' OR NEW.source <> 'previo'
     OR NEW.business_date <> (now() AT TIME ZONE 'Europe/Budapest')::date
     OR NEW.departure_date IS DISTINCT FROM NEW.business_date
     OR NEW.status IS DISTINCT FROM 'departing'
     OR upper(coalesce(NEW.housekeeping_dep, '')) <> 'DEP' THEN
    RETURN NEW;
  END IF;
  SELECT g.room_id INTO v_room FROM public.gozsdu_housekeeping_room_registry g
  WHERE lower(btrim(g.pms_room_name)) = lower(btrim(NEW.room_label));
  IF v_room IS NULL OR NOT public.gozsdu_has_verified_departure(v_room, NEW.business_date) THEN
    RETURN NEW;
  END IF;
  UPDATE public.rooms SET pms_metadata = pms_metadata
  WHERE id = v_room AND (
    is_checkout_room IS DISTINCT FROM true
    OR pms_metadata->>'scheduledDepartureToday' IS DISTINCT FROM 'true'
    OR pms_metadata->>'notArrived' = 'true'
    OR pms_metadata->>'gozsduVerifiedDepartureDate' IS DISTINCT FROM NEW.business_date::text
  );
  UPDATE public.room_assignments SET assignment_type = 'checkout_cleaning'
  WHERE room_id = v_room AND assignment_date = NEW.business_date
    AND assignment_type = 'daily_cleaning' AND status IN ('assigned', 'dnd_pending_retry');
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_gozsdu_reconcile_snapshot_departure ON public.daily_overview_snapshots;
CREATE TRIGGER trg_gozsdu_reconcile_snapshot_departure
AFTER INSERT OR UPDATE ON public.daily_overview_snapshots
FOR EACH ROW EXECUTE FUNCTION public.gozsdu_reconcile_snapshot_departure();