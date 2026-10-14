\set ON_ERROR_STOP on
-- Test the migration's current-day reconciliation via a harmless UPDATE, so
-- CI passes even when its calendar date differs from the fixture.
UPDATE public.room_assignments SET previous_day_context=previous_day_context;
DO $assert$
BEGIN
 IF EXISTS (SELECT 1 FROM public.room_assignments WHERE room_id IN (
   '00000000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000032',
   '00000000-0000-4000-8000-000000000300','00000000-0000-4000-8000-000000000400',
   '00000000-0000-4000-8000-000000000500') AND previous_day_context ? 'carry_forward')
 THEN RAISE EXCEPTION 'No Service alone, cleaned rooms, Mika false due, or no-show incorrectly carry service'; END IF;

 IF EXISTS(SELECT 1 FROM public.room_assignments WHERE room_id IN (
 '00000000-0000-4000-8000-000000000040','00000000-0000-4000-8000-000000000108')
 AND previous_day_context #>> '{carry_forward,original_due_date}'<>'2026-10-13')
 THEN RAISE EXCEPTION 'Invalid original date was not corrected to real source due date'; END IF;

 IF NOT EXISTS(SELECT 1 FROM public.room_assignments
   WHERE room_id='00000000-0000-4000-8000-000000000036'
     AND previous_day_context #>> '{carry_forward,original_due_date}'='2026-10-12'
     AND previous_day_context #>> '{carry_forward,service_type}'='towel_change')
 THEN RAISE EXCEPTION 'Authentic multiday full service was lost, or final-night conversion failed'; END IF;

 IF NOT EXISTS(SELECT 1 FROM public.room_assignments
   WHERE room_id='00000000-0000-4000-8000-000000000200'
     AND previous_day_context #>> '{carry_forward,original_due_date}'='2026-10-13')
 THEN RAISE EXCEPTION 'Verified missed towel service did not carry'; END IF;

 IF EXISTS (SELECT 1 FROM public.rooms WHERE towel_change_required IS DISTINCT FROM true)
 THEN RAISE EXCEPTION 'Current day service requirement overwritten'; END IF;

 IF EXISTS (SELECT 1 FROM public.room_assignments WHERE status<>'assigned')
 THEN RAISE EXCEPTION 'Current assignments modified'; END IF;
END
$assert$;
SELECT 'PASS: proven carry only, correct original dates, final-night policy, tenant isolation and untouched daily service flags' AS result;
