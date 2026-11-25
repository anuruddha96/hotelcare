-- Housekeeping business-day close: one actual full snapshot + immutable finalize
-- at 20:00 Europe/Budapest. Preserve UTC-based pg_cron settings for all other jobs.
--
-- Cron is configured in GMT. Run a lightweight DST-aware local-time gate at
-- 18:00 and 19:00 GMT. Exactly one invocation reaches 20:00 Budapest time
-- each date; the other returns without scanning any rooms.

DO $patch_finalizer$
DECLARE
  v_definition text;
  v_old constant text := $old$  IF p_business_date IS NULL OR p_business_date >= v_today THEN
    RAISE EXCEPTION 'Only a completed Budapest business date can be finalized';
  END IF;$old$;
  v_new constant text := $new$  IF p_business_date IS NULL
     OR p_business_date > v_today
     OR (p_business_date = v_today AND (statement_timestamp() AT TIME ZONE 'Europe/Budapest')::time < TIME '20:00')
  THEN
    RAISE EXCEPTION 'The current Budapest business date cannot be finalized before 20:00';
  END IF;$new$;
BEGIN
  SELECT pg_get_functiondef('public.finalize_housekeeping_business_date(date)'::regprocedure)
  INTO v_definition;
  IF position(v_old IN v_definition) > 0 THEN
    EXECUTE replace(v_definition, v_old, v_new);
  ELSIF position(v_new IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Unexpected finalize_housekeeping_business_date definition: refusing unsafe update';
  END IF;
END;
$patch_finalizer$;

CREATE OR REPLACE FUNCTION public.hc_close_housekeeping_day_20()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $close$
DECLARE
  v_local_ts timestamp := statement_timestamp() AT TIME ZONE 'Europe/Budapest';
  v_day date := v_local_ts::date;
  v_room_count integer;
  v_captured integer;
  v_snapshot_count integer;
  v_invalid_duties integer;
  v_finalized_now integer;
  v_finalized_total integer;
BEGIN
  -- pg_cron is GMT: only one of the two DST candidate hours is 20:00 local.
  IF v_local_ts::time < TIME '20:00' OR v_local_ts::time >= TIME '21:00' THEN
    RETURN jsonb_build_object('status', 'skipped_outside_budapest_20', 'local_time', v_local_ts);
  END IF;

  -- One day-close transaction. Never expose partially finalized hotel histories.
  PERFORM pg_advisory_xact_lock(20261028, 20);
  SELECT count(*) INTO v_room_count FROM public.rooms;
  IF v_room_count = 0 THEN
    RAISE EXCEPTION 'Cannot finalize housekeeping: no room inventory found';
  END IF;

  -- Refresh the FULL live room + assignment state immediately before freezing.
  SELECT public.capture_all_housekeeping_rooms_for_date(v_day) INTO v_captured;
  IF v_captured IS DISTINCT FROM v_room_count THEN
    RAISE EXCEPTION 'Incomplete housekeeping capture: expected %, captured %', v_room_count, v_captured;
  END IF;

  -- Reject a known Hotel Memories PMS rollover bug: previous stay-night duty
  -- attached to the next date. Keep the original exact evidence for auditing.
  UPDATE public.housekeeping_room_snapshots s
  SET scheduled_service_due = jsonb_build_object(
    'towel', false,
    'change_room', false,
    'invalidated_reason', 'stale_pms_stay_night_at_day_close',
    'invalidated_at', statement_timestamp(),
    'invalidated_original', s.scheduled_service_due
  )
  WHERE s.business_date = v_day
    AND s.hotel = 'Hotel Memories Budapest'
    AND s.scheduled_service_due->>'source' = 'same_day_verified_room_duty'
    AND s.scheduled_service_due->>'stay_night' ~ '^[0-9]+$'
    AND s.pms_metadata->>'arrivalDate' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    AND (v_day - (s.pms_metadata->>'arrivalDate')::date + 1)::text
        IS DISTINCT FROM s.scheduled_service_due->>'stay_night';
  GET DIAGNOSTICS v_invalid_duties = ROW_COUNT;

  SELECT count(*) INTO v_snapshot_count
  FROM public.rooms r
  JOIN public.housekeeping_room_snapshots s
    ON s.room_id = r.id AND s.business_date = v_day;
  IF v_snapshot_count <> v_room_count THEN
    RAISE EXCEPTION 'Incomplete housekeeping snapshots: expected %, present %',
      v_room_count, v_snapshot_count;
  END IF;

  -- Frozen final_state contains the dated manager T/C instruction, selected
  -- assignment, service outcome, DND/No Service and supervisor approval.
  SELECT public.finalize_housekeeping_business_date(v_day) INTO v_finalized_now;

  SELECT count(*) INTO v_finalized_total
  FROM public.rooms r
  JOIN public.housekeeping_room_snapshots s
    ON s.room_id = r.id AND s.business_date = v_day
  WHERE s.final_state IS NOT NULL AND s.finalized_at IS NOT NULL
    AND s.final_state->>'business_date' = v_day::text
    AND s.final_state->>'room_id' = r.id::text;

  IF v_finalized_total <> v_room_count THEN
    RAISE EXCEPTION 'Housekeeping day close incomplete: expected %, finalized %',
      v_room_count, v_finalized_total;
  END IF;

  RETURN jsonb_build_object(
    'status', 'complete',
    'business_date', v_day,
    'rooms_captured', v_captured,
    'rooms_finalized', v_finalized_total,
    'newly_finalized', v_finalized_now,
    'invalid_pms_duties_preserved_and_rejected', v_invalid_duties
  );
END;
$close$;

REVOKE ALL ON FUNCTION public.hc_close_housekeeping_day_20()
  FROM PUBLIC, anon, authenticated;

-- Reuse the existing nightly finalization job; do not change cron.timezone,
-- which would accidentally shift every other scheduled operation.
DO $cron$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'hotelcare-finalize-housekeeping-business-day'
  ) THEN
    RAISE EXCEPTION 'Original housekeeping day-finalization cron job not found';
  END IF;

  PERFORM cron.schedule(
    'hotelcare-finalize-housekeeping-business-day',
    '0 18,19 * * *',
    'SELECT public.hc_close_housekeeping_day_20();'
  );

  -- Their work is now performed once before finalization in the same transaction.
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'housekeeping_history_eod_2155') THEN
    PERFORM cron.unschedule('housekeeping_history_eod_2155');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'housekeeping_history_eod_2255') THEN
    PERFORM cron.unschedule('housekeeping_history_eod_2255');
  END IF;
END;
$cron$;
