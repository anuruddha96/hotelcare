-- 2026-10-22: Repair housekeeping release at Mika Downtown and Gozsdu Court.
-- The 2026-10-21 supervisor-recheck trigger used "old" as a SQL table alias.
-- Inside a trigger function, OLD is also a PL/pgSQL record and caused:
--   ERROR 42702: column reference "old.room_id" is ambiguous
-- Every new room_assignment hit that AFTER INSERT trigger, aborting the
-- daily plan's atomic release. Do NOT disable the stale-approval guard:
-- rename only the SQL alias so historic approval protection remains active.
CREATE OR REPLACE FUNCTION public.dismiss_superseded_housekeeping_approvals()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  UPDATE public.room_assignments AS prior_assignment
     SET supervisor_review_outcome = 'superseded',
         supervisor_reviewed_at = now()
   WHERE prior_assignment.room_id = NEW.room_id
     AND prior_assignment.assignment_date = NEW.assignment_date
     AND prior_assignment.id <> NEW.id
     AND (prior_assignment.created_at, prior_assignment.id) < (NEW.created_at, NEW.id)
     AND prior_assignment.status = 'completed'
     AND prior_assignment.supervisor_approved IS DISTINCT FROM true
     AND prior_assignment.supervisor_review_outcome IS NULL;
  RETURN NEW;
END;
$function$;

-- Keep this SECURITY DEFINER function non-invocable by public clients.
REVOKE ALL ON FUNCTION public.dismiss_superseded_housekeeping_approvals()
  FROM PUBLIC, anon, authenticated;
