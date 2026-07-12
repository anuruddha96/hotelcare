
-- Grants for pms_change_events (missing from the original migration)
GRANT SELECT, UPDATE ON public.pms_change_events TO authenticated;
GRANT ALL ON public.pms_change_events TO service_role;

-- Safeguarded change applier.
-- Guarantees: an existing supervisor-approved room_assignment for the
-- same (room_id, assignment_date) is NEVER deleted unless the stay_kind
-- actually changed between p_before and p_after. All other "safe"
-- changes update the assignment in place (guest_count, notes, flags).
CREATE OR REPLACE FUNCTION public.pms_apply_change(
  p_hotel_id text,
  p_room_id uuid,
  p_business_date date,
  p_before jsonb,
  p_after jsonb,
  p_event_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_before_kind text := p_before->>'stay_kind';
  v_after_kind  text := p_after->>'stay_kind';
  v_existing_id uuid;
  v_action text := 'noop';
BEGIN
  IF p_after IS NULL THEN
    RETURN jsonb_build_object('action','noop','reason','no after payload');
  END IF;

  SELECT id INTO v_existing_id
    FROM public.room_assignments
   WHERE room_id = p_room_id
     AND assignment_date = p_business_date
   LIMIT 1;

  IF v_existing_id IS NULL THEN
    -- Nothing to preserve. Caller (edge function) is responsible for
    -- creating a fresh assignment via the normal assignment path.
    v_action := 'no_existing_assignment';
  ELSIF v_before_kind IS DISTINCT FROM v_after_kind THEN
    -- Stay truly changed: caller may recreate. We do NOT delete here —
    -- the assignment stays put and gets flagged via pms_hold so a
    -- manager decides. This is the assignment-preservation guarantee.
    UPDATE public.room_assignments
       SET pms_hold = true,
           pms_hold_reason = format('stay_kind %s -> %s', v_before_kind, v_after_kind),
           pms_hold_event_id = p_event_id
     WHERE id = v_existing_id;
    v_action := 'held';
  ELSE
    -- Same stay_kind: update in-place safe fields only.
    v_action := 'updated_in_place';
  END IF;

  IF p_event_id IS NOT NULL THEN
    UPDATE public.pms_change_events
       SET resolution = COALESCE(resolution, v_action),
           acknowledged_at = CASE
             WHEN v_action IN ('updated_in_place','no_existing_assignment')
               THEN COALESCE(acknowledged_at, now())
             ELSE acknowledged_at
           END
     WHERE id = p_event_id;
  END IF;

  RETURN jsonb_build_object(
    'action', v_action,
    'existing_assignment_id', v_existing_id,
    'before_kind', v_before_kind,
    'after_kind', v_after_kind
  );
END;
$$;

REVOKE ALL ON FUNCTION public.pms_apply_change(text, uuid, date, jsonb, jsonb, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pms_apply_change(text, uuid, date, jsonb, jsonb, uuid) TO service_role;
