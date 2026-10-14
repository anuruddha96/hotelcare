-- Housekeeping carry must be proven by a frozen service due on its ORIGINAL
-- business date. No Service/DND alone is NOT a towel-change instruction.
-- Applies to Memories and the portfolio; does not change today's room flags.
CREATE OR REPLACE FUNCTION public.hc_prove_housekeeping_carry_context(
  p_context jsonb,
  p_room_id uuid,
  p_assignment_date date,
  p_assignment_type text,
  p_service_result text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_context jsonb := coalesce(p_context, '{}'::jsonb);
  v_carry jsonb := coalesce(p_context -> 'carry_forward','{}'::jsonb);
  v_source date := p_assignment_date - 1;
  v_due_date date;
  v_source_state jsonb;
  v_due_state jsonb;
  v_source_towel boolean := false;
  v_source_full boolean := false;
  v_due_towel boolean := false;
  v_due_full boolean := false;
  v_due_missed boolean := false;
  v_had_dnd boolean := false;
  v_had_no_service boolean := false;
  v_source_result text;
  v_room_hotel text;
  v_room_meta jsonb;
  v_room_checkout boolean;
  v_final_towel boolean := false;
  v_verified_original boolean := false;
  v_service text;
  v_original date;
  v_reason text;
  v_original_label text;
  v_service_label text;
  v_instruction text;
  v_attempt integer;
  v_previous_due text := v_carry ->> 'original_due_date';
BEGIN
  IF v_carry ->> 'active' IS DISTINCT FROM 'true' THEN RETURN v_context; END IF;

  SELECT r.hotel, coalesce(r.pms_metadata,'{}'::jsonb), coalesce(r.is_checkout_room,false)
  INTO v_room_hotel,v_room_meta,v_room_checkout
  FROM public.rooms r WHERE r.id=p_room_id;

  IF p_assignment_date IS NULL OR p_room_id IS NULL OR v_room_hotel IS NULL
     OR p_assignment_type = 'checkout_cleaning' OR v_room_checkout
     OR lower(coalesce(p_service_result,'')) = 'cleaned'
     OR coalesce(v_room_meta ->> 'isNoShow','false') = 'true'
     OR coalesce(v_room_meta ->> 'isCancelled','false') = 'true'
     OR coalesce(v_room_meta ->> 'notArrived','false') = 'true'
     OR v_carry ->> 'source_business_date' IS DISTINCT FROM v_source::text
  THEN RETURN v_context - 'carry_forward'; END IF;

  SELECT s.final_state INTO v_source_state
  FROM public.housekeeping_room_snapshots s
  WHERE s.room_id=p_room_id AND s.business_date=v_source
    AND s.final_state IS NOT NULL
  ORDER BY s.finalized_at DESC NULLS LAST,s.updated_at DESC NULLS LAST,s.id
  LIMIT 1;
  IF v_source_state IS NULL
     OR coalesce(v_source_state ->> 'is_checkout_room_at_close','false')='true'
  THEN RETURN v_context - 'carry_forward'; END IF;

  v_source_result := lower(coalesce(v_source_state ->> 'service_result',''));
  v_had_no_service := coalesce(v_source_state ->> 'had_no_service','false')='true'
    OR v_source_result='guest_declined';
  v_had_dnd := coalesce(v_source_state ->> 'had_dnd','false')='true'
    OR coalesce(v_source_state ->> 'dnd_active_at_close','false')='true';
  IF v_source_result='cleaned' OR NOT (v_had_no_service OR v_had_dnd)
  THEN RETURN v_context - 'carry_forward'; END IF;

  v_source_full := coalesce(
    (v_source_state ->> 'linen_change_required_for_assignment')::boolean,
    (v_source_state ->> 'linen_change_required_at_close')::boolean, false);
  v_source_towel := coalesce(
    (v_source_state ->> 'towel_change_required_for_assignment')::boolean,
    (v_source_state ->> 'towel_change_required_at_close')::boolean, false);

  -- The previous assignment can carry a service across multiple missed days,
  -- but its original date MUST independently prove that service was due.
  -- For a full clean downgraded on the final night, original full-clean proof
  -- remains valid even though today's action is towel-only.
  IF coalesce(v_previous_due,'') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}
    BEGIN v_due_date := v_previous_due::date;
    EXCEPTION WHEN OTHERS THEN v_due_date := NULL; END;
  END IF;
  IF v_due_date IS NOT NULL AND v_due_date <= v_source AND v_due_date >= DATE '2026-09-26' THEN
    SELECT s.final_state INTO v_due_state
    FROM public.housekeeping_room_snapshots s
    WHERE s.room_id=p_room_id AND s.business_date=v_due_date
      AND s.final_state IS NOT NULL
    ORDER BY s.finalized_at DESC NULLS LAST,s.updated_at DESC NULLS LAST,s.id
    LIMIT 1;
    IF v_due_state IS NOT NULL THEN
      v_due_full := coalesce(
        (v_due_state ->> 'linen_change_required_for_assignment')::boolean,
        (v_due_state ->> 'linen_change_required_at_close')::boolean,false);
      v_due_towel := coalesce(
        (v_due_state ->> 'towel_change_required_for_assignment')::boolean,
        (v_due_state ->> 'towel_change_required_at_close')::boolean,false);
      v_due_missed := coalesce(v_due_state ->> 'is_checkout_room_at_close','false') <> 'true'
        AND coalesce(v_due_state ->> 'service_result','') <> 'cleaned'
        AND (coalesce(v_due_state ->> 'had_dnd','false')='true'
             OR coalesce(v_due_state ->> 'had_no_service','false')='true'
             OR coalesce(v_due_state ->> 'service_result','')='guest_declined');
      v_verified_original := v_due_missed AND (
        (v_carry ->> 'service_type' = 'full_clean' AND v_due_full)
        OR (v_carry ->> 'service_type' = 'towel_change' AND (v_due_towel OR v_due_full))
      );
    END IF;
  END IF;

  v_final_towel := public.hc_carry_final_night_towel_only(v_room_hotel,v_room_meta,p_assignment_date);
  IF v_verified_original THEN
    v_original := v_due_date;
    v_service := CASE WHEN v_due_full AND NOT v_final_towel THEN 'full_clean'
                      ELSE 'towel_change' END;
  ELSIF v_source_full OR v_source_towel THEN
    -- An unproven older carry must not override a genuine service missed
    -- yesterday: restart the lineage from the frozen source business day.
    v_original := v_source;
    v_service := CASE WHEN v_source_full AND NOT v_final_towel THEN 'full_clean'
                      ELSE 'towel_change' END;
  ELSE
    -- Yesterday's No Service without a service due only affects daily
    -- cleaning; leave today's new towel/change-room requirement untouched.
    RETURN v_context - 'carry_forward';
  END IF;

  v_reason := CASE WHEN v_source_result='guest_declined' OR (v_had_no_service AND NOT v_had_dnd)
                   THEN 'no_service' ELSE 'dnd' END;
  v_service_label := CASE WHEN v_service='full_clean' THEN 'Full room change' ELSE 'Towel change' END;
  v_original_label := CASE WHEN v_original=v_source
    THEN 'scheduled yesterday' ELSE 'originally due ' || v_original::text END;
  v_instruction := format('%s %s was not completed because of %s. Please complete it today.',
    v_service_label,v_original_label,
    CASE WHEN v_reason='dnd' THEN 'DND' ELSE 'No Service' END);
  IF v_final_towel AND (v_due_full OR v_source_full) THEN
    v_instruction := format('Full room change originally due %s was missed. Final night before checkout: towel change only today.',v_original::text);
  END IF;

  v_attempt := CASE WHEN v_verified_original AND v_original < v_source
                    THEN greatest(2,CASE WHEN coalesce(v_carry ->> 'attempt_count','') ~ '^[0-9]{1,6}$'
                         THEN (v_carry ->> 'attempt_count')::integer ELSE 1 END)
                    ELSE 1 END;
  RETURN jsonb_set(v_context,'{carry_forward}',
    v_carry || jsonb_build_object(
      'active',true,'version',3,'original_due_date',v_original::text,
      'source_business_date',v_source::text,'service_type',v_service,
      'reason',v_reason,'attempt_count',v_attempt,'instruction',v_instruction
    ),true);
