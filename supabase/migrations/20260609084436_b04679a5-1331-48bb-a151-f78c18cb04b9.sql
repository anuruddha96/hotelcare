-- Fix: protect room_assignments.started_at from bad client clocks.
-- A BEFORE UPDATE trigger snaps started_at to NOW() whenever it's
-- clearly wrong (null when entering in_progress, before the row was
-- created, or in the future).

CREATE OR REPLACE FUNCTION public.guard_room_assignment_started_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Entering in_progress: ensure started_at exists and is sane.
  IF NEW.status = 'in_progress' AND (OLD.status IS DISTINCT FROM 'in_progress') THEN
    IF NEW.started_at IS NULL
       OR NEW.started_at < COALESCE(NEW.created_at, now()) - interval '5 minutes'
       OR NEW.started_at > now() + interval '5 minutes' THEN
      NEW.started_at := now();
    END IF;
  END IF;

  -- Any update while in_progress: if started_at is implausible, clamp to now().
  IF NEW.status = 'in_progress' AND NEW.started_at IS NOT NULL THEN
    IF NEW.started_at < COALESCE(NEW.created_at, now()) - interval '5 minutes'
       OR NEW.started_at > now() + interval '5 minutes' THEN
      NEW.started_at := now();
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_room_assignment_started_at ON public.room_assignments;
CREATE TRIGGER guard_room_assignment_started_at
  BEFORE UPDATE ON public.room_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_room_assignment_started_at();

-- Same protection on INSERT (in case an assignment is created directly in_progress).
CREATE OR REPLACE FUNCTION public.guard_room_assignment_started_at_ins()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'in_progress' THEN
    IF NEW.started_at IS NULL
       OR NEW.started_at < now() - interval '5 minutes'
       OR NEW.started_at > now() + interval '5 minutes' THEN
      NEW.started_at := now();
    END IF;
  ELSE
    -- Never let a freshly-created (non in_progress) assignment carry a stale start time.
    IF NEW.started_at IS NOT NULL
       AND (NEW.started_at < now() - interval '5 minutes'
            OR NEW.started_at > now() + interval '5 minutes') THEN
      NEW.started_at := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_room_assignment_started_at_ins ON public.room_assignments;
CREATE TRIGGER guard_room_assignment_started_at_ins
  BEFORE INSERT ON public.room_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_room_assignment_started_at_ins();
