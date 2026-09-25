SET lock_timeout = '2s';
SET statement_timeout = '45s';

-- Portfolio-wide housekeeping business-day integrity.
--
-- Safety contract:
--   * no live room/assignment rows are rewritten by this migration;
--   * new preservation guards activate from 2026-09-25 Budapest business date;
--   * today's (2026-09-24) active housekeeping flow remains untouched;
--   * yesterday's/future historical state is finalized into an immutable JSON
--     payload instead of depending on mutable live room mirrors.
--
-- The existing housekeeping_room_snapshots table remains the canonical dated
-- history row. final_state is a once-written, immutable end-of-day payload.

ALTER TABLE public.housekeeping_room_snapshots
  ADD COLUMN IF NOT EXISTS final_state jsonb,
  ADD COLUMN IF NOT EXISTS finalized_at timestamptz;

ALTER TABLE public.room_assignments
  ADD COLUMN IF NOT EXISTS previous_day_context jsonb;

COMMENT ON COLUMN public.housekeeping_room_snapshots.final_state IS
  'Immutable end-of-business-day housekeeping evidence. Captures final T/C requirements, DND/NS, notes and assignment instructions without relying on mutable live room rows.';
COMMENT ON COLUMN public.room_assignments.previous_day_context IS
  'Read-only context copied from the previous business day at assignment creation; never reactivates DND/NS or service flags by itself.';

CREATE INDEX IF NOT EXISTS idx_housekeeping_room_snapshots_unfinalized
  ON public.housekeeping_room_snapshots (business_date, hotel)
  WHERE final_state IS NULL;

-- A finalized state can be created once and never silently rewritten. This
-- protects read-only historical overviews even if a later approval or repair
-- updates other columns on the snapshot row.
CREATE OR REPLACE FUNCTION public.hc_keep_housekeeping_final_state_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  IF OLD.final_state IS NOT NULL THEN
    NEW.final_state := OLD.final_state;
    NEW.finalized_at := OLD.finalized_at;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS a_hc_keep_housekeeping_final_state_immutable
  ON public.housekeeping_room_snapshots;
CREATE TRIGGER a_hc_keep_housekeeping_final_state_immutable
BEFORE UPDATE ON public.housekeeping_room_snapshots
FOR EACH ROW
EXECUTE FUNCTION public.hc_keep_housekeeping_final_state_immutable();

