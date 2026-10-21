-- Return an unapproved completion for correction without pretending another
-- assignment was cleaned/approved. Keeps original submission and photos intact.
ALTER TABLE public.room_assignments
  ADD COLUMN IF NOT EXISTS supervisor_review_outcome text,
  ADD COLUMN IF NOT EXISTS supervisor_reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS supervisor_reviewed_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'room_assignments_supervisor_review_outcome_check'
      AND conrelid = 'public.room_assignments'::regclass
  ) THEN
    ALTER TABLE public.room_assignments ADD CONSTRAINT room_assignments_supervisor_review_outcome_check
      CHECK (supervisor_review_outcome IN ('returned_for_correction', 'superseded'));
  END IF;
END;
$$;

-- A new work task renders an earlier unapproved completion stale, regardless
-- of which UI created it. Do not mark the older cleaning as approved.
CREATE OR REPLACE FUNCTION public.dismiss_superseded_housekeeping_approvals()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  UPDATE public.room_assignments old
     SET supervisor_review_outcome = 'superseded',
         supervisor_reviewed_at = now()
   WHERE old.room_id = NEW.room_id
     AND old.assignment_date = NEW.assignment_date
     AND old.id <> NEW.id
     AND (old.created_at, old.id) < (NEW.created_at, NEW.id)
     AND old.status = 'completed'
     AND old.supervisor_approved IS DISTINCT FROM true
     AND old.supervisor_review_outcome IS NULL;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.dismiss_superseded_housekeeping_approvals() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_dismiss_superseded_housekeeping_approvals ON public.room_assignments;
CREATE TRIGGER trg_dismiss_superseded_housekeeping_approvals
AFTER INSERT ON public.room_assignments
FOR EACH ROW EXECUTE FUNCTION public.dismiss_superseded_housekeeping_approvals();

-- Approving a superseded submission can incorrectly mark a room clean while
-- the replacement housekeeper is still working. Enforce the same guard for
-- single-approve, bulk-approve, and clients with an outdated approval screen.
CREATE OR REPLACE FUNCTION public.block_approval_of_superseded_housekeeping()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NEW.supervisor_approved IS TRUE
     AND OLD.supervisor_approved IS DISTINCT FROM TRUE
     AND (
       OLD.supervisor_review_outcome IS NOT NULL
       OR EXISTS (
         SELECT 1 FROM public.room_assignments other
          WHERE other.room_id = OLD.room_id
            AND other.assignment_date = OLD.assignment_date
            AND other.id <> OLD.id
            AND (
              (other.created_at, other.id) > (OLD.created_at, OLD.id)
              OR other.status IN ('assigned', 'in_progress', 'dnd_pending_retry')
            )
       )
     )
  THEN
    RAISE EXCEPTION 'This room has been reassigned. Refresh the approval queue.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.block_approval_of_superseded_housekeeping() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_block_approval_of_superseded_housekeeping ON public.room_assignments;
CREATE TRIGGER trg_block_approval_of_superseded_housekeeping
BEFORE UPDATE OF supervisor_approved ON public.room_assignments
FOR EACH ROW EXECUTE FUNCTION public.block_approval_of_superseded_housekeeping();

-- Reconcile pending approvals already superseded today before this guard existed.
-- Historical completed work/photos remain untouched.
UPDATE public.room_assignments old
   SET supervisor_review_outcome = 'superseded',
       supervisor_reviewed_at = now()
 WHERE old.assignment_date = (now() AT TIME ZONE 'Europe/Budapest')::date
   AND old.status = 'completed'
   AND old.supervisor_approved IS DISTINCT FROM true
   AND old.supervisor_review_outcome IS NULL
   AND EXISTS (
     SELECT 1 FROM public.room_assignments newer
      WHERE newer.room_id = old.room_id
        AND newer.assignment_date = old.assignment_date
        AND newer.id <> old.id
        AND (
          (newer.created_at, newer.id) > (old.created_at, old.id)
          OR newer.status IN ('assigned', 'in_progress', 'dnd_pending_retry')
        )
   );

