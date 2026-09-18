-- Reopen a supervisor-approved room as a NEW assignment for its original
-- housekeeper. The approved submission, photos, notes and timestamps remain
-- unchanged for the historical review. No room, DND, RTC or PMS state is written.
CREATE OR REPLACE FUNCTION public.reopen_approved_room_same_housekeeper(p_assignment_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor public.profiles%ROWTYPE;
  v_old public.room_assignments%ROWTYPE;
  v_room_hotel text;
  v_actor_hotel_id text;
  v_room_hotel_id text;
  v_new_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT p.* INTO v_actor
  FROM public.profiles p
  WHERE p.user_id = auth.uid() OR p.id = auth.uid()
  LIMIT 1;

  IF NOT FOUND OR v_actor.role NOT IN (
    'admin', 'top_management', 'top_management_manager',
    'manager', 'housekeeping_manager'
  ) OR v_actor.organization_slug IS NULL OR v_actor.assigned_hotel IS NULL THEN
    RAISE EXCEPTION 'You do not have permission to reopen rooms for this hotel';
  END IF;

  SELECT a.* INTO v_old
  FROM public.room_assignments a
  WHERE a.id = p_assignment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Room assignment not found';
  END IF;

  SELECT r.hotel INTO v_room_hotel
  FROM public.rooms r
  WHERE r.id = v_old.room_id;

  IF v_room_hotel IS NULL OR v_old.organization_slug IS DISTINCT FROM v_actor.organization_slug THEN
    RAISE EXCEPTION 'This room is outside your current hotel';
  END IF;

  -- Profiles and rooms may use either the hotel_id or the legacy display name.
  SELECT COALESCE(
    (SELECT c.hotel_id FROM public.hotel_configurations c
     WHERE c.hotel_id = v_actor.assigned_hotel OR c.hotel_name = v_actor.assigned_hotel
     LIMIT 1), v_actor.assigned_hotel
  ) INTO v_actor_hotel_id;
  SELECT COALESCE(
    (SELECT c.hotel_id FROM public.hotel_configurations c
     WHERE c.hotel_id = v_room_hotel OR c.hotel_name = v_room_hotel
     LIMIT 1), v_room_hotel
  ) INTO v_room_hotel_id;

  IF v_actor_hotel_id IS DISTINCT FROM v_room_hotel_id THEN
    RAISE EXCEPTION 'This room is outside your current hotel';
  END IF;

  IF v_old.assignment_date IS DISTINCT FROM (now() AT TIME ZONE 'Europe/Budapest')::date
     OR v_old.status <> 'completed'
     OR v_old.supervisor_approved IS DISTINCT FROM TRUE
     OR v_old.assigned_to IS NULL THEN
    RAISE EXCEPTION 'Only a completed, approved assignment from today can be reopened';
  END IF;

  -- Fail closed if someone has already reassigned/reopened the room. This
  -- also prevents a double tap from generating duplicate active assignments.
  IF EXISTS (
    SELECT 1 FROM public.room_assignments current_task
    WHERE current_task.room_id = v_old.room_id
      AND current_task.assignment_date = v_old.assignment_date
      AND current_task.id <> v_old.id
      AND current_task.status IN ('assigned', 'in_progress', 'dnd_pending_retry')
  ) THEN
    RAISE EXCEPTION 'This room already has an active assignment. Refresh before trying again';
  END IF;

  INSERT INTO public.room_assignments (
    room_id, assigned_to, assigned_by, assignment_date, assignment_type,
    estimated_duration, priority, organization_slug, ready_to_clean,
    pms_hold, instruction_snapshot, status, supervisor_approved, notes
  ) VALUES (
    v_old.room_id, v_old.assigned_to, auth.uid(), v_old.assignment_date,
    v_old.assignment_type, v_old.estimated_duration, v_old.priority,
    v_old.organization_slug, v_old.ready_to_clean, v_old.pms_hold,
    v_old.instruction_snapshot, 'assigned', false,
    '[SUPERVISOR_RECHECK:same] Reopened from approved assignment ' || v_old.id::text
  ) RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.reopen_approved_room_same_housekeeper(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reopen_approved_room_same_housekeeper(uuid) TO authenticated;
