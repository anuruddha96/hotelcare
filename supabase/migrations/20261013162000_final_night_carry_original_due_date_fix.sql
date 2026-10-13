-- Correct original due date when new full clean replaces an older towel debt.
CREATE OR REPLACE FUNCTION public.hc_memories_previous_service_context(p_room_id uuid, p_assignment_date date, p_assignment_type text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_final_night_towel_only boolean := false;
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
  v_final_night_towel_only := public.hc_carry_final_night_towel_only(v_room_hotel, v_room_meta, p_assignment_date);
  IF v_final_night_towel_only AND v_service_type = 'full_clean' THEN
    v_service_type := 'towel_change';
  END IF;
  v_reason := CASE
    WHEN v_service_result = 'guest_declined' OR (v_had_no_service AND NOT v_had_dnd)
      THEN 'no_service'
    ELSE 'dnd'
  END;

  -- If yesterday's new full clean superseded an older towel debt, the
  -- downgrade to final-night towel-only must use the full-clean due date,
  -- not falsely claim the Change Room was due on the older towel date.
  IF ((
       v_prior_type = v_service_type
       AND NOT (v_final_night_towel_only AND v_effective_full AND v_prior_type = 'towel_change')
     ) OR (
       v_final_night_towel_only AND v_prior_type = 'full_clean' AND v_service_type = 'towel_change'
     ))
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

  IF v_final_night_towel_only AND v_effective_full THEN
    v_instruction := format('Change Room missed on %s because of %s. Final night before checkout: towel change only today.', v_original_due_date::text, CASE WHEN v_reason='dnd' THEN 'DND' ELSE 'No Service' END);
  END IF;

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
$function$
;
CREATE OR REPLACE FUNCTION public.hc_portfolio_previous_service_carry_payload(p_room_id uuid, p_assignment_date date, p_assignment_type text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_final_night_towel_only boolean := false;
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
  v_final_night_towel_only := public.hc_carry_final_night_towel_only(v_room_hotel, v_room_meta, p_assignment_date);
  IF v_final_night_towel_only AND v_service_type = 'full_clean' THEN
    v_service_type := 'towel_change';
  END IF;
  v_reason := CASE
    WHEN v_service_result = 'guest_declined' OR (v_had_no_service AND NOT v_had_dnd)
      THEN 'no_service'
    ELSE 'dnd'
  END;

  -- Preserve the original debt across repeated refusals. If a stronger natural
  -- service becomes due (e.g. yesterday's carried towel reaches today's Change
  -- Room date), the stronger service starts a new debt lineage from yesterday.
  -- If yesterday's new full clean superseded an older towel debt, the
  -- downgrade to final-night towel-only must use the full-clean due date,
  -- not falsely claim the Change Room was due on the older towel date.
  IF ((
       v_prior_type = v_service_type
       AND NOT (v_final_night_towel_only AND v_effective_full AND v_prior_type = 'towel_change')
     ) OR (
       v_final_night_towel_only AND v_prior_type = 'full_clean' AND v_service_type = 'towel_change'
     ))
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

  IF v_final_night_towel_only AND v_effective_full THEN
    v_instruction := format('%s missed on %s because of %s. Final night before checkout: towel change only today.', CASE WHEN v_property='gozsdu-court' THEN 'Complete Textile Change' ELSE 'Change Room' END, v_original_due_date::text, CASE WHEN v_reason='dnd' THEN 'DND' ELSE 'No Service' END);
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
$function$
;