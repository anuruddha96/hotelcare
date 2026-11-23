-- Work schedule v2: viewing scope, pending changes, change notices, visibility window.
-- Run as a superuser on a scratch database prepared as described in
-- workforce_schedule_v2_fixture.sql (never on a HotelCare database).
-- Everything happens in one transaction that is rolled back.
BEGIN;

INSERT INTO public.organizations (slug) VALUES ('wf2-test') ON CONFLICT DO NOTHING;
INSERT INTO public.profiles (id, organization_slug, role, access_role, assigned_hotel, full_name, preferred_language) VALUES
  ('00000000-0000-4000-8000-000000000001', 'wf2-test', 'top_management', NULL, NULL, 'Top Manager', 'en'),
  ('00000000-0000-4000-8000-000000000002', 'wf2-test', 'housekeeping_manager', NULL, 'gozsdu-court', 'Gozsdu HK Manager', 'hu'),
  ('00000000-0000-4000-8000-000000000003', 'wf2-test', 'manager', 'housekeeping_supervisor', 'memories-budapest', 'Memo Supervisor', 'en'),
  ('00000000-0000-4000-8000-000000000004', 'wf2-test', 'housekeeping', NULL, 'gozsdu-court', 'Gozsdu Housekeeper', 'tl'),
  ('00000000-0000-4000-8000-000000000005', 'wf2-test', 'housekeeping', NULL, 'memories-budapest', 'Memo Housekeeper', 'mn');

SET LOCAL test.uid = '00000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
INSERT INTO public.workforce_staff (id, organization_slug, full_name, hotel_id, profile_id) VALUES
  ('10000000-0000-4000-8000-000000000002', 'wf2-test', 'Gozsdu HK Manager', 'gozsdu-court', '00000000-0000-4000-8000-000000000002'),
  ('10000000-0000-4000-8000-000000000003', 'wf2-test', 'Memo Supervisor', 'memories-budapest', '00000000-0000-4000-8000-000000000003'),
  ('10000000-0000-4000-8000-000000000004', 'wf2-test', 'Gozsdu Housekeeper', 'gozsdu-court', '00000000-0000-4000-8000-000000000004'),
  ('10000000-0000-4000-8000-000000000005', 'wf2-test', 'Memo Housekeeper', 'memories-budapest', '00000000-0000-4000-8000-000000000005');
SELECT public.set_workforce_staff_schedule_live(true);
RESET ROLE;

CREATE TEMP TABLE t (d date) ON COMMIT DROP;
INSERT INTO t VALUES ((date_trunc('month', (timezone('Europe/Budapest', now()))::date) + interval '1 month')::date);
GRANT SELECT ON t TO authenticated;

