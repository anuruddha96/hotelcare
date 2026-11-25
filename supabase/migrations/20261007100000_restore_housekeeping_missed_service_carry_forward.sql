-- Restore and harden missed-service carry-forward after production drift.
--
-- The September carry-forward migrations existed in source control but were not
-- present in the live HotelCare database. This reconciliation migration is
-- intentionally idempotent: it recreates the latest functions/triggers/jobs,
-- keeps room service-cycle flags untouched, and refreshes only open current-day
-- assignment context.

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


-- Portfolio missed-service carry-forward for Hotel Mika Downtown, Hotel
-- Ottofiori and Gozsdu Court Budapest.
--
-- Hotel Memories has its own dedicated implementation in
-- 20260925153000_memories_missed_service_carry_forward.sql and is deliberately
-- excluded here.
--
-- Activation starts on the 2026-09-26 Budapest business date so the live
-- 2026-09-25 housekeeping operation is not rewritten mid-shift.
--
-- Property contract:
--   Mika / Ottofiori: normal daily assignment remains the base workflow; the
--     frozen scheduled Towel / Change Room requirement is overlaid when missed.
--   Gozsdu: no generic daily cleaning. A missed Towel / Complete Textile Change
--     becomes a one-day carried service debt without shifting the underlying
--     Gozsdu 3/5/7/9... stay-service cycle.
--   Checkout, cancellation, no-show, new-arrival / changed-reservation and
--     non-operating Gozsdu inventory always suppress stale carry-forward work.
--
-- The service debt lives in room_assignments.previous_day_context. It never
-- overwrites room notes, manager instructions, DND state or PMS classification.