-- Freeze one completed Budapest business date. The assignment instruction
-- snapshot is preferred for T/C because it records what the housekeeper was
-- actually instructed to do. If work never started, the room snapshot at close
-- remains the fallback. "had_*" is retained for DND/NS evidence, but is NOT used
-- as a historical T/C requirement because a transient auto-rule can otherwise
-- make a badge appear later even when it was not the final instruction.
CREATE OR REPLACE FUNCTION public.finalize_housekeeping_business_date(
  p_business_date date DEFAULT ((now() AT TIME ZONE 'Europe/Budapest')::date - 1)
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_today date := (statement_timestamp() AT TIME ZONE 'Europe/Budapest')::date;
  v_count integer := 0;
BEGIN
  IF p_business_date IS NULL OR p_business_date >= v_today THEN
    RAISE EXCEPTION 'Only a completed Budapest business date can be finalized';
  END IF;

  WITH ranked_assignments AS (
    SELECT
      ra.*,
      row_number() OVER (
        PARTITION BY ra.assignment_date, ra.room_id
        ORDER BY
          CASE
            WHEN ra.status::text = 'completed' AND coalesce(ra.supervisor_approved,false) THEN 6
            WHEN ra.status::text = 'completed' THEN 5
            WHEN ra.status::text = 'in_progress' THEN 4
            WHEN ra.status::text = 'dnd_pending_retry' THEN 3
            WHEN ra.status::text = 'assigned' THEN 2
            ELSE 1
          END DESC,
          ra.updated_at DESC NULLS LAST,
          ra.id
      ) AS rn
    FROM public.room_assignments ra
    WHERE ra.assignment_date = p_business_date
  ),
  payloads AS (
    SELECT
      s.id,
      jsonb_strip_nulls(
        jsonb_build_object(
          'version', 1,
          'business_date', s.business_date,
          'room_id', s.room_id,
          'hotel', s.hotel,
          'organization_slug', s.organization_slug,
          'room_number', s.room_number,
          'room_status_at_close', s.room_status,
          'is_checkout_room_at_close', s.is_checkout_room,
          'towel_change_required_at_close', coalesce(s.towel_change_required,false),
          'linen_change_required_at_close', coalesce(s.linen_change_required,false),
          'towel_change_required_for_assignment',
            CASE
              WHEN jsonb_typeof(a.instruction_snapshot #> '{room,towel_change_required}') = 'boolean'
              THEN (a.instruction_snapshot #>> '{room,towel_change_required}')::boolean
              ELSE coalesce(s.towel_change_required,false)
            END,
          'linen_change_required_for_assignment',
            CASE
              WHEN jsonb_typeof(a.instruction_snapshot #> '{room,linen_change_required}') = 'boolean'
              THEN (a.instruction_snapshot #>> '{room,linen_change_required}')::boolean
              ELSE coalesce(s.linen_change_required,false)
            END,
          'had_dnd', coalesce(s.had_dnd,false)
            OR coalesce(a.is_dnd,false)
            OR coalesce(a.dnd_attempt_count,0) > 0
            OR a.status::text = 'dnd_pending_retry',
          'dnd_active_at_close', coalesce(s.is_dnd,false),
          'had_no_service', coalesce(s.had_no_service,false)
            OR a.service_result = 'guest_declined'
            OR position('[NO_SERVICE]' IN coalesce(a.notes,'')) > 0,
          'had_room_cleaning_request', coalesce(s.had_room_cleaning_request,false),
          'had_extra_towels_request', coalesce(s.had_extra_towels_request,false),
          'had_ready_to_clean', coalesce(s.had_ready_to_clean,false),
          'room_notes_at_close', s.room_notes,
          'assignment_notes', coalesce(a.notes, s.assignment_notes),
          'manager_instruction_text', a.manager_instruction_text,
          'instruction_snapshot', a.instruction_snapshot,
          'service_result', a.service_result,
          'manual_service_override', s.pms_metadata -> 'hotelcareManualServiceOverride',
          'pms_metadata_at_close', s.pms_metadata,
          'source_snapshot', s.source
        )
      ) AS final_state
    FROM public.housekeeping_room_snapshots s
    LEFT JOIN ranked_assignments a
      ON a.room_id = s.room_id
     AND a.assignment_date = s.business_date
     AND a.rn = 1
    WHERE s.business_date = p_business_date
      AND s.final_state IS NULL
  )
  UPDATE public.housekeeping_room_snapshots s
  SET final_state = p.final_state,
      finalized_at = statement_timestamp()
  FROM payloads p
  WHERE s.id = p.id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$fn$;

REVOKE ALL ON FUNCTION public.finalize_housekeeping_business_date(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_housekeeping_business_date(date) TO service_role;

-- Keep finalization DST-safe without hard-coding a UTC hour. The job is cheap:
-- it checks the previous local business date and becomes a no-op once all rows
-- are finalized. It does not update rooms or today's assignments.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'hotelcare-finalize-housekeeping-business-day',
      '*/10 * * * *',
      'SELECT public.finalize_housekeeping_business_date((now() AT TIME ZONE ''Europe/Budapest'')::date - 1);'
    );
  END IF;
END
$$;

-- Carry the previous day's evidence onto NEW assignments only. It is context,
-- not an active state: we deliberately do not set is_dnd, service_result,
-- towel_change_required or linen_change_required from yesterday.
CREATE OR REPLACE FUNCTION public.hc_attach_previous_day_housekeeping_context()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  v_state jsonb;
BEGIN
  -- Explicit safety gate: do not alter any 2026-09-24 assignment flow.
  IF NEW.assignment_date < DATE '2026-09-25'
     OR NEW.previous_day_context IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT s.final_state
  INTO v_state
  FROM public.housekeeping_room_snapshots s
  WHERE s.room_id = NEW.room_id
    AND s.business_date = NEW.assignment_date - 1
    AND s.final_state IS NOT NULL
  ORDER BY s.finalized_at DESC NULLS LAST
  LIMIT 1;

  IF v_state IS NOT NULL THEN
    NEW.previous_day_context := jsonb_strip_nulls(
      jsonb_build_object(
        'version', 1,
        'source_business_date', v_state -> 'business_date',
        'had_dnd', v_state -> 'had_dnd',
        'had_no_service', v_state -> 'had_no_service',
        'room_notes', v_state -> 'room_notes_at_close',
        'assignment_notes', v_state -> 'assignment_notes',
        'manager_instruction_text', v_state -> 'manager_instruction_text',
        'towel_change_required', coalesce(
          v_state -> 'towel_change_required_for_assignment',
          v_state -> 'towel_change_required_at_close'
        ),
        'linen_change_required', coalesce(
          v_state -> 'linen_change_required_for_assignment',
          v_state -> 'linen_change_required_at_close'
        ),
        'instruction_snapshot', v_state -> 'instruction_snapshot'
      )
    );
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS a_hc_attach_previous_day_housekeeping_context
  ON public.room_assignments;
CREATE TRIGGER a_hc_attach_previous_day_housekeeping_context
BEFORE INSERT OR UPDATE OF assignment_date, room_id
ON public.room_assignments
FOR EACH ROW
EXECUTE FUNCTION public.hc_attach_previous_day_housekeeping_context();

-- Stamp direct human T/C changes with a business date and reservation identity.
-- This is portfolio-wide and is intentionally dormant for today's live work.
CREATE OR REPLACE FUNCTION public.hc_stamp_portfolio_manual_service_override()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  v_today date := (statement_timestamp() AT TIME ZONE 'Europe/Budapest')::date;
  v_meta jsonb := coalesce(NEW.pms_metadata,'{}'::jsonb);
  v_reservation_key text;
BEGIN
  IF v_today < DATE '2026-09-25' THEN RETURN NEW; END IF;

  IF (
      NEW.towel_change_required IS DISTINCT FROM OLD.towel_change_required
      OR NEW.linen_change_required IS DISTINCT FROM OLD.linen_change_required
    )
    AND NEW.pms_metadata IS NOT DISTINCT FROM OLD.pms_metadata
    AND auth.uid() IS NOT NULL
  THEN
    v_reservation_key := coalesce(
      v_meta ->> 'reservationId',
      v_meta ->> 'reservation_id',
      v_meta ->> 'bookingId',
      v_meta ->> 'booking_id',
      v_meta ->> 'guestReservationId',
      v_meta ->> 'roomId'
    );

    NEW.pms_metadata := jsonb_set(
      v_meta,
      '{hotelcareManualServiceOverride}',
      jsonb_strip_nulls(
        jsonb_build_object(
          'businessDate', v_today::text,
          'towel', coalesce(NEW.towel_change_required,false),
          'changeRoom', coalesce(NEW.linen_change_required,false),
          'reservationKey', v_reservation_key,
          'source', 'manual',
          'actor', auth.uid()::text,
          'updatedAt', statement_timestamp()
        )
      ),
      true
    );
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS a_hc_portfolio_stamp_manual_service_override ON public.rooms;
CREATE TRIGGER a_hc_portfolio_stamp_manual_service_override
BEFORE UPDATE OF towel_change_required, linen_change_required
ON public.rooms
FOR EACH ROW
EXECUTE FUNCTION public.hc_stamp_portfolio_manual_service_override();

-- Re-apply today's explicit human T/C decision after property-specific rule
-- triggers and PMS-shaped updates. A checkout, a different reservation, or an
-- explicit clear marker ends the override. Old-day overrides are removed from
-- the live mirror on its next update, while the finalized historical copy stays.
CREATE OR REPLACE FUNCTION public.hc_reapply_portfolio_manual_service_override()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  v_today date := (statement_timestamp() AT TIME ZONE 'Europe/Budapest')::date;
  v_old_meta jsonb := coalesce(OLD.pms_metadata,'{}'::jsonb);
  v_new_meta jsonb := coalesce(NEW.pms_metadata,'{}'::jsonb);
  v_override jsonb := v_old_meta -> 'hotelcareManualServiceOverride';
  v_override_date text := v_override ->> 'businessDate';
  v_old_key text := v_override ->> 'reservationKey';
  v_new_key text;
BEGIN
  IF v_today < DATE '2026-09-25' THEN RETURN NEW; END IF;

  IF v_override_date IS NULL THEN RETURN NEW; END IF;

  IF v_override_date < v_today::text THEN
    NEW.pms_metadata := v_new_meta - 'hotelcareManualServiceOverride';
    RETURN NEW;
  END IF;

  IF v_override_date IS DISTINCT FROM v_today::text
     OR v_new_meta ->> 'hotelcareManualServiceClearDate' = v_today::text
     OR coalesce(NEW.is_checkout_room,false)
     OR coalesce(v_new_meta ->> 'scheduledDepartureToday','false') = 'true'
  THEN
    RETURN NEW;
  END IF;

  v_new_key := coalesce(
    v_new_meta ->> 'reservationId',
    v_new_meta ->> 'reservation_id',
    v_new_meta ->> 'bookingId',
    v_new_meta ->> 'booking_id',
    v_new_meta ->> 'guestReservationId',
    v_new_meta ->> 'roomId'
  );

  IF nullif(v_old_key,'') IS NOT NULL
     AND nullif(v_new_key,'') IS NOT NULL
     AND v_old_key IS DISTINCT FROM v_new_key
  THEN
    RETURN NEW;
  END IF;

  IF jsonb_typeof(v_override -> 'towel') = 'boolean' THEN
    NEW.towel_change_required := (v_override ->> 'towel')::boolean;
  END IF;
  IF jsonb_typeof(v_override -> 'changeRoom') = 'boolean' THEN
    NEW.linen_change_required := (v_override ->> 'changeRoom')::boolean;
  END IF;

  NEW.pms_metadata := jsonb_set(
    v_new_meta,
    '{hotelcareManualServiceOverride}',
    v_override,
    true
  );
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS zzzzzzzzzzzz_hc_portfolio_reapply_manual_service_override
  ON public.rooms;
CREATE TRIGGER zzzzzzzzzzzz_hc_portfolio_reapply_manual_service_override
BEFORE UPDATE OF pms_metadata, towel_change_required, linen_change_required, is_checkout_room
ON public.rooms
FOR EACH ROW
EXECUTE FUNCTION public.hc_reapply_portfolio_manual_service_override();

-- PMS/API refreshes do not own same-day human room notes. Preserve a note that
-- was explicitly edited today whenever an automated metadata update attempts to
-- replace/blank it. This stays dormant for 2026-09-24.
CREATE OR REPLACE FUNCTION public.hc_preserve_portfolio_same_day_room_notes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  v_today date := (statement_timestamp() AT TIME ZONE 'Europe/Budapest')::date;
  v_has_today_human_note boolean := false;
BEGIN
  IF v_today < DATE '2026-09-25'
     OR NEW.notes IS NOT DISTINCT FROM OLD.notes
     OR NEW.pms_metadata IS NOT DISTINCT FROM OLD.pms_metadata
     OR auth.uid() IS NOT NULL
  THEN
    RETURN NEW;
  END IF;

  v_has_today_human_note :=
    OLD.operational_note_date = v_today
    OR EXISTS (
      SELECT 1
      FROM public.housekeeping_notes hn
      WHERE hn.room_id = OLD.id
        AND hn.note_type = 'room_note_history'
        AND (hn.created_at AT TIME ZONE 'Europe/Budapest')::date = v_today
    );

  IF v_has_today_human_note THEN
    NEW.notes := OLD.notes;
    NEW.operational_note_date := OLD.operational_note_date;
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS zzzzzzzzzzzzz_hc_preserve_portfolio_same_day_room_notes
  ON public.rooms;
CREATE TRIGGER zzzzzzzzzzzzz_hc_preserve_portfolio_same_day_room_notes
BEFORE UPDATE OF notes, pms_metadata
ON public.rooms
FOR EACH ROW
EXECUTE FUNCTION public.hc_preserve_portfolio_same_day_room_notes();

-- Freeze the reported 2026-09-23 incident date even if this migration is
-- deployed a day later, then freeze the immediately previous business date.
-- Both operations write historical snapshots only; today's rooms/assignments
-- remain untouched.
DO $finalize$
DECLARE v_today date := (now() AT TIME ZONE 'Europe/Budapest')::date;
BEGIN
  IF DATE '2026-09-23' < v_today THEN
    PERFORM public.finalize_housekeeping_business_date(DATE '2026-09-23');
  END IF;
  PERFORM public.finalize_housekeeping_business_date(v_today - 1);
END
$finalize$;
