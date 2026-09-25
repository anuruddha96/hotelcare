-- Hotel Memories Budapest only: carry an unresolved scheduled stayover service
-- (towel change or full Change Room cleaning) into the next eligible business day
-- when yesterday ended as DND or No Service.
--
-- Safety:
--   * activation starts 2026-09-26 so the 2026-09-25 live operation is untouched;
--   * no room row, PMS classification, DND flag, or manual manager note is rewritten;
--   * checkout/no-show/cancelled/new-arrival states suppress the carry-forward;
--   * other hotels keep only the existing generic previous_day_context behavior.
--
-- The carry-forward is stored as structured assignment context so the UI can
-- render it like a manager instruction and translate it without mutating notes.

CREATE OR REPLACE FUNCTION public.hc_memories_previous_service_context(
  p_room_id uuid,
  p_assignment_date date,
  p_assignment_type text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_state jsonb;
  v_context jsonb;
  v_room_hotel text;
  v_room_checkout boolean;
  v_room_meta jsonb;
  v_has_fresh_pms boolean := false;
  v_pms_checkout boolean := false;
  v_effective_checkout boolean := false;
  v_prev_key text;
  v_current_key text;
  v_same_reservation boolean := false;
  v_towel boolean := false;
  v_full_clean boolean := false;
  v_had_dnd boolean := false;
  v_had_no_service boolean := false;
  v_service_result text;
  v_reason text;
  v_service_type text;
  v_instruction text;
  v_source_date date;
BEGIN
  IF p_room_id IS NULL
     OR p_assignment_date IS NULL
     OR p_assignment_date < DATE '2026-09-26' THEN
    RETURN NULL;
  END IF;

  SELECT r.hotel, coalesce(r.is_checkout_room,false), coalesce(r.pms_metadata,'{}'::jsonb)
  INTO v_room_hotel, v_room_checkout, v_room_meta
  FROM public.rooms r
  WHERE r.id = p_room_id;

  IF lower(btrim(coalesce(v_room_hotel,''))) NOT IN (
      'hotel memories budapest',
      'memories budapest',
      'memories-budapest'
    ) THEN
    RETURN NULL;
  END IF;

  v_source_date := p_assignment_date - 1;

  SELECT s.final_state
  INTO v_state
  FROM public.housekeeping_room_snapshots s
  WHERE s.room_id = p_room_id
    AND s.business_date = v_source_date
    AND s.final_state IS NOT NULL
  ORDER BY s.finalized_at DESC NULLS LAST, s.updated_at DESC NULLS LAST, s.id
  LIMIT 1;

  IF v_state IS NULL THEN
    RETURN NULL;
  END IF;

  -- Retain the existing previous-day audit context, but add first-class
  -- service_result and checkout-at-close fields used by the carry logic.
  v_context := jsonb_strip_nulls(
    jsonb_build_object(
      'version', 2,
      'source_business_date', v_state -> 'business_date',
      'had_dnd', v_state -> 'had_dnd',
      'had_no_service', v_state -> 'had_no_service',
      'service_result', v_state -> 'service_result',
      'is_checkout_room_at_close', v_state -> 'is_checkout_room_at_close',
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

  -- A previous checkout is not a missed stayover service.
  IF lower(coalesce(v_state ->> 'is_checkout_room_at_close','false')) = 'true' THEN
    RETURN v_context;
  END IF;

  v_service_result := lower(coalesce(v_state ->> 'service_result',''));
  v_had_dnd := lower(coalesce(v_state ->> 'had_dnd','false')) = 'true';
  v_had_no_service := lower(coalesce(v_state ->> 'had_no_service','false')) = 'true';

  -- A later successful clean on the same day resolves an earlier DND attempt.
  IF v_service_result = 'cleaned' OR NOT (v_had_dnd OR v_had_no_service) THEN
    RETURN v_context;
  END IF;

  v_full_clean := lower(coalesce(
    v_state ->> 'linen_change_required_for_assignment',
    v_state ->> 'linen_change_required_at_close',
    'false'
  )) = 'true';

  v_towel := lower(coalesce(
    v_state ->> 'towel_change_required_for_assignment',
    v_state ->> 'towel_change_required_at_close',
    'false'
  )) = 'true';

  -- Full Change Room service includes towel service; keep one clear requirement.
  IF v_full_clean THEN
    v_towel := false;
  END IF;

  IF NOT v_full_clean AND NOT v_towel THEN
    RETURN v_context;
  END IF;

  -- Match the same operational classification rule used by the UI: a fresh PMS
  -- date is authoritative; a stale assignment_type is only a fallback.
  v_has_fresh_pms :=
    coalesce(v_room_meta ->> 'pmsSyncDate','') = p_assignment_date::text
    OR coalesce(v_room_meta ->> 'lastPmsRefreshDate','') = p_assignment_date::text
    OR coalesce(v_room_meta ->> 'pmsUploadDate','') = p_assignment_date::text;

  v_pms_checkout := v_room_checkout
    OR lower(coalesce(v_room_meta ->> 'scheduledDepartureToday','false')) = 'true';

  v_effective_checkout := v_pms_checkout
    OR (NOT v_has_fresh_pms AND coalesce(p_assignment_type,'') = 'checkout_cleaning');

  IF v_effective_checkout
     OR lower(coalesce(v_room_meta ->> 'isNoShow','false')) = 'true'
     OR lower(coalesce(v_room_meta ->> 'isCancelled','false')) = 'true'
     OR lower(coalesce(v_room_meta ->> 'notArrived','false')) = 'true' THEN
    RETURN v_context;
  END IF;

  v_prev_key := coalesce(
    v_state #>> '{pms_metadata_at_close,reservationId}',
    v_state #>> '{pms_metadata_at_close,reservation_id}',
    v_state #>> '{pms_metadata_at_close,bookingId}',
    v_state #>> '{pms_metadata_at_close,booking_id}',
    v_state #>> '{pms_metadata_at_close,guestReservationId}'
  );
  v_current_key := coalesce(
    v_room_meta ->> 'reservationId',
    v_room_meta ->> 'reservation_id',
    v_room_meta ->> 'bookingId',
    v_room_meta ->> 'booking_id',
    v_room_meta ->> 'guestReservationId'
  );
  v_same_reservation := nullif(v_prev_key,'') IS NOT NULL
    AND nullif(v_current_key,'') IS NOT NULL
    AND v_prev_key = v_current_key;

  -- Never carry yesterday's debt onto a clearly new arrival. When both systems
  -- provide reservation identity, a changed identity also blocks the carry.
  IF lower(coalesce(v_room_meta ->> 'arrivalToday','false')) = 'true'
     AND NOT v_same_reservation THEN
    RETURN v_context;
  END IF;
  IF nullif(v_prev_key,'') IS NOT NULL
     AND nullif(v_current_key,'') IS NOT NULL
     AND NOT v_same_reservation THEN
    RETURN v_context;
  END IF;

  v_service_type := CASE WHEN v_full_clean THEN 'full_clean' ELSE 'towel_change' END;
  v_reason := CASE
    WHEN v_service_result = 'guest_declined' THEN 'no_service'
    WHEN lower(coalesce(v_state ->> 'dnd_active_at_close','false')) = 'true' THEN 'dnd'
    WHEN v_had_dnd THEN 'dnd'
    ELSE 'no_service'
  END;

  v_instruction := CASE
    WHEN v_reason = 'dnd' AND v_service_type = 'full_clean' THEN
      format(
        'Yesterday (%s) this room was DND, so the scheduled full room cleaning (Change Room) was not completed. Please attempt the full cleaning today.',
        v_source_date::text
      )
    WHEN v_reason = 'dnd' THEN
      format(
        'Yesterday (%s) this room was DND, so the scheduled towel change was not completed. Please attempt the towel change today.',
        v_source_date::text
      )
    WHEN v_service_type = 'full_clean' THEN
      format(
        'Yesterday (%s) the guest declined housekeeping (No Service), so the scheduled full room cleaning (Change Room) was not completed. Please attempt the full cleaning today.',
        v_source_date::text
      )
    ELSE
      format(
        'Yesterday (%s) the guest declined housekeeping (No Service), so the scheduled towel change was not completed. Please attempt the towel change today.',
        v_source_date::text
      )
  END;

  RETURN v_context || jsonb_build_object(
    'carry_forward',
    jsonb_build_object(
      'version', 1,
      'active', true,
      'source_business_date', v_source_date::text,
      'service_type', v_service_type,
      'reason', v_reason,
      'instruction', v_instruction
    )
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.hc_memories_previous_service_context(uuid,date,text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hc_memories_previous_service_context(uuid,date,text)
TO service_role;

-- Assignment-time path. The existing "a_hc_attach_previous_day..." trigger runs
-- first alphabetically; this Memories-only trigger then upgrades the context
-- with the missed-service carry when eligible.
CREATE OR REPLACE FUNCTION public.hc_attach_memories_missed_service_carry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_context jsonb;
BEGIN
  IF NEW.assignment_date < DATE '2026-09-26' THEN
    RETURN NEW;
  END IF;

  v_context := public.hc_memories_previous_service_context(
    NEW.room_id,
    NEW.assignment_date,
    NEW.assignment_type::text
  );

  IF v_context IS NOT NULL THEN
    NEW.previous_day_context := v_context;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS b_hc_attach_memories_missed_service_carry
  ON public.room_assignments;
CREATE TRIGGER b_hc_attach_memories_missed_service_carry
BEFORE INSERT OR UPDATE OF assignment_date, room_id, assignment_type
ON public.room_assignments
FOR EACH ROW
EXECUTE FUNCTION public.hc_attach_memories_missed_service_carry();

-- Next-day plans can be created before midnight, when yesterday is not yet
-- finalizable. Refresh only the structured context after the previous business
-- day is finalized; do not touch room flags, notes, DND or work status.
CREATE OR REPLACE FUNCTION public.hc_refresh_memories_missed_service_carry(
  p_assignment_date date DEFAULT (now() AT TIME ZONE 'Europe/Budapest')::date
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_count integer := 0;
BEGIN
  IF p_assignment_date IS NULL OR p_assignment_date < DATE '2026-09-26' THEN
    RETURN 0;
  END IF;

  WITH eligible AS (
    SELECT
      ra.id,
      public.hc_memories_previous_service_context(
        ra.room_id,
        ra.assignment_date,
        ra.assignment_type::text
      ) AS next_context
    FROM public.room_assignments ra
    JOIN public.rooms r ON r.id = ra.room_id
    WHERE ra.assignment_date = p_assignment_date
      AND lower(btrim(coalesce(r.hotel,''))) IN (
        'hotel memories budapest',
        'memories budapest',
        'memories-budapest'
      )
      AND ra.status::text NOT IN ('completed','cancelled')
  )
  UPDATE public.room_assignments ra
  SET previous_day_context = e.next_context,
      updated_at = statement_timestamp()
  FROM eligible e
  WHERE ra.id = e.id
    AND e.next_context IS NOT NULL
    AND ra.previous_day_context IS DISTINCT FROM e.next_context;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$fn$;

REVOKE ALL ON FUNCTION public.hc_refresh_memories_missed_service_carry(date)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hc_refresh_memories_missed_service_carry(date)
TO service_role;

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'hotelcare-memories-missed-service-carry-forward',
      '*/10 * * * *',
      'SELECT public.hc_refresh_memories_missed_service_carry((now() AT TIME ZONE ''Europe/Budapest'')::date);'
    );
  END IF;
END
$cron$;

-- Safe deployment-time backfill. On 2026-09-25 this is a no-op by design.
DO $backfill$
DECLARE
  v_today date := (now() AT TIME ZONE 'Europe/Budapest')::date;
BEGIN
  IF v_today >= DATE '2026-09-26' THEN
    PERFORM public.hc_refresh_memories_missed_service_carry(v_today);
  END IF;
END
$backfill$;
