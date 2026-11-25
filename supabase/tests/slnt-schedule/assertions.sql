-- All data below uses synthetic UUIDs in a disposable PostgreSQL CI service.
-- auth.uid() emulates authenticated JWT sub via the request claim and SET ROLE.
-- RLS is genuinely active; security-definer RPCs execute their actual migration code.
CREATE TEMP TABLE test_ids (name text PRIMARY KEY,id uuid);
INSERT INTO test_ids VALUES
 ('admin','00000000-0000-4000-8000-000000000010'),
 ('manager_a','00000000-0000-4000-8000-000000000011'),
 ('supervisor_a','00000000-0000-4000-8000-000000000012'),
 ('hk_a','00000000-0000-4000-8000-000000000013'),
 ('hk_b','00000000-0000-4000-8000-000000000014'),
 ('rd_admin','00000000-0000-4000-8000-000000000020');
-- Simulate a corrupted privileged import bypassing the new ownership trigger; RLS must still deny it.
BEGIN;
ALTER TABLE public.staff_schedules DISABLE TRIGGER slnt_schedule_identity_guard;
-- As system database owner, create a forged SLNT row belonging to an RD identity.
-- Employee RLS must still reject it even if a privileged import bypasses the guard.
INSERT INTO public.staff_schedules
 (organization_slug,hotel_id,user_id,work_date,shift_start,shift_end,status,created_by)
VALUES
 ('slnt','slnt-group','00000000-0000-4000-8000-000000000020',
  '2026-09-21','09:00','17:00','published','00000000-0000-4000-8000-000000000010');
INSERT INTO public.staff_schedule_venues(schedule_id,venue_id)
SELECT id, '00000000-0000-4000-8000-0000000000a1'::uuid
FROM public.staff_schedules
WHERE user_id='00000000-0000-4000-8000-000000000020' AND organization_slug='slnt';
COMMIT;
-- Re-enable only after the deferred published-venue check has finished.
ALTER TABLE public.staff_schedules ENABLE TRIGGER slnt_schedule_identity_guard;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000010', false);
DO $test$
DECLARE a uuid := '00000000-0000-4000-8000-0000000000a1';
        b uuid := '00000000-0000-4000-8000-0000000000a2';
        hk_a uuid := '00000000-0000-4000-8000-000000000013';
        hk_b uuid := '00000000-0000-4000-8000-000000000014';
        failed boolean := false;
BEGIN
 IF NOT public.can_manage_slnt_schedule('slnt-group') THEN RAISE EXCEPTION 'SLNT admin denied'; END IF;
 PERFORM public.slnt_save_staff_shift('slnt-group',hk_a,'2026-09-21','08:00','16:00',
   'published','hello A',ARRAY[a]);
 PERFORM public.slnt_save_staff_shift('slnt-group',hk_b,'2026-09-22','09:00','17:00',
   'draft','private B',ARRAY[b]);
 IF (SELECT count(*) FROM public.staff_schedules
       WHERE organization_slug='slnt' AND status='published' AND user_id=hk_a) <> 1
 THEN RAISE EXCEPTION 'Admin cannot publish'; END IF;
 IF (SELECT count(*) FROM public.slnt_housekeeping_published_roster('slnt-group','2026-09-21')) <> 1
 THEN RAISE EXCEPTION 'Admin HK published roster incorrect'; END IF;
 IF (SELECT count(*) FROM public.slnt_housekeeping_published_roster('slnt-group','2026-09-22')) <> 0
 THEN RAISE EXCEPTION 'HK roster leaked draft'; END IF;
 BEGIN
   PERFORM public.slnt_save_staff_shift('rd-test',hk_a,'2026-09-21','09:00','17:00','published','',ARRAY[a]);
 EXCEPTION WHEN SQLSTATE '42501' THEN failed := true;
 END;
 IF NOT failed THEN RAISE EXCEPTION 'Admin can write a different tenant'; END IF;
END $test$;

-- Venue-A manager may access A, but not B drafts or B employee mutations.
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000011', false);
DO $test$
DECLARE c integer; denied boolean := false;
BEGIN
 SELECT count(*) INTO c FROM public.staff_schedules WHERE organization_slug='slnt';
 IF c<>1 THEN RAISE EXCEPTION 'Venue-A manager read % shifts, expected 1', c; END IF;
 SELECT count(*) INTO c FROM public.slnt_housekeeping_published_roster('slnt-group','2026-09-21');
 IF c<>1 THEN RAISE EXCEPTION 'Venue-A manager HK roster missing published A'; END IF;
 BEGIN
 PERFORM public.slnt_save_staff_shift(
 'slnt-group','00000000-0000-4000-8000-000000000014',
 '2026-09-22','09:00','17:00','published','injected',
 ARRAY['00000000-0000-4000-8000-0000000000a2'::uuid]);
 EXCEPTION WHEN SQLSTATE '42501' THEN denied := true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Manager can edit employee from another venue'; END IF;
 denied := false;
 BEGIN
 PERFORM public.slnt_save_staff_shift(
 'slnt-group','00000000-0000-4000-8000-000000000013',
 '2026-09-21','08:00','16:00','published','wrong venue',
 ARRAY['00000000-0000-4000-8000-0000000000a2'::uuid]);
 EXCEPTION WHEN SQLSTATE '42501' THEN denied := true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Scoped manager can insert another venue'; END IF;
END $test$;