CREATE FUNCTION pg_temp.check_true(_ok boolean, _what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF _ok IS NOT TRUE THEN RAISE EXCEPTION 'FAILED: %', _what; END IF; RAISE NOTICE 'ok: %', _what; END $$;

-- 1. Viewing scope ------------------------------------------------------------
SET LOCAL test.uid = '00000000-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_true((SELECT count(*) FROM public.workforce_staff) = 4, 'housekeeping manager sees staff of every hotel');
DO $$ BEGIN
  INSERT INTO public.workforce_entries (staff_id, work_date, kind) VALUES ('10000000-0000-4000-8000-000000000005', (SELECT d FROM t), 'work');
  RAISE EXCEPTION 'FAILED: housekeeping manager could plan another hotel';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok: housekeeping manager cannot plan another hotel'; END $$;
RESET ROLE;
SET LOCAL test.uid = '00000000-0000-4000-8000-000000000003';
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_true((SELECT count(*) FROM public.workforce_staff) = 2, 'supervisor sees only the own hotel');
RESET ROLE;

-- 2. First publication: no notices --------------------------------------------
SET LOCAL test.uid = '00000000-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
INSERT INTO public.workforce_entries (staff_id, work_date, kind, start_time, end_time, status) VALUES
  ('10000000-0000-4000-8000-000000000004', (SELECT d FROM t) + 9, 'work', '08:00', '16:00', 'draft'),
  ('10000000-0000-4000-8000-000000000004', (SELECT d FROM t) + 10, 'work', '08:00', '16:00', 'draft'),
  ('10000000-0000-4000-8000-000000000004', (SELECT d FROM t) + 20, 'leave', NULL, NULL, 'draft');
RESET ROLE;
SET LOCAL test.uid = '00000000-0000-4000-8000-000000000004';
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_true(jsonb_array_length(public.workforce_my_schedule((SELECT d FROM t), (SELECT d FROM t) + 27)->'days') = 0, 'drafts are invisible to the employee');
RESET ROLE;
SET LOCAL test.uid = '00000000-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_true(public.workforce_publish((SELECT d FROM t), (SELECT d FROM t) + 27) = 3, 'publish three days');
SELECT pg_temp.check_true((SELECT count(*) FROM public.workforce_change_notices) = 0, 'first publication creates no notices');
RESET ROLE;
-- Later statements run in the same transaction, so move the publication into the past.
UPDATE public.workforce_published_months SET published_at = now() - interval '1 hour';

-- 3. A change to a published day stays private until published -----------------
SET LOCAL test.uid = '00000000-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
INSERT INTO public.workforce_entries (staff_id, work_date, kind, start_time, end_time, status)
VALUES ('10000000-0000-4000-8000-000000000004', (SELECT d FROM t) + 9, 'night', '20:00', '08:00', 'draft')
ON CONFLICT (staff_id, work_date) DO UPDATE SET kind = EXCLUDED.kind, start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time, status = EXCLUDED.status;
SELECT pg_temp.check_true((SELECT published_version->>'start_time' FROM public.workforce_entries WHERE work_date = (SELECT d FROM t) + 9) = '08:00', 'published version kept while the change is pending');
SELECT pg_temp.check_true((SELECT count(*) FROM public.workforce_change_notices) = 0, 'a pending change creates no notice');
RESET ROLE;
SET LOCAL test.uid = '00000000-0000-4000-8000-000000000004';
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_true((SELECT x->>'start_time' FROM jsonb_array_elements(public.workforce_my_schedule((SELECT d FROM t), (SELECT d FROM t) + 27)->'days') x WHERE (x->>'work_date')::date = (SELECT d FROM t) + 9) = '08:00', 'employee still sees the published shift');
RESET ROLE;

-- Typing the old shift again clears the pending change.
SET LOCAL test.uid = '00000000-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
UPDATE public.workforce_entries SET kind = 'work', start_time = '08:00', end_time = '16:00', status = 'draft' WHERE work_date = (SELECT d FROM t) + 9;
SELECT pg_temp.check_true((SELECT status = 'published' AND published_version IS NULL FROM public.workforce_entries WHERE work_date = (SELECT d FROM t) + 9), 'changing back restores the published state');

-- 4. Publishing the change tells the employee ----------------------------------
UPDATE public.workforce_entries SET kind = 'night', start_time = '20:00', end_time = '08:00', status = 'draft' WHERE work_date = (SELECT d FROM t) + 9;
INSERT INTO public.workforce_entries (staff_id, work_date, kind, start_time, end_time, status)
VALUES ('10000000-0000-4000-8000-000000000004', (SELECT d FROM t) + 12, 'work', '08:00', '16:00', 'draft');
SELECT public.workforce_publish((SELECT d FROM t), (SELECT d FROM t) + 27);
SELECT pg_temp.check_true((SELECT count(*) FROM public.workforce_change_notices) = 2, 'two notices: a changed shift and a new shift on a former day off');
SELECT pg_temp.check_true((SELECT before IS NULL AND after->>'start_time' = '08:00' FROM public.workforce_change_notices WHERE work_date = (SELECT d FROM t) + 12), 'former day off is recorded as before = nothing');
SELECT pg_temp.check_true(public.workforce_set_change_reason(ARRAY(SELECT id FROM public.workforce_change_notices), 'Covering a sick colleague') = 2, 'planner adds a reason');
RESET ROLE;
SELECT pg_temp.check_true((SELECT count(*) FROM public.push_log WHERE title = 'Nagbago ang iskedyul mo') = 1, 'one push in the employee''s language');

-- 5. The employee sees and acknowledges ----------------------------------------
SET LOCAL test.uid = '00000000-0000-4000-8000-000000000004';
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_true(jsonb_array_length(public.workforce_my_schedule((SELECT d FROM t), (SELECT d FROM t) + 27)->'changes') = 2, 'employee sees two changes');
SELECT pg_temp.check_true(public.workforce_acknowledge_changes(ARRAY(SELECT id FROM public.workforce_change_notices)) = 2, 'employee acknowledges');
SELECT pg_temp.check_true(jsonb_array_length(public.workforce_my_schedule((SELECT d FROM t), (SELECT d FROM t) + 27)->'changes') = 0, 'nothing left to confirm');
RESET ROLE;
SET LOCAL test.uid = '00000000-0000-4000-8000-000000000005';
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_true((SELECT count(*) FROM public.workforce_change_notices) = 0, 'another employee cannot read the notices');
SELECT pg_temp.check_true((SELECT count(*) FROM public.workforce_entries) = 0, 'another employee cannot read the shifts');
RESET ROLE;

-- 6. Removing a published shift -------------------------------------------------
SET LOCAL test.uid = '00000000-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
DELETE FROM public.workforce_entries WHERE work_date = (SELECT d FROM t) + 10;
SELECT pg_temp.check_true((SELECT after IS NULL AND before->>'kind' = 'work' FROM public.workforce_change_notices WHERE work_date = (SELECT d FROM t) + 10), 'removed shift is announced as now off');
RESET ROLE;

-- 7. Visibility window ----------------------------------------------------------
SET LOCAL test.uid = '00000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT public.set_workforce_staff_visible_days(1);
RESET ROLE;
SET LOCAL test.uid = '00000000-0000-4000-8000-000000000004';
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_true((SELECT jsonb_agg(x->>'kind') FROM jsonb_array_elements(public.workforce_my_schedule((SELECT d FROM t), (SELECT d FROM t) + 27)->'days') x) = '["leave"]'::jsonb, 'outside the window only approved leave is visible');
SELECT pg_temp.check_true((SELECT count(*) FROM public.workforce_entries) = 1, 'row-level security applies the same window');
RESET ROLE;
SET LOCAL test.uid = '00000000-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  PERFORM public.set_workforce_staff_visible_days(14);
  RAISE EXCEPTION 'FAILED: a housekeeping manager changed the window';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok: only HR and top management change the window'; END $$;
RESET ROLE;

ROLLBACK;
