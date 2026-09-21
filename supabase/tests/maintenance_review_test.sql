-- Run ONLY against the disposable fixture from maintenance_review_fixture.sql.
\set ON_ERROR_STOP on
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', false);

DO $test$
DECLARE
  denied boolean;
BEGIN
  denied := false;
  BEGIN
    PERFORM public.review_maintenance_completion('00000000-0000-4000-8000-000000000011', 'approve', '', '2026-09-21T10:00:00Z');
  EXCEPTION WHEN SQLSTATE '42501' THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Cross-hotel review was not denied'; END IF;

  denied := false;
  BEGIN
    PERFORM public.review_maintenance_completion('00000000-0000-4000-8000-000000000012', 'approve', '', '2026-09-21T10:00:00Z');
  EXCEPTION WHEN SQLSTATE '42501' THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Cross-organisation review was not denied'; END IF;

  denied := false;
  BEGIN
    PERFORM public.review_maintenance_completion('00000000-0000-4000-8000-000000000010', 'reject', ' ', '2026-09-21T10:00:00Z');
  EXCEPTION WHEN SQLSTATE '22023' THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Empty rejection reason was accepted'; END IF;

  denied := false;
  BEGIN
    PERFORM public.review_maintenance_completion('00000000-0000-4000-8000-000000000013', 'approve', '', '2026-09-21T10:00:00Z');
  EXCEPTION WHEN SQLSTATE '22023' THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Non-pending maintenance was approved'; END IF;

  denied := false;
  BEGIN
    PERFORM public.review_maintenance_completion('00000000-0000-4000-8000-000000000010', 'approve', '', '2026-09-21T09:00:00Z');
  EXCEPTION WHEN SQLSTATE '40001' THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Stale maintenance review was accepted'; END IF;

  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', true);
  denied := false;
  BEGIN
    PERFORM public.review_maintenance_completion('00000000-0000-4000-8000-000000000010', 'approve', '', '2026-09-21T10:00:00Z');
  EXCEPTION WHEN SQLSTATE '42501' THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Maintenance worker could approve own ticket'; END IF;
END;
$test$;

-- Rejection must give the assigned worker rework while preserving the original
-- resolution, reviewer and reason in a durable comment.
SELECT public.review_maintenance_completion(
  '00000000-0000-4000-8000-000000000010', 'reject',
  'The glass is still cracked; replace the entire pane.', '2026-09-21T10:00:00Z'
);
DO $test$
DECLARE t public.tickets%ROWTYPE;
BEGIN
  SELECT * INTO t FROM public.tickets WHERE id='00000000-0000-4000-8000-000000000010';
  IF t.status <> 'in_progress' OR t.pending_supervisor_approval IS DISTINCT FROM false
     OR t.supervisor_approved IS DISTINCT FROM false OR t.resolution_text IS NOT NULL
     OR t.closed_by IS NOT NULL OR t.assigned_to <> '00000000-0000-4000-8000-000000000002' THEN
    RAISE EXCEPTION 'Rejected ticket did not return to the assigned worker safely';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.comments c WHERE c.ticket_id=t.id
       AND c.user_id='00000000-0000-4000-8000-000000000001'
       AND c.organization_slug='rdhotels'
       AND c.content LIKE '%Previous submitted resolution: Mirror replaced%'
       AND c.content LIKE '%glass is still cracked%') THEN
    RAISE EXCEPTION 'Original resolution, reviewer or rejection reason missing from audit';
  END IF;
END;
$test$;

-- A subsequent worker resubmission is approved using a fresh timestamp.
UPDATE public.tickets SET pending_supervisor_approval=true, resolution_text='Mirror fully replaced',
 updated_at='2026-09-21T11:00:00Z' WHERE id='00000000-0000-4000-8000-000000000010';
SELECT public.review_maintenance_completion(
  '00000000-0000-4000-8000-000000000010', 'approve',
  'Checked the glass and tested the fixture.', '2026-09-21T11:00:00Z'
);
DO $test$
DECLARE t public.tickets%ROWTYPE;
BEGIN
  SELECT * INTO t FROM public.tickets WHERE id='00000000-0000-4000-8000-000000000010';
  IF t.status <> 'completed' OR t.pending_supervisor_approval IS DISTINCT FROM false
     OR t.supervisor_approved IS DISTINCT FROM true OR t.supervisor_approved_at IS NULL
     OR t.supervisor_approved_by <> '00000000-0000-4000-8000-000000000001'
     OR t.closed_by <> '00000000-0000-4000-8000-000000000001' OR t.closed_at IS NULL THEN
    RAISE EXCEPTION 'Approved ticket is missing verified closure or reviewer audit';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.comments c WHERE c.ticket_id=t.id
       AND c.content LIKE '[Maintenance review: approve] %') THEN
    RAISE EXCEPTION 'Approval was not saved in durable history';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tickets WHERE id IN
      ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000012')
      AND status='completed') THEN
    RAISE EXCEPTION 'Cross-hotel tickets were mutated';
  END IF;
END;
$test$;