-- Supervisors are HK published-roster readers, not shift editors.
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000012', false);
DO $test$
DECLARE denied boolean := false; c integer;
BEGIN
 IF public.can_manage_slnt_schedule('slnt-group') THEN RAISE EXCEPTION 'Supervisor can manage shifts'; END IF;
 SELECT count(*) INTO c FROM public.staff_schedules;
 IF c<>0 THEN RAISE EXCEPTION 'Supervisor accessed schedule editor RLS'; END IF;
 SELECT count(*) INTO c FROM public.slnt_housekeeping_published_roster('slnt-group','2026-09-21');
 IF c<>1 THEN RAISE EXCEPTION 'Supervisor cannot see authorized published HK roster'; END IF;
 BEGIN
 PERFORM public.slnt_save_staff_shift(
   'slnt-group','00000000-0000-4000-8000-000000000013',
   '2026-09-23','09:00','17:00','draft','',
   ARRAY['00000000-0000-4000-8000-0000000000a1'::uuid]);
 EXCEPTION WHEN SQLSTATE '42501' THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Supervisor saved an unauthorized schedule'; END IF;
END $test$;

-- A newly created supervisor with no venue scope cannot see the whole property roster.
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000015', false);
DO $test$
DECLARE denied boolean := false;
BEGIN
 BEGIN
 PERFORM public.slnt_housekeeping_published_roster('slnt-group','2026-09-21');
 EXCEPTION WHEN SQLSTATE '42501' THEN denied := true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Unscoped supervisor can read property-wide roster'; END IF;
END $test$;

-- Staff can SELECT only their own published shifts, never colleagues or drafts.
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000013', false);
DO $test$
DECLARE c integer; denied boolean := false;
BEGIN
 SELECT count(*) INTO c FROM public.staff_schedules;
 IF c<>1 THEN RAISE EXCEPTION 'Employee A did not see exactly own published shift: %',c; END IF;
 SELECT count(*) INTO c FROM public.staff_schedule_venues;
 IF c<>1 THEN RAISE EXCEPTION 'Employee A did not see only own published venue'; END IF;
 BEGIN
 PERFORM public.slnt_housekeeping_published_roster('slnt-group','2026-09-21');
 EXCEPTION WHEN SQLSTATE '42501' THEN denied := true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Housekeeper can read team roster'; END IF;
END $test$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000014', false);
DO $test$
BEGIN
 IF (SELECT count(*) FROM public.staff_schedules) <> 0 THEN RAISE EXCEPTION 'Draft leaked to employee B'; END IF;
 IF (SELECT count(*) FROM public.staff_schedule_venues) <> 0 THEN RAISE EXCEPTION 'Draft venue leaked to employee B'; END IF;
END $test$;

-- An RD Hotels account may not read even a forged SLNT row containing its own UUID.
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000020', false);
DO $test$
DECLARE denied boolean := false;
BEGIN
 IF (SELECT count(*) FROM public.staff_schedules) <> 0 THEN RAISE EXCEPTION 'RD account read SLNT schedule'; END IF;
 IF (SELECT count(*) FROM public.staff_schedule_venues) <> 0 THEN RAISE EXCEPTION 'RD account read SLNT venue'; END IF;
 BEGIN
 PERFORM public.slnt_housekeeping_published_roster('slnt-group','2026-09-21');
 EXCEPTION WHEN SQLSTATE '42501' THEN denied := true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'RD account read SLNT HK roster'; END IF;
END $test$;

-- Copy is idempotent and preserves venue links; only the admin can copy all.
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000010', false);
DO $test$
DECLARE data jsonb;
BEGIN
 data := public.slnt_copy_staff_week('slnt-group','2026-09-28');
 IF (data->>'copied')::int<>2 THEN RAISE EXCEPTION 'Copy created wrong number: %',data; END IF;
 IF (SELECT count(*) FROM public.staff_schedules WHERE work_date BETWEEN '2026-09-28' AND '2026-10-04' AND status='draft') <> 2
 THEN RAISE EXCEPTION 'Copied shifts not private drafts'; END IF;
 IF (SELECT count(*) FROM public.staff_schedule_venues link JOIN public.staff_schedules s ON s.id=link.schedule_id
     WHERE s.work_date BETWEEN '2026-09-28' AND '2026-10-04') <> 2
 THEN RAISE EXCEPTION 'Copied venue links incorrect'; END IF;
 data := public.slnt_copy_staff_week('slnt-group','2026-09-28');
 IF (data->>'copied')::int<>0 THEN RAISE EXCEPTION 'Copy overwrote existing shifts'; END IF;
END $test$;
RESET ROLE;
-- Privileged paths must not be able to silently move a SLNT shift to RD or link an RD venue.
DO $test$
DECLARE denied boolean := false; target uuid;
BEGIN
 SELECT id INTO target FROM public.staff_schedules
 WHERE user_id='00000000-0000-4000-8000-000000000013'
 AND work_date='2026-09-21';
 BEGIN
   UPDATE public.staff_schedules SET hotel_id='rd-test' WHERE id=target;
 EXCEPTION WHEN SQLSTATE '23514' THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Privileged UPDATE moved SLNT hotel ownership'; END IF;
 denied:=false;
 BEGIN
   INSERT INTO public.staff_schedule_venues(schedule_id,venue_id)
   VALUES (target,'00000000-0000-4000-8000-0000000000b1');
 EXCEPTION WHEN SQLSTATE '23514' THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Privileged INSERT linked RD venue to SLNT shift'; END IF;
 denied:=false;
 BEGIN
   INSERT INTO public.staff_schedules
     (organization_slug,hotel_id,user_id,work_date,shift_start,shift_end,status,created_by)
   VALUES ('slnt','slnt-group','00000000-0000-4000-8000-000000000020',
       '2026-10-15','09:00','17:00','draft','00000000-0000-4000-8000-000000000010');
 EXCEPTION WHEN SQLSTATE '23514' THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Privileged INSERT created cross-tenant employee shift'; END IF;
END $test$;
SELECT 'SLNT independent PostgreSQL tenant / venue / role security tests passed' AS result;