END;
$function$;

REVOKE ALL ON FUNCTION public.hc_prove_housekeeping_carry_context(jsonb,uuid,date,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hc_prove_housekeeping_carry_context(jsonb,uuid,date,text,text) TO service_role;

-- Alphabetic trigger ordering: AFTER the attach_* generators and the
-- existing retire_cleaned trigger. Sanitization cannot be bypassed by another
-- path (auto assignment, manual assignment, staff update or portfolio refresh).
CREATE OR REPLACE FUNCTION public.hc_guard_housekeeping_carry_evidence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NEW.previous_day_context #>> '{carry_forward,active}' = 'true' THEN
    NEW.previous_day_context := public.hc_prove_housekeeping_carry_context(
      NEW.previous_day_context,NEW.room_id,NEW.assignment_date,
      NEW.assignment_type::text,NEW.service_result);
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS zzy_hc_guard_housekeeping_carry_evidence ON public.room_assignments;
CREATE TRIGGER zzy_hc_guard_housekeeping_carry_evidence
BEFORE INSERT OR UPDATE OF previous_day_context,assignment_date,assignment_type,status,service_result
ON public.room_assignments FOR EACH ROW
EXECUTE FUNCTION public.hc_guard_housekeeping_carry_evidence();

-- Repair current unfinished assignments ONLY. Do not recalculate services,
-- reassign staff, change historic snapshots or touch completed work.
UPDATE public.room_assignments
SET previous_day_context=previous_day_context
WHERE assignment_date=(statement_timestamp() AT TIME ZONE 'Europe/Budapest')::date
 AND status::text IN ('assigned','in_progress','dnd_pending_retry')
 AND previous_day_context #>> '{carry_forward,active}' = 'true';
 THEN
    BEGIN v_due_date := v_previous_due::date;
    EXCEPTION WHEN OTHERS THEN v_due_date := NULL; END;
  END IF;
  IF v_due_date IS NOT NULL AND v_due_date <= v_source AND v_due_date >= DATE '2026-09-26' THEN
    SELECT s.final_state INTO v_due_state
    FROM public.housekeeping_room_snapshots s
    WHERE s.room_id=p_room_id AND s.business_date=v_due_date
      AND s.final_state IS NOT NULL
    ORDER BY s.finalized_at DESC NULLS LAST,s.updated_at DESC NULLS LAST,s.id
    LIMIT 1;
    IF v_due_state IS NOT NULL THEN
      v_due_full := coalesce(
        (v_due_state ->> 'linen_change_required_for_assignment')::boolean,
        (v_due_state ->> 'linen_change_required_at_close')::boolean,false);
      v_due_towel := coalesce(
        (v_due_state ->> 'towel_change_required_for_assignment')::boolean,
        (v_due_state ->> 'towel_change_required_at_close')::boolean,false);
      v_due_missed := coalesce(v_due_state ->> 'is_checkout_room_at_close','false') <> 'true'
        AND coalesce(v_due_state ->> 'service_result','') <> 'cleaned'
        AND (coalesce(v_due_state ->> 'had_dnd','false')='true'
             OR coalesce(v_due_state ->> 'had_no_service','false')='true'
             OR coalesce(v_due_state ->> 'service_result','')='guest_declined');
      v_verified_original := v_due_missed AND (
        (v_carry ->> 'service_type' = 'full_clean' AND v_due_full)
        OR (v_carry ->> 'service_type' = 'towel_change' AND (v_due_towel OR v_due_full))
      );
    END IF;
  END IF;

  v_final_towel := public.hc_carry_final_night_towel_only(v_room_hotel,v_room_meta,p_assignment_date);
  IF v_verified_original THEN
    v_original := v_due_date;
    v_service := CASE WHEN v_due_full AND NOT v_final_towel THEN 'full_clean'
                      ELSE 'towel_change' END;
  ELSIF v_source_full OR v_source_towel THEN
    -- An unproven older carry must not override a genuine service missed
    -- yesterday: restart the lineage from the frozen source business day.
    v_original := v_source;
    v_service := CASE WHEN v_source_full AND NOT v_final_towel THEN 'full_clean'
                      ELSE 'towel_change' END;
  ELSE
    -- Yesterday's No Service without a service due only affects daily
    -- cleaning; leave today's new towel/change-room requirement untouched.
    RETURN v_context - 'carry_forward';
  END IF;

  v_reason := CASE WHEN v_source_result='guest_declined' OR (v_had_no_service AND NOT v_had_dnd)
                   THEN 'no_service' ELSE 'dnd' END;
  v_service_label := CASE WHEN v_service='full_clean' THEN 'Full room change' ELSE 'Towel change' END;
  v_original_label := CASE WHEN v_original=v_source
    THEN 'scheduled yesterday' ELSE 'originally due ' || v_original::text END;
  v_instruction := format('%s %s was not completed because of %s. Please complete it today.',
    v_service_label,v_original_label,
    CASE WHEN v_reason='dnd' THEN 'DND' ELSE 'No Service' END);
  IF v_final_towel AND (v_due_full OR v_source_full) THEN
    v_instruction := format('Full room change originally due %s was missed. Final night before checkout: towel change only today.',v_original::text);
  END IF;

  v_attempt := CASE WHEN v_verified_original AND v_original < v_source
                    THEN greatest(2,coalesce(nullif(v_carry ->> 'attempt_count','')::integer,1))
                    ELSE 1 END;
  RETURN jsonb_set(v_context,'{carry_forward}',
    v_carry || jsonb_build_object(
      'active',true,'version',3,'original_due_date',v_original::text,
      'source_business_date',v_source::text,'service_type',v_service,
      'reason',v_reason,'attempt_count',v_attempt,'instruction',v_instruction
    ),true);
END;
$function$;

REVOKE ALL ON FUNCTION public.hc_prove_housekeeping_carry_context(jsonb,uuid,date,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hc_prove_housekeeping_carry_context(jsonb,uuid,date,text,text) TO service_role;

-- Alphabetic trigger ordering: AFTER the attach_* generators and the
-- existing retire_cleaned trigger. Sanitization cannot be bypassed by another
-- path (auto assignment, manual assignment, staff update or portfolio refresh).
CREATE OR REPLACE FUNCTION public.hc_guard_housekeeping_carry_evidence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NEW.previous_day_context #>> '{carry_forward,active}' = 'true' THEN
    NEW.previous_day_context := public.hc_prove_housekeeping_carry_context(
      NEW.previous_day_context,NEW.room_id,NEW.assignment_date,
      NEW.assignment_type::text,NEW.service_result);
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS zzy_hc_guard_housekeeping_carry_evidence ON public.room_assignments;
CREATE TRIGGER zzy_hc_guard_housekeeping_carry_evidence
BEFORE INSERT OR UPDATE OF previous_day_context,assignment_date,assignment_type,status,service_result
ON public.room_assignments FOR EACH ROW
EXECUTE FUNCTION public.hc_guard_housekeeping_carry_evidence();

-- Repair current unfinished assignments ONLY. Do not recalculate services,
-- reassign staff, change historic snapshots or touch completed work.
UPDATE public.room_assignments
SET previous_day_context=previous_day_context
WHERE assignment_date=(statement_timestamp() AT TIME ZONE 'Europe/Budapest')::date
 AND status::text IN ('assigned','in_progress','dnd_pending_retry')
 AND previous_day_context #>> '{carry_forward,active}' = 'true';
 THEN (v_carry ->> 'attempt_count')::integer ELSE 1 END)
                    ELSE 1 END;
  RETURN jsonb_set(v_context,'{carry_forward}',
    v_carry || jsonb_build_object(
      'active',true,'version',3,'original_due_date',v_original::text,
      'source_business_date',v_source::text,'service_type',v_service,
      'reason',v_reason,'attempt_count',v_attempt,'instruction',v_instruction
    ),true);
END;
$function$;

REVOKE ALL ON FUNCTION public.hc_prove_housekeeping_carry_context(jsonb,uuid,date,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hc_prove_housekeeping_carry_context(jsonb,uuid,date,text,text) TO service_role;

-- Alphabetic trigger ordering: AFTER the attach_* generators and the
-- existing retire_cleaned trigger. Sanitization cannot be bypassed by another
-- path (auto assignment, manual assignment, staff update or portfolio refresh).
CREATE OR REPLACE FUNCTION public.hc_guard_housekeeping_carry_evidence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NEW.previous_day_context #>> '{carry_forward,active}' = 'true' THEN
    NEW.previous_day_context := public.hc_prove_housekeeping_carry_context(
      NEW.previous_day_context,NEW.room_id,NEW.assignment_date,
      NEW.assignment_type::text,NEW.service_result);
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS zzy_hc_guard_housekeeping_carry_evidence ON public.room_assignments;
CREATE TRIGGER zzy_hc_guard_housekeeping_carry_evidence
BEFORE INSERT OR UPDATE OF previous_day_context,assignment_date,assignment_type,status,service_result
ON public.room_assignments FOR EACH ROW
EXECUTE FUNCTION public.hc_guard_housekeeping_carry_evidence();

-- Repair current unfinished assignments ONLY. Do not recalculate services,
-- reassign staff, change historic snapshots or touch completed work.
UPDATE public.room_assignments
SET previous_day_context=previous_day_context
WHERE assignment_date=(statement_timestamp() AT TIME ZONE 'Europe/Budapest')::date
 AND status::text IN ('assigned','in_progress','dnd_pending_retry')
 AND previous_day_context #>> '{carry_forward,active}' = 'true';
 THEN
    BEGIN v_due_date := v_previous_due::date;
    EXCEPTION WHEN OTHERS THEN v_due_date := NULL; END;
  END IF;
  IF v_due_date IS NOT NULL AND v_due_date <= v_source AND v_due_date >= DATE '2026-09-26' THEN
    SELECT s.final_state INTO v_due_state
    FROM public.housekeeping_room_snapshots s
    WHERE s.room_id=p_room_id AND s.business_date=v_due_date
      AND s.final_state IS NOT NULL
    ORDER BY s.finalized_at DESC NULLS LAST,s.updated_at DESC NULLS LAST,s.id
    LIMIT 1;
    IF v_due_state IS NOT NULL THEN
      v_due_full := coalesce(
        (v_due_state ->> 'linen_change_required_for_assignment')::boolean,
        (v_due_state ->> 'linen_change_required_at_close')::boolean,false);
      v_due_towel := coalesce(
        (v_due_state ->> 'towel_change_required_for_assignment')::boolean,
        (v_due_state ->> 'towel_change_required_at_close')::boolean,false);
      v_due_missed := coalesce(v_due_state ->> 'is_checkout_room_at_close','false') <> 'true'
        AND coalesce(v_due_state ->> 'service_result','') <> 'cleaned'
        AND (coalesce(v_due_state ->> 'had_dnd','false')='true'
             OR coalesce(v_due_state ->> 'had_no_service','false')='true'
             OR coalesce(v_due_state ->> 'service_result','')='guest_declined');
      v_verified_original := v_due_missed AND (
        (v_carry ->> 'service_type' = 'full_clean' AND v_due_full)
        OR (v_carry ->> 'service_type' = 'towel_change' AND (v_due_towel OR v_due_full))
      );
    END IF;
  END IF;

  v_final_towel := public.hc_carry_final_night_towel_only(v_room_hotel,v_room_meta,p_assignment_date);
  IF v_verified_original THEN
    v_original := v_due_date;
    v_service := CASE WHEN v_due_full AND NOT v_final_towel THEN 'full_clean'
                      ELSE 'towel_change' END;
  ELSIF v_source_full OR v_source_towel THEN
    -- An unproven older carry must not override a genuine service missed
    -- yesterday: restart the lineage from the frozen source business day.
    v_original := v_source;
    v_service := CASE WHEN v_source_full AND NOT v_final_towel THEN 'full_clean'
                      ELSE 'towel_change' END;
  ELSE
    -- Yesterday's No Service without a service due only affects daily
    -- cleaning; leave today's new towel/change-room requirement untouched.
    RETURN v_context - 'carry_forward';
  END IF;

  v_reason := CASE WHEN v_source_result='guest_declined' OR (v_had_no_service AND NOT v_had_dnd)
                   THEN 'no_service' ELSE 'dnd' END;
  v_service_label := CASE WHEN v_service='full_clean' THEN 'Full room change' ELSE 'Towel change' END;
  v_original_label := CASE WHEN v_original=v_source
    THEN 'scheduled yesterday' ELSE 'originally due ' || v_original::text END;
  v_instruction := format('%s %s was not completed because of %s. Please complete it today.',
    v_service_label,v_original_label,
    CASE WHEN v_reason='dnd' THEN 'DND' ELSE 'No Service' END);
  IF v_final_towel AND (v_due_full OR v_source_full) THEN
    v_instruction := format('Full room change originally due %s was missed. Final night before checkout: towel change only today.',v_original::text);
  END IF;

  v_attempt := CASE WHEN v_verified_original AND v_original < v_source
                    THEN greatest(2,coalesce(nullif(v_carry ->> 'attempt_count','')::integer,1))
                    ELSE 1 END;
  RETURN jsonb_set(v_context,'{carry_forward}',
    v_carry || jsonb_build_object(
      'active',true,'version',3,'original_due_date',v_original::text,
      'source_business_date',v_source::text,'service_type',v_service,
      'reason',v_reason,'attempt_count',v_attempt,'instruction',v_instruction
    ),true);
END;
$function$;

REVOKE ALL ON FUNCTION public.hc_prove_housekeeping_carry_context(jsonb,uuid,date,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hc_prove_housekeeping_carry_context(jsonb,uuid,date,text,text) TO service_role;

-- Alphabetic trigger ordering: AFTER the attach_* generators and the
-- existing retire_cleaned trigger. Sanitization cannot be bypassed by another
-- path (auto assignment, manual assignment, staff update or portfolio refresh).
CREATE OR REPLACE FUNCTION public.hc_guard_housekeeping_carry_evidence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NEW.previous_day_context #>> '{carry_forward,active}' = 'true' THEN
    NEW.previous_day_context := public.hc_prove_housekeeping_carry_context(
      NEW.previous_day_context,NEW.room_id,NEW.assignment_date,
      NEW.assignment_type::text,NEW.service_result);
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS zzy_hc_guard_housekeeping_carry_evidence ON public.room_assignments;
CREATE TRIGGER zzy_hc_guard_housekeeping_carry_evidence
BEFORE INSERT OR UPDATE OF previous_day_context,assignment_date,assignment_type,status,service_result
ON public.room_assignments FOR EACH ROW
EXECUTE FUNCTION public.hc_guard_housekeeping_carry_evidence();

-- Repair current unfinished assignments ONLY. Do not recalculate services,
-- reassign staff, change historic snapshots or touch completed work.
UPDATE public.room_assignments
SET previous_day_context=previous_day_context
WHERE assignment_date=(statement_timestamp() AT TIME ZONE 'Europe/Budapest')::date
 AND status::text IN ('assigned','in_progress','dnd_pending_retry')
 AND previous_day_context #>> '{carry_forward,active}' = 'true';
