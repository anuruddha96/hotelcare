-- Reassignment must never inherit a previous housekeeper's completed/approved state.
-- This is intentionally a database-level invariant so every reassignment path
-- (drag/drop, manager controls, future clients) behaves the same way.

CREATE OR REPLACE FUNCTION public.reopen_completed_room_assignment_on_reassign()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Only act when ownership actually changes. Existing assigned work keeps its
  -- current workflow state; in-progress reassignment remains blocked by the UI
  -- and existing application guard.
  IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to
     AND OLD.status = 'completed'::assignment_status THEN
    NEW.status := 'assigned'::assignment_status;
    NEW.started_at := NULL;
    NEW.completed_at := NULL;
    NEW.supervisor_approved := false;
    NEW.supervisor_approved_at := NULL;
    NEW.supervisor_approved_by := NULL;
    NEW.total_break_time_minutes := 0;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reopen_completed_room_assignment_on_reassign
ON public.room_assignments;

CREATE TRIGGER trg_reopen_completed_room_assignment_on_reassign
BEFORE UPDATE OF assigned_to ON public.room_assignments
FOR EACH ROW
EXECUTE FUNCTION public.reopen_completed_room_assignment_on_reassign();

-- A completed/approved room may already have rooms.status='clean' and a
-- last_cleaned_at timestamp. Once the assignment is reopened for a different
-- housekeeper, clear that presentation state as well. This does NOT call the
-- Previo clean-room sync; only the explicit supervisor approval workflow may do
-- that.
CREATE OR REPLACE FUNCTION public.mark_room_dirty_when_completed_assignment_reopens()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to
     AND OLD.status = 'completed'::assignment_status
     AND NEW.status = 'assigned'::assignment_status THEN
    UPDATE public.rooms
    SET status = 'dirty',
        last_cleaned_at = NULL,
        updated_at = now()
    WHERE id = NEW.room_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mark_room_dirty_when_completed_assignment_reopens
ON public.room_assignments;

CREATE TRIGGER trg_mark_room_dirty_when_completed_assignment_reopens
AFTER UPDATE OF assigned_to ON public.room_assignments
FOR EACH ROW
EXECUTE FUNCTION public.mark_room_dirty_when_completed_assignment_reopens();
