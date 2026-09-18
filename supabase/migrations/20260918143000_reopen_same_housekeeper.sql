-- Reopen an approved cleaning as a new assignment for the original housekeeper.
-- This operation does not change the original submission, completion photos,
-- notes, the room's DND/RTC status, or any PMS data. It is hotel scoped.
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
  v_room_org text;
  v_actor_hotel_id text;
  v_room_hotel_id text;
  v_new_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT p.* INTO v_actor
  FROM public.profiles p
  WHERE p.id = auth.uid() AND p.deleted_at IS NULL;

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

  -- Lock the shared room row too: simultaneous reopen requests against two
  -- different historical approvals cannot both create an active task.
  SELECT r.hotel, r.organization_slug INTO v_room_hotel, v_room_org
  FROM public.rooms r
  WHERE r.id = v_old.room_id
  FOR UPDATE;

  IF v_room_hotel IS NULL
     OR v_room_org IS DISTINCT FROM v_actor.organization_slug
     OR v_old.organization_slug IS DISTINCT FROM v_actor.organization_slug THEN
    RAISE EXCEPTION 'This room is outside your current hotel';
  END IF;

  -- Profiles and rooms may contain a canonical slug or legacy display name.
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
     OR v_old.supervisor_approved IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Only a completed, approved assignment from today can be reopened';
  END IF;

  -- A later recheck/submission supersedes an older approval, even if the
  -- newer submission has already finished and is awaiting approval.
  IF EXISTS (
    SELECT 1 FROM public.room_assignments current_task
    WHERE current_task.room_id = v_old.room_id
      AND current_task.assignment_date = v_old.assignment_date
      AND current_task.id <> v_old.id
      AND (
        (current_task.created_at, current_task.id) > (v_old.created_at, v_old.id)
        OR current_task.status IN ('assigned', 'in_progress', 'dnd_pending_retry')
      )
  ) THEN
    RAISE EXCEPTION 'A newer or active assignment exists. Refresh before trying again';
  END IF;

  INSERT INTO public.room_assignments (
    room_id, assigned_to, assigned_by, assignment_date, assignment_type,
    estimated_duration, priority, organization_slug, ready_to_clean,
    pms_hold, pms_hold_reason, pms_hold_event_id,
    is_dnd, dnd_marked_at, dnd_marked_by, dnd_attempt_count,
    dnd_first_attempt_at, dnd_retry_unlocked_at,
    manager_instruction_text, manager_instruction_updated_at,
    status, supervisor_approved, notes
  ) VALUES (
    v_old.room_id, v_old.assigned_to, auth.uid(), v_old.assignment_date,
    v_old.assignment_type, v_old.estimated_duration, v_old.priority,
    v_old.organization_slug, v_old.ready_to_clean,
    v_old.pms_hold, v_old.pms_hold_reason, v_old.pms_hold_event_id,
    v_old.is_dnd, v_old.dnd_marked_at, v_old.dnd_marked_by, v_old.dnd_attempt_count,
    v_old.dnd_first_attempt_at, v_old.dnd_retry_unlocked_at,
    v_old.manager_instruction_text, v_old.manager_instruction_updated_at,
    'assigned', false,
    '[SUPERVISOR_RECHECK:same] Reopened from approved assignment ' || v_old.id::text
  ) RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.reopen_approved_room_same_housekeeper(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reopen_approved_room_same_housekeeper(uuid) TO authenticated;