CREATE OR REPLACE FUNCTION public.hc_portfolio_carry_property_id(p_hotel text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $property$
  SELECT CASE lower(btrim(coalesce(p_hotel,'')))
    WHEN 'mika-downtown' THEN 'mika-downtown'
    WHEN 'hotel mika downtown' THEN 'mika-downtown'
    WHEN 'mika downtown' THEN 'mika-downtown'
    WHEN 'ottofiori' THEN 'ottofiori'
    WHEN 'hotel ottofiori' THEN 'ottofiori'
    WHEN 'gozsdu-court' THEN 'gozsdu-court'
    WHEN 'gozsdu court budapest' THEN 'gozsdu-court'
    ELSE NULL
  END
$property$;

CREATE OR REPLACE FUNCTION public.hc_portfolio_previous_service_carry_payload(
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
  v_room_hotel text;
  v_property text;
  v_room_checkout boolean := false;
  v_room_meta jsonb := '{}'::jsonb;
  v_source_date date;
  v_source_assignment record;
  v_prior_carry jsonb := '{}'::jsonb;
  v_prior_type text;
  v_natural_towel boolean := false;
  v_natural_full boolean := false;
  v_effective_towel boolean := false;
  v_effective_full boolean := false;
  v_service_type text;
  v_service_result text;
  v_had_dnd boolean := false;
  v_had_no_service boolean := false;
  v_reason text;
  v_has_fresh_pms boolean := false;
  v_effective_checkout boolean := false;
  v_prev_meta jsonb := '{}'::jsonb;
  v_prev_key text;
  v_current_key text;
  v_prev_arrival text;
  v_current_arrival text;
  v_same_reservation boolean := false;
  v_original_due_date date;
  v_attempt_count integer := 1;
  v_policy_source text;
  v_service_label text;
  v_action text;
  v_reason_label text;
  v_instruction text;
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

  v_property := public.hc_portfolio_carry_property_id(v_room_hotel);
  IF v_property IS NULL THEN
    RETURN NULL;
  END IF;

  -- Gozsdu has a physical/operational room registry. Never manufacture work for
  -- rooms that the property has marked unavailable, non-guest or otherwise not
  -- operating.
  IF v_property = 'gozsdu-court'
     AND coalesce(v_room_meta #>> '{gozsduAvailability,status}','') <> 'operating' THEN
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

  SELECT ra.*
  INTO v_source_assignment
  FROM public.room_assignments ra
  WHERE ra.room_id = p_room_id
    AND ra.assignment_date = v_source_date
    AND ra.status::text <> 'cancelled'
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
    ra.created_at DESC NULLS LAST,
    ra.id
  LIMIT 1;

  -- Read the prior carry as a scalar as well as the ranked row. Keeping this
  -- independent of the record variable makes repeated carry lineage robust
  -- across schema clients and historical rows where the JSON column was added
  -- after the original assignment was created.
  SELECT coalesce(ra.previous_day_context -> 'carry_forward','{}'::jsonb)
  INTO v_prior_carry
  FROM public.room_assignments ra
  WHERE ra.room_id = p_room_id
    AND ra.assignment_date = v_source_date
    AND ra.status::text <> 'cancelled'
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
    ra.created_at DESC NULLS LAST,
    ra.id
  LIMIT 1;
  IF NOT FOUND THEN
    v_prior_carry := '{}'::jsonb;
  END IF;

  -- Yesterday's frozen instruction is authoritative for the naturally scheduled
  -- service. A carried service from the day before is merged on top so repeated
  -- DND/No Service continues until resolved.
  v_natural_full := lower(coalesce(
    v_state ->> 'linen_change_required_for_assignment',
    v_state ->> 'linen_change_required_at_close',
    'false'
  )) = 'true';
  v_natural_towel := lower(coalesce(
    v_state ->> 'towel_change_required_for_assignment',
    v_state ->> 'towel_change_required_at_close',
    'false'
  )) = 'true';
  v_prior_type := CASE
    WHEN lower(coalesce(v_prior_carry ->> 'active','false')) = 'true'
      THEN v_prior_carry ->> 'service_type'
    ELSE NULL
  END;

  v_effective_full := v_natural_full OR v_prior_type = 'full_clean';
  v_effective_towel := NOT v_effective_full
    AND (v_natural_towel OR v_prior_type = 'towel_change');

  IF NOT v_effective_full AND NOT v_effective_towel THEN
    RETURN NULL;
  END IF;

  -- A previous checkout is not a missed stayover service.
  IF lower(coalesce(v_state ->> 'is_checkout_room_at_close','false')) = 'true' THEN
    RETURN NULL;
  END IF;

  v_service_result := lower(coalesce(
    v_state ->> 'service_result',
    CASE WHEN FOUND THEN v_source_assignment.service_result ELSE NULL END,
    ''
  ));
  v_had_no_service :=
    lower(coalesce(v_state ->> 'had_no_service','false')) = 'true'
    OR v_service_result = 'guest_declined'
    OR (FOUND AND position('[NO_SERVICE]' IN coalesce(v_source_assignment.notes,'')) > 0);
  v_had_dnd :=
    lower(coalesce(v_state ->> 'had_dnd','false')) = 'true'
    OR lower(coalesce(v_state ->> 'dnd_active_at_close','false')) = 'true'
    OR (FOUND AND (
      coalesce(v_source_assignment.is_dnd,false)
      OR coalesce(v_source_assignment.dnd_attempt_count,0) > 0
      OR v_source_assignment.status::text = 'dnd_pending_retry'
    ));

  -- A later successful clean on the same business date resolves an earlier DND.
  IF v_service_result = 'cleaned' OR NOT (v_had_dnd OR v_had_no_service) THEN
    RETURN NULL;
  END IF;

  -- Current-day PMS / reservation authority.
  v_has_fresh_pms :=
    coalesce(v_room_meta ->> 'pmsSyncDate','') = p_assignment_date::text
    OR coalesce(v_room_meta ->> 'lastPmsRefreshDate','') = p_assignment_date::text
    OR coalesce(v_room_meta ->> 'pmsUploadDate','') = p_assignment_date::text;

  v_effective_checkout :=
    v_room_checkout
    OR lower(coalesce(v_room_meta ->> 'scheduledDepartureToday','false')) = 'true'
    OR (NOT v_has_fresh_pms AND coalesce(p_assignment_type,'') = 'checkout_cleaning');

  IF v_effective_checkout
     OR lower(coalesce(v_room_meta ->> 'isNoShow','false')) = 'true'
     OR lower(coalesce(v_room_meta ->> 'isCancelled','false')) = 'true'
     OR lower(coalesce(v_room_meta ->> 'notArrived','false')) = 'true' THEN
    RETURN NULL;
  END IF;

  v_prev_meta := coalesce(v_state -> 'pms_metadata_at_close','{}'::jsonb);
  v_prev_key := coalesce(
    v_prev_meta ->> 'reservationId',
    v_prev_meta ->> 'reservation_id',
    v_prev_meta ->> 'bookingId',
    v_prev_meta ->> 'booking_id',
    v_prev_meta ->> 'guestReservationId'
  );
  v_current_key := coalesce(
    v_room_meta ->> 'reservationId',
    v_room_meta ->> 'reservation_id',
    v_room_meta ->> 'bookingId',
    v_room_meta ->> 'booking_id',
    v_room_meta ->> 'guestReservationId'
  );
  v_prev_arrival := coalesce(v_prev_meta ->> 'arrivalDate', v_prev_meta ->> 'arrival_date');
  v_current_arrival := coalesce(v_room_meta ->> 'arrivalDate', v_room_meta ->> 'arrival_date');

  v_same_reservation :=
    nullif(v_prev_key,'') IS NOT NULL
    AND nullif(v_current_key,'') IS NOT NULL
    AND v_prev_key = v_current_key;

  IF nullif(v_prev_key,'') IS NOT NULL
     AND nullif(v_current_key,'') IS NOT NULL
     AND NOT v_same_reservation THEN
    RETURN NULL;
  END IF;
  IF nullif(v_prev_arrival,'') IS NOT NULL
     AND nullif(v_current_arrival,'') IS NOT NULL
     AND v_prev_arrival IS DISTINCT FROM v_current_arrival THEN
    RETURN NULL;
  END IF;
  IF lower(coalesce(v_room_meta ->> 'arrivalToday','false')) = 'true'
     AND NOT v_same_reservation
     AND (
       nullif(v_prev_arrival,'') IS NULL
       OR nullif(v_current_arrival,'') IS NULL
       OR v_prev_arrival IS DISTINCT FROM v_current_arrival
     ) THEN
    RETURN NULL;
  END IF;

  -- Ottofiori has explicit no-show/replacement-arrival reconciliation. When an
  -- arrival is flagged today and neither reservation ID nor arrival-date
  -- continuity proves the same stay, fail closed instead of showing the old
  -- guest's housekeeping debt to the incoming guest.
  IF v_property = 'ottofiori'
     AND lower(coalesce(v_room_meta ->> 'arrivalToday','false')) = 'true'
     AND NOT v_same_reservation
     AND (
       nullif(v_prev_arrival,'') IS NULL
       OR nullif(v_current_arrival,'') IS NULL
       OR v_prev_arrival IS DISTINCT FROM v_current_arrival
     ) THEN
    RETURN NULL;
  END IF;

  v_service_type := CASE WHEN v_effective_full THEN 'full_clean' ELSE 'towel_change' END;
  v_reason := CASE
    WHEN v_service_result = 'guest_declined' OR (v_had_no_service AND NOT v_had_dnd)
      THEN 'no_service'
    ELSE 'dnd'
  END;

  -- Preserve the original debt across repeated refusals. If a stronger natural
  -- service becomes due (e.g. yesterday's carried towel reaches today's Change
  -- Room date), the stronger service starts a new debt lineage from yesterday.
  IF v_prior_type = v_service_type
     AND coalesce(v_prior_carry ->> 'original_due_date','') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
    v_original_due_date := (v_prior_carry ->> 'original_due_date')::date;
    IF coalesce(v_prior_carry ->> 'attempt_count','') ~ '^[0-9]+$' THEN
      v_attempt_count := greatest(1,(v_prior_carry ->> 'attempt_count')::integer + 1);
    ELSE
      v_attempt_count := 2;
    END IF;
  ELSE
    v_original_due_date := v_source_date;
    v_attempt_count := 1;
  END IF;

  v_policy_source := CASE v_property
    WHEN 'gozsdu-court' THEN 'gozsdu_property_cycle'
    ELSE 'standard_daily_cycle'
  END;
  v_service_label := CASE
    WHEN v_service_type = 'towel_change' THEN 'towel change'
    WHEN v_property = 'gozsdu-court' THEN 'Complete Textile Change'
    ELSE 'full room cleaning (Change Room)'
  END;
  v_action := CASE
    WHEN v_service_type = 'towel_change' THEN 'Please attempt the towel change today.'
    WHEN v_property = 'gozsdu-court' THEN 'Please attempt the Complete Textile Change today.'
    ELSE 'Please attempt the full cleaning today.'
  END;
  v_reason_label := CASE
    WHEN v_reason = 'dnd' THEN 'this room was DND'
    ELSE 'the guest declined housekeeping (No Service)'
  END;

  IF v_attempt_count > 1 THEN
    v_instruction := format(
      '%s remains outstanding. Originally due %s; yesterday (%s) %s, so it was not completed. %s',
      initcap(v_service_label), v_original_due_date::text, v_source_date::text,
      v_reason_label, v_action
    );
  ELSE
    v_instruction := format(
      'Yesterday (%s) %s, so the scheduled %s was not completed. %s',
      v_source_date::text, v_reason_label, v_service_label, v_action
    );
  END IF;

  RETURN jsonb_build_object(
    'version', 1,
    'active', true,
    'property_id', v_property,
    'source_business_date', v_source_date::text,
    'original_due_date', v_original_due_date::text,
    'service_type', v_service_type,
    'reason', v_reason,
    'attempt_count', v_attempt_count,
    'policy_source', v_policy_source,
    'instruction', v_instruction
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.hc_portfolio_previous_service_carry_payload(uuid,date,text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hc_portfolio_previous_service_carry_payload(uuid,date,text)
TO service_role;

CREATE OR REPLACE FUNCTION public.hc_attach_portfolio_missed_service_carry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_property text;
  v_payload jsonb;
BEGIN
  IF NEW.assignment_date < DATE '2026-09-26' THEN
    RETURN NEW;
  END IF;

  SELECT public.hc_portfolio_carry_property_id(r.hotel)
  INTO v_property
  FROM public.rooms r
  WHERE r.id = NEW.room_id;

  IF v_property IS NULL THEN
    RETURN NEW;
  END IF;

  v_payload := public.hc_portfolio_previous_service_carry_payload(
    NEW.room_id,
    NEW.assignment_date,
    NEW.assignment_type::text
  );

  IF v_payload IS NULL THEN
    NEW.previous_day_context := coalesce(NEW.previous_day_context,'{}'::jsonb) - 'carry_forward';
  ELSE
    NEW.previous_day_context := jsonb_set(
      coalesce(NEW.previous_day_context,'{}'::jsonb),
      '{carry_forward}',
      v_payload,
      true
    );
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS c_hc_attach_portfolio_missed_service_carry
  ON public.room_assignments;
CREATE TRIGGER c_hc_attach_portfolio_missed_service_carry
BEFORE INSERT OR UPDATE OF assignment_date, room_id, assignment_type
ON public.room_assignments
FOR EACH ROW
EXECUTE FUNCTION public.hc_attach_portfolio_missed_service_carry();

-- Gozsdu can legitimately have no assignment at all on a no-service cycle day.
-- If yesterday's scheduled service was missed, materialize only that carried
-- work after today's released plan has established the active housekeeper pool.
-- Prefer yesterday's housekeeper if they are working today; otherwise keep the
-- room in the same Gozsdu building when possible, then use the least-loaded
-- current Gozsdu housekeeper. This does not alter the normal Gozsdu cycle.
CREATE OR REPLACE FUNCTION public.hc_materialize_gozsdu_carry_assignments(
  p_assignment_date date DEFAULT (now() AT TIME ZONE 'Europe/Budapest')::date
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_candidate record;
  v_source record;
  v_payload jsonb;
  v_assigned_to uuid;
  v_assigned_by uuid;
  v_building text;
  v_count integer := 0;
BEGIN
  IF p_assignment_date IS NULL OR p_assignment_date < DATE '2026-09-26' THEN
    RETURN 0;
  END IF;

  FOR v_candidate IN
    SELECT r.id, r.organization_slug, r.pms_metadata
    FROM public.rooms r
    WHERE public.hc_portfolio_carry_property_id(r.hotel) = 'gozsdu-court'
      AND coalesce(r.pms_metadata #>> '{gozsduAvailability,status}','') = 'operating'
      AND NOT EXISTS (
        SELECT 1
        FROM public.room_assignments ra
        WHERE ra.room_id = r.id
          AND ra.assignment_date = p_assignment_date
          AND ra.status::text <> 'cancelled'
      )
  LOOP
    v_payload := public.hc_portfolio_previous_service_carry_payload(
      v_candidate.id,
      p_assignment_date,
      'daily_cleaning'
    );
    IF v_payload IS NULL THEN
      CONTINUE;
    END IF;

    SELECT ra.*
    INTO v_source
    FROM public.room_assignments ra
    WHERE ra.room_id = v_candidate.id
      AND ra.assignment_date = p_assignment_date - 1
      AND ra.status::text <> 'cancelled'
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
      ra.created_at DESC NULLS LAST,
      ra.id
    LIMIT 1;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    v_assigned_to := NULL;
    v_assigned_by := NULL;
    v_building := coalesce(v_candidate.pms_metadata #>> '{gozsduAvailability,buildingCode}','');

    -- First choice: yesterday's housekeeper, but only when that user already has
    -- current-day Gozsdu work (evidence they are on today's operational roster).
    SELECT ra.assigned_to, ra.assigned_by
    INTO v_assigned_to, v_assigned_by
    FROM public.room_assignments ra
    JOIN public.rooms rr ON rr.id = ra.room_id
    WHERE ra.assignment_date = p_assignment_date
      AND ra.status::text <> 'cancelled'
      AND public.hc_portfolio_carry_property_id(rr.hotel) = 'gozsdu-court'
      AND ra.assigned_to = v_source.assigned_to
    ORDER BY ra.created_at
    LIMIT 1;

    -- Second choice: least-loaded current housekeeper already working in the
    -- candidate's mapped Gozsdu building.
    IF v_assigned_to IS NULL AND nullif(v_building,'') IS NOT NULL THEN
      SELECT ra.assigned_to
      INTO v_assigned_to
      FROM public.room_assignments ra
      JOIN public.rooms rr ON rr.id = ra.room_id
      WHERE ra.assignment_date = p_assignment_date
        AND ra.status::text <> 'cancelled'
        AND public.hc_portfolio_carry_property_id(rr.hotel) = 'gozsdu-court'
        AND coalesce(rr.pms_metadata #>> '{gozsduAvailability,buildingCode}','') = v_building
      GROUP BY ra.assigned_to
      ORDER BY count(*) ASC, ra.assigned_to::text
      LIMIT 1;
    END IF;

    -- Final choice: least-loaded current Gozsdu housekeeper.
    IF v_assigned_to IS NULL THEN
      SELECT ra.assigned_to
      INTO v_assigned_to
      FROM public.room_assignments ra
      JOIN public.rooms rr ON rr.id = ra.room_id
      WHERE ra.assignment_date = p_assignment_date
        AND ra.status::text <> 'cancelled'
        AND public.hc_portfolio_carry_property_id(rr.hotel) = 'gozsdu-court'
      GROUP BY ra.assigned_to
      ORDER BY count(*) ASC, ra.assigned_to::text
      LIMIT 1;
    END IF;

    IF v_assigned_to IS NULL THEN
      CONTINUE; -- the cron retries once today's plan has created the roster
    END IF;

    SELECT ra.assigned_by
    INTO v_assigned_by
    FROM public.room_assignments ra
    JOIN public.rooms rr ON rr.id = ra.room_id
    WHERE ra.assignment_date = p_assignment_date
      AND ra.status::text <> 'cancelled'
      AND public.hc_portfolio_carry_property_id(rr.hotel) = 'gozsdu-court'
      AND ra.assigned_to = v_assigned_to
      AND ra.assigned_by IS NOT NULL
    ORDER BY ra.created_at
    LIMIT 1;

    v_assigned_by := coalesce(v_assigned_by, v_source.assigned_by);
    IF v_assigned_by IS NULL THEN
      CONTINUE;
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext(v_candidate.id::text || ':' || p_assignment_date::text));

    IF EXISTS (
      SELECT 1 FROM public.room_assignments ra
      WHERE ra.room_id = v_candidate.id
        AND ra.assignment_date = p_assignment_date
        AND ra.status::text <> 'cancelled'
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO public.room_assignments(
      room_id,
      assigned_to,
      assigned_by,
      assignment_date,
      assignment_type,
      status,
      priority,
      estimated_duration,
      notes,
      organization_slug,
      ready_to_clean,
      previous_day_context
    ) VALUES (
      v_candidate.id,
      v_assigned_to,
      v_assigned_by,
      p_assignment_date,
      'daily_cleaning',
      'assigned',
      greatest(coalesce(v_source.priority,1),2),
      coalesce(
        v_source.estimated_duration,
        CASE WHEN v_payload ->> 'service_type' = 'full_clean' THEN 30 ELSE 10 END
      ),
      NULL,
      v_candidate.organization_slug,
      false,
      jsonb_build_object('carry_forward',v_payload)
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$fn$;

REVOKE ALL ON FUNCTION public.hc_materialize_gozsdu_carry_assignments(date)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hc_materialize_gozsdu_carry_assignments(date)
TO service_role;

CREATE OR REPLACE FUNCTION public.hc_refresh_portfolio_missed_service_carry(
  p_assignment_date date DEFAULT (now() AT TIME ZONE 'Europe/Budapest')::date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_updated integer := 0;
  v_created integer := 0;
BEGIN
  IF p_assignment_date IS NULL OR p_assignment_date < DATE '2026-09-26' THEN
    RETURN jsonb_build_object('updated_assignments',0,'gozsdu_carry_assignments_created',0);
  END IF;

  WITH target AS (
    SELECT
      ra.id,
      public.hc_portfolio_previous_service_carry_payload(
        ra.room_id,
        ra.assignment_date,
        ra.assignment_type::text
      ) AS payload
    FROM public.room_assignments ra
    JOIN public.rooms r ON r.id = ra.room_id
    WHERE ra.assignment_date = p_assignment_date
      AND ra.status::text NOT IN ('completed','cancelled')
      AND public.hc_portfolio_carry_property_id(r.hotel) IS NOT NULL
  ),
  desired AS (
    SELECT
      ra.id,
      CASE
        WHEN t.payload IS NULL
          THEN coalesce(ra.previous_day_context,'{}'::jsonb) - 'carry_forward'
        ELSE jsonb_set(
          coalesce(ra.previous_day_context,'{}'::jsonb),
          '{carry_forward}',
          t.payload,
          true
        )
      END AS next_context
    FROM public.room_assignments ra
    JOIN target t ON t.id = ra.id
  )
  UPDATE public.room_assignments ra
  SET previous_day_context = d.next_context,
      updated_at = statement_timestamp()
  FROM desired d
  WHERE ra.id = d.id
    AND coalesce(ra.previous_day_context,'{}'::jsonb) IS DISTINCT FROM d.next_context;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  v_created := public.hc_materialize_gozsdu_carry_assignments(p_assignment_date);

  RETURN jsonb_build_object(
    'updated_assignments',v_updated,
    'gozsdu_carry_assignments_created',v_created
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.hc_refresh_portfolio_missed_service_carry(date)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hc_refresh_portfolio_missed_service_carry(date)
TO service_role;

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'hotelcare-portfolio-missed-service-carry-forward',
      '*/10 * * * *',
      'SELECT public.hc_refresh_portfolio_missed_service_carry((now() AT TIME ZONE ''Europe/Budapest'')::date);'
    );
  END IF;
END
$cron$;

-- Deployment-time refresh is intentionally dormant on 25 September.
DO $backfill$
DECLARE
  v_today date := (now() AT TIME ZONE 'Europe/Budapest')::date;
BEGIN
  IF v_today >= DATE '2026-09-26' THEN
    PERFORM public.hc_refresh_portfolio_missed_service_carry(v_today);
  END IF;
END
$backfill$;


-- ---------------------------------------------------------------------------
-- 2026-10-07 reconciliation upgrade
-- Keep Memories carry-forward alive across repeated DND / No Service days and
-- expose the same original-due/attempt lineage that managers receive elsewhere.
-- ---------------------------------------------------------------------------
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
  v_source_date date;
  v_source_assignment record;
  v_has_source_assignment boolean := false;
  v_prior_carry jsonb := '{}'::jsonb;
  v_prior_type text;
  v_natural_towel boolean := false;
  v_natural_full boolean := false;
  v_effective_towel boolean := false;
  v_effective_full boolean := false;
  v_has_fresh_pms boolean := false;
  v_pms_checkout boolean := false;
  v_effective_checkout boolean := false;
  v_prev_key text;
  v_current_key text;
  v_same_reservation boolean := false;
  v_had_dnd boolean := false;
  v_had_no_service boolean := false;
  v_service_result text;
  v_reason text;
  v_service_type text;
  v_original_due_date date;
  v_attempt_count integer := 1;
  v_instruction text;
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

  SELECT ra.*
  INTO v_source_assignment
  FROM public.room_assignments ra
  WHERE ra.room_id = p_room_id
    AND ra.assignment_date = v_source_date
    AND ra.status::text <> 'cancelled'
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
    ra.created_at DESC NULLS LAST,
    ra.id
  LIMIT 1;
  v_has_source_assignment := FOUND;

  IF v_has_source_assignment THEN
    v_prior_carry := coalesce(v_source_assignment.previous_day_context -> 'carry_forward','{}'::jsonb);
  END IF;

  v_context := jsonb_strip_nulls(
    jsonb_build_object(
      'version', 3,
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

  IF lower(coalesce(v_state ->> 'is_checkout_room_at_close','false')) = 'true' THEN
    RETURN v_context;
  END IF;

  v_natural_full := lower(coalesce(
    v_state ->> 'linen_change_required_for_assignment',
    v_state ->> 'linen_change_required_at_close',
    'false'
  )) = 'true';
  v_natural_towel := lower(coalesce(
    v_state ->> 'towel_change_required_for_assignment',
    v_state ->> 'towel_change_required_at_close',
    'false'
  )) = 'true';

  v_prior_type := CASE
    WHEN lower(coalesce(v_prior_carry ->> 'active','false')) = 'true'
      THEN v_prior_carry ->> 'service_type'
    ELSE NULL
  END;

  v_effective_full := v_natural_full OR v_prior_type = 'full_clean';
  v_effective_towel := NOT v_effective_full
    AND (v_natural_towel OR v_prior_type = 'towel_change');

  IF NOT v_effective_full AND NOT v_effective_towel THEN
    RETURN v_context;
  END IF;

  v_service_result := lower(coalesce(
    v_state ->> 'service_result',
    CASE WHEN v_has_source_assignment THEN v_source_assignment.service_result ELSE NULL END,
    ''
  ));
  v_had_no_service :=
    lower(coalesce(v_state ->> 'had_no_service','false')) = 'true'
    OR v_service_result = 'guest_declined'
    OR (
      v_has_source_assignment
      AND position('[NO_SERVICE]' IN coalesce(v_source_assignment.notes,'')) > 0
    );
  v_had_dnd :=
    lower(coalesce(v_state ->> 'had_dnd','false')) = 'true'
    OR lower(coalesce(v_state ->> 'dnd_active_at_close','false')) = 'true'
    OR (
      v_has_source_assignment
      AND (
        coalesce(v_source_assignment.is_dnd,false)
        OR coalesce(v_source_assignment.dnd_attempt_count,0) > 0
        OR v_source_assignment.status::text = 'dnd_pending_retry'
      )
    );

  -- A successful clean later on the source business date resolves any earlier
  -- DND/No Service encounter and must stop the carry.
  IF v_service_result = 'cleaned' OR NOT (v_had_dnd OR v_had_no_service) THEN
    RETURN v_context;
  END IF;

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

  IF nullif(v_prev_key,'') IS NOT NULL
     AND nullif(v_current_key,'') IS NOT NULL
     AND NOT v_same_reservation THEN
    RETURN v_context;
  END IF;
  IF lower(coalesce(v_room_meta ->> 'arrivalToday','false')) = 'true'
     AND NOT v_same_reservation THEN
    RETURN v_context;
  END IF;

  v_service_type := CASE WHEN v_effective_full THEN 'full_clean' ELSE 'towel_change' END;
  v_reason := CASE
    WHEN v_service_result = 'guest_declined' OR (v_had_no_service AND NOT v_had_dnd)
      THEN 'no_service'
    ELSE 'dnd'
  END;

  IF v_prior_type = v_service_type
     AND coalesce(v_prior_carry ->> 'original_due_date','') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
    v_original_due_date := (v_prior_carry ->> 'original_due_date')::date;
    IF coalesce(v_prior_carry ->> 'attempt_count','') ~ '^[0-9]+$' THEN
      v_attempt_count := greatest(1,(v_prior_carry ->> 'attempt_count')::integer + 1);
    ELSE
      v_attempt_count := 2;
    END IF;
  ELSE
    v_original_due_date := v_source_date;
    v_attempt_count := 1;
  END IF;

  v_instruction := CASE
    WHEN v_attempt_count > 1 AND v_service_type = 'full_clean' THEN
      format(
        'Full room cleaning remains outstanding. Originally due %s; yesterday (%s) it was not completed because of %s. Please attempt the full cleaning today.',
        v_original_due_date::text, v_source_date::text,
        CASE WHEN v_reason = 'dnd' THEN 'DND' ELSE 'No Service' END
      )
    WHEN v_attempt_count > 1 THEN
      format(
        'Towel change remains outstanding. Originally due %s; yesterday (%s) it was not completed because of %s. Please attempt the towel change today.',
        v_original_due_date::text, v_source_date::text,
        CASE WHEN v_reason = 'dnd' THEN 'DND' ELSE 'No Service' END
      )
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
      'version', 2,
      'active', true,
      'property_id', 'memories-budapest',
      'source_business_date', v_source_date::text,
      'original_due_date', v_original_due_date::text,
      'service_type', v_service_type,
      'reason', v_reason,
      'attempt_count', v_attempt_count,
      'policy_source', 'memories_service_cycle',
      'instruction', v_instruction
    )
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.hc_memories_previous_service_context(uuid,date,text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hc_memories_previous_service_context(uuid,date,text)
TO service_role;

-- Reconcile the current Budapest business day immediately after deployment.
-- This mutates only assignment context / creates eligible Gozsdu carry-only
-- assignments; it never rewrites room T/C flags or completed assignments.
DO $reconcile_current_day$
DECLARE
  v_today date := (now() AT TIME ZONE 'Europe/Budapest')::date;
BEGIN
  IF v_today >= DATE '2026-09-26' THEN
    PERFORM public.finalize_housekeeping_business_date(v_today - 1);
    PERFORM public.hc_refresh_memories_missed_service_carry(v_today);
    PERFORM public.hc_refresh_portfolio_missed_service_carry(v_today);
  END IF;
END
$reconcile_current_day$;