CREATE OR REPLACE FUNCTION public.return_housekeeping_room_for_recheck(
  p_assignment_id uuid,
  p_assigned_to uuid,
  p_reason text,
  p_evidence_paths text[] DEFAULT '{}'::text[],
  p_new_assignment_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_actor public.profiles%ROWTYPE;
  v_worker public.profiles%ROWTYPE;
  v_old public.room_assignments%ROWTYPE;
  v_room public.rooms%ROWTYPE;
  v_new_id uuid := COALESCE(p_new_assignment_id, gen_random_uuid());
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_photos text[] := COALESCE(p_evidence_paths, '{}'::text[]);
  v_path text;
  v_other_id uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Please sign in again' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_actor FROM public.profiles
   WHERE id = v_user AND deleted_at IS NULL;
  IF NOT FOUND OR v_actor.role::text NOT IN (
     'admin', 'top_management', 'top_management_manager',
     'manager', 'housekeeping_manager', 'supervisor'
  ) THEN
    RAISE EXCEPTION 'Manager permission required' USING ERRCODE = '42501';
  END IF;
  IF p_assigned_to IS NULL OR (v_reason IS NULL AND cardinality(v_photos) = 0) THEN
    RAISE EXCEPTION 'Choose a housekeeper and provide a short note or photos' USING ERRCODE = '22023';
  END IF;
  IF cardinality(v_photos) > 10 THEN
    RAISE EXCEPTION 'Maximum of 10 manager photos' USING ERRCODE = '22023';
  END IF;
  FOREACH v_path IN ARRAY v_photos LOOP
    IF split_part(v_path, '/', 1) <> v_user::text
       OR split_part(v_path, '/', 2) <> v_new_id::text THEN
      RAISE EXCEPTION 'Invalid manager evidence path' USING ERRCODE = '42501';
    END IF;
  END LOOP;

  SELECT * INTO v_old FROM public.room_assignments WHERE id = p_assignment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Approval no longer exists' USING ERRCODE = 'P0002';
  END IF;

  -- Serialize returns and ordinary reassignment operations on the room.
  SELECT * INTO v_room FROM public.rooms WHERE id = v_old.room_id FOR UPDATE;
  IF NOT FOUND OR v_room.organization_slug IS DISTINCT FROM v_actor.organization_slug
      OR v_old.organization_slug IS DISTINCT FROM v_actor.organization_slug
      OR NOT public.user_can_access_hotel(v_user, v_room.hotel) THEN
    RAISE EXCEPTION 'Room is outside your authorized property' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_old FROM public.room_assignments WHERE id = p_assignment_id FOR UPDATE;
  IF v_old.status <> 'completed'
     OR v_old.supervisor_approved IS TRUE
     OR v_old.supervisor_review_outcome IS NOT NULL THEN
    RAISE EXCEPTION 'This approval is no longer pending. Refresh the list.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_worker FROM public.profiles
   WHERE id = p_assigned_to AND deleted_at IS NULL;
  IF NOT FOUND OR v_worker.organization_slug IS DISTINCT FROM v_room.organization_slug
     OR NOT public.user_can_access_hotel(p_assigned_to, v_room.hotel) THEN
    RAISE EXCEPTION 'Housekeeper is not assigned to this property' USING ERRCODE = '42501';
  END IF;

  -- Manual unassign/assign or a second recheck may have already replaced this
  -- submission. Preserve the newer worker's task; dismiss only the stale review.
  SELECT a.id INTO v_other_id FROM public.room_assignments a
   WHERE a.room_id = v_old.room_id
     AND a.assignment_date = v_old.assignment_date
     AND a.id <> v_old.id
     AND (
       (a.created_at, a.id) > (v_old.created_at, v_old.id)
       OR a.status IN ('assigned', 'in_progress', 'dnd_pending_retry')
     )
   ORDER BY a.created_at DESC LIMIT 1;
  IF v_other_id IS NOT NULL THEN
    UPDATE public.room_assignments SET
      supervisor_review_outcome = 'superseded',
      supervisor_reviewed_by = v_user,
      supervisor_reviewed_at = now()
    WHERE id = v_old.id;
    RETURN jsonb_build_object('action', 'already_reassigned', 'assignment_id', v_other_id);
  END IF;

  INSERT INTO public.room_assignments (
    id, room_id, assigned_to, assigned_by, assignment_date,
    assignment_type, estimated_duration, priority, organization_slug,
    ready_to_clean, pms_hold, pms_hold_reason, pms_hold_event_id,
    is_dnd, dnd_marked_at, dnd_marked_by, dnd_attempt_count,
    dnd_first_attempt_at, dnd_retry_unlocked_at,
    manager_instruction_text, manager_instruction_updated_at,
    recheck_photos, notes, status, supervisor_approved
  ) VALUES (
    v_new_id, v_old.room_id, p_assigned_to, v_user, v_old.assignment_date,
    v_old.assignment_type, v_old.estimated_duration, v_old.priority,
    v_old.organization_slug, v_old.ready_to_clean, v_old.pms_hold,
    v_old.pms_hold_reason, v_old.pms_hold_event_id,
    v_old.is_dnd, v_old.dnd_marked_at, v_old.dnd_marked_by,
    v_old.dnd_attempt_count, v_old.dnd_first_attempt_at,
    v_old.dnd_retry_unlocked_at, v_old.manager_instruction_text,
    v_old.manager_instruction_updated_at,
    v_photos,
    format('[SUPERVISOR_RECHECK:%s] %s',
      CASE WHEN p_assigned_to = v_old.assigned_to THEN 'same' ELSE 'handover' END,
      COALESCE(v_reason, 'Please correct the issues shown in the manager photos')),
    'assigned', false
  );

  -- Trigger may have marked it superseded; record the more precise disposition.
  UPDATE public.room_assignments SET
    supervisor_review_outcome = 'returned_for_correction',
    supervisor_reviewed_by = v_user,
    supervisor_reviewed_at = now()
  WHERE id = v_old.id;

  RETURN jsonb_build_object('action', 'reassigned', 'assignment_id', v_new_id);
END;
$$;

REVOKE ALL ON FUNCTION public.return_housekeeping_room_for_recheck(uuid,uuid,text,text[],uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.return_housekeeping_room_for_recheck(uuid,uuid,text,text[],uuid) TO authenticated;
