-- 1. Stronger trigger: ALWAYS reset started_at to now() on transition into in_progress,
--    and clear any pre-set started_at on rows that are not in_progress.

CREATE OR REPLACE FUNCTION public.guard_room_assignment_started_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Transitioning INTO in_progress: always stamp a fresh server-side start time.
  -- This prevents any stale started_at (carried over from creation, reassignment,
  -- or a previous session) from surviving into the active work window.
  IF NEW.status = 'in_progress' AND (OLD.status IS DISTINCT FROM 'in_progress') THEN
    NEW.started_at := now();
  END IF;

  -- While in_progress, clamp implausible values (bad client clocks, manual edits).
  IF NEW.status = 'in_progress' AND NEW.started_at IS NOT NULL THEN
    IF NEW.started_at < COALESCE(NEW.created_at, now()) - interval '5 minutes'
       OR NEW.started_at > now() + interval '5 minutes' THEN
      NEW.started_at := now();
    END IF;
  END IF;

  -- Moving back OUT of in_progress to 'assigned' (e.g. retrieve/reset): clear started_at
  -- so the next real Start press records a fresh timestamp.
  IF NEW.status = 'assigned' AND OLD.status IS DISTINCT FROM 'assigned' THEN
    NEW.started_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

-- 2. Insert guard: never let a freshly-created (non in_progress) row carry started_at.
CREATE OR REPLACE FUNCTION public.guard_room_assignment_started_at_ins()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'in_progress' THEN
    -- Created directly in_progress: always force fresh now().
    NEW.started_at := now();
  ELSE
    -- Any other status at creation must NOT carry a started_at.
    -- This is the bug source: some flows set started_at at creation time,
    -- which then survives all the way to completion and inflates the duration.
    NEW.started_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_room_assignment_started_at ON public.room_assignments;
CREATE TRIGGER guard_room_assignment_started_at
  BEFORE UPDATE ON public.room_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_room_assignment_started_at();

DROP TRIGGER IF EXISTS guard_room_assignment_started_at_ins ON public.room_assignments;
CREATE TRIGGER guard_room_assignment_started_at_ins
  BEFORE INSERT ON public.room_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_room_assignment_started_at_ins();

-- 3. Targeted data cleanup: today's completed rows where started_at is suspiciously
--    close to created_at (within 10 min). That pattern means started_at was set at
--    creation time, not at the real Start press, producing the false multi-hour
--    durations the manager is seeing. Null it out so the UI shows "Duration N/A"
--    instead of a fake "6h Very Slow" badge.
UPDATE public.room_assignments
SET started_at = NULL
WHERE assignment_date = CURRENT_DATE
  AND status = 'completed'
  AND started_at IS NOT NULL
  AND completed_at IS NOT NULL
  AND started_at <= created_at + interval '10 minutes'
  AND completed_at >= created_at + interval '2 hours';
