-- Hotel Memories Budapest: mark a room dirty atomically and reopen approved
-- housekeeping work without rewriting the original completed assignment.
-- A room's clean/dirty status and its housekeeping task are separate states.
CREATE OR REPLACE FUNCTION public.memories_mark_room_dirty(
  p_room_id uuid,
  p_expected_assignment_date date DEFAULT NULL,
  p_source text DEFAULT 'room_operations'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_profile record;
  v_room public.rooms%ROWTYPE;
  v_assignment public.room_assignments%ROWTYPE;
  v_new_assignment_id uuid;
  v_today date := (statement_timestamp() AT TIME ZONE 'Europe/Budapest')::date;
  v_role text;
  v_is_manager boolean;
  v_hotel_id text;
  v_before_status text;
  v_source text := left(COALESCE(NULLIF(btrim(p_source), ''), 'room_operations'), 64);
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication is required.' USING ERRCODE = '42501';
  END IF;
  IF p_expected_assignment_date IS NOT NULL AND p_expected_assignment_date <> v_today THEN
    RAISE EXCEPTION 'Room status can only be changed for today.' USING ERRCODE = '22023';
  END IF;

  SELECT p.role::text AS role, p.organization_slug, COALESCE(p.is_super_admin, false) AS is_super_admin
    INTO v_profile
    FROM public.profiles p
   WHERE p.id = v_actor AND p.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Your staff profile is unavailable.' USING ERRCODE = '42501';
  END IF;

  v_role := v_profile.role;
  v_is_manager := v_profile.is_super_admin OR v_role IN (
    'admin', 'top_management', 'top_management_manager', 'manager',
    'housekeeping_manager', 'supervisor'
  );

  IF NOT v_is_manager AND v_role NOT IN ('housekeeping', 'housekeeper') THEN
    RAISE EXCEPTION 'Only housekeeping staff and supervisors can mark this room dirty.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_room
    FROM public.rooms
   WHERE id = p_room_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Room not found.' USING ERRCODE = 'P0002';
  END IF;
  SELECT c.hotel_id INTO v_hotel_id
    FROM public.hotel_configurations c
   WHERE c.hotel_id = v_room.hotel OR c.hotel_name = v_room.hotel
   LIMIT 1;
  IF v_hotel_id IS DISTINCT FROM 'memories-budapest' THEN
    RAISE EXCEPTION 'This action is only available for Hotel Memories Budapest.' USING ERRCODE = '42501';
  END IF;
  IF NOT v_profile.is_super_admin AND (
    v_room.organization_slug IS DISTINCT FROM v_profile.organization_slug OR
    NOT public.user_can_access_hotel(v_actor, v_room.hotel)
  ) THEN
    RAISE EXCEPTION 'You do not have access to this hotel.' USING ERRCODE = '42501';
  END IF;
  IF v_room.status = 'out_of_order' THEN
    RAISE EXCEPTION 'Release Out of Service before marking the room dirty.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_assignment
    FROM public.room_assignments a
   WHERE a.room_id = v_room.id
     AND a.assignment_date = v_today
   ORDER BY a.created_at DESC, a.id DESC
   LIMIT 1
   FOR UPDATE;

  IF NOT v_is_manager AND (
    v_assignment.id IS NULL OR v_assignment.assigned_to IS DISTINCT FROM v_actor
  ) THEN
    RAISE EXCEPTION 'Housekeepers may only change their own assigned room.' USING ERRCODE = '42501';
  END IF;

  IF v_assignment.id IS NOT NULL
     AND v_assignment.organization_slug IS DISTINCT FROM v_room.organization_slug THEN
    RAISE EXCEPTION 'Assignment belongs to another organization.' USING ERRCODE = '42501';
  END IF;

  IF v_assignment.status = 'completed' AND v_assignment.supervisor_approved IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Cleaning is awaiting supervisor approval. Resolve it before reopening.' USING ERRCODE = '22023';
  END IF;

  v_before_status := v_room.status;
  IF v_assignment.status = 'completed' AND v_assignment.supervisor_approved IS TRUE THEN
    -- A new active task retains the previous approved evidence and audit trail.
    -- Do not reset the original completed assignment or its photos.
    INSERT INTO public.room_assignments (
      room_id, assigned_to, assigned_by, assignment_date, assignment_type,
      estimated_duration, priority, organization_slug,
      ready_to_clean, pms_hold, pms_hold_reason, pms_hold_event_id,
      manager_instruction_text, manager_instruction_updated_at,
      status, supervisor_approved, notes
    ) VALUES (
      v_room.id, v_assignment.assigned_to, v_actor, v_today, v_assignment.assignment_type,
      v_assignment.estimated_duration, v_assignment.priority, v_assignment.organization_slug,
      v_assignment.ready_to_clean, v_assignment.pms_hold,
      v_assignment.pms_hold_reason, v_assignment.pms_hold_event_id,
      v_assignment.manager_instruction_text, v_assignment.manager_instruction_updated_at,
      'assigned', false,
      '[SUPERVISOR_RECHECK:same] Reopened after room marked dirty; original assignment '
        || v_assignment.id::text
    ) RETURNING id INTO v_new_assignment_id;
  END IF;

  IF v_room.status IS DISTINCT FROM 'dirty' THEN
    -- For Memories this existing trigger queues an outbound dirty update for
    -- Previo. No direct client API call is needed, so duplicate pushes are avoided.
    UPDATE public.rooms SET status = 'dirty' WHERE id = v_room.id;
  END IF;

  INSERT INTO public.pms_change_events (
    hotel_id, room_id, room_label, event_type, source,
    before, after, is_conflict, auto_applied
  ) VALUES (
    'memories-budapest', v_room.id, v_room.room_number, 'room_marked_dirty_manual', v_source,
    jsonb_build_object(
      'status', v_before_status,
      'assignment_id', v_assignment.id,
      'assignment_status', v_assignment.status
    ),
    jsonb_build_object(
      'status', 'dirty',
      'assignment_id', COALESCE(v_new_assignment_id, v_assignment.id),
      'assignment_status', CASE WHEN v_new_assignment_id IS NOT NULL THEN 'assigned' ELSE v_assignment.status::text END,
      'actor_id', v_actor,
      'reopened', v_new_assignment_id IS NOT NULL,
      'pms_sync', CASE WHEN v_before_status IS DISTINCT FROM 'dirty' THEN 'queued' ELSE 'unchanged_dirty' END
    ),
    false, false
  );

  RETURN jsonb_build_object(
    'success', true,
    'room_id', v_room.id,
    'status', 'dirty',
    'reopened', v_new_assignment_id IS NOT NULL,
    'assignment_id', COALESCE(v_new_assignment_id, v_assignment.id),
    'ready_to_clean', COALESCE(v_assignment.ready_to_clean, false),
    'pms_queued', v_before_status IS DISTINCT FROM 'dirty'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.memories_mark_room_dirty(uuid, date, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.memories_mark_room_dirty(uuid, date, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.memories_mark_room_dirty(uuid, date, text) TO authenticated;
