BEGIN;
INSERT INTO public.lms_courses(id,organization_slug,slug,title,created_by) VALUES
 ('20000000-0000-0000-0000-000000000001','rdhotels','first','RD course','10000000-0000-0000-0000-000000000001'),
 ('20000000-0000-0000-0000-000000000002','slnt','first','SLNT course','10000000-0000-0000-0000-000000000004'),
 ('20000000-0000-0000-0000-000000000003','rdhotels','draft','RD draft','10000000-0000-0000-0000-000000000001');
INSERT INTO public.lms_course_versions(id,organization_slug,course_id,version_no,title,status,published_at,created_by) VALUES
 ('30000000-0000-0000-0000-000000000001','rdhotels','20000000-0000-0000-0000-000000000001',1,'RD v1','published',now(),'10000000-0000-0000-0000-000000000001'),
 ('30000000-0000-0000-0000-000000000002','slnt','20000000-0000-0000-0000-000000000002',1,'SLNT v1','published',now(),'10000000-0000-0000-0000-000000000004'),
 ('30000000-0000-0000-0000-000000000003','rdhotels','20000000-0000-0000-0000-000000000003',1,'Draft','draft',NULL,'10000000-0000-0000-0000-000000000001');
INSERT INTO public.lms_assignments(id,organization_slug,version_id,employee_id,assigned_by,starts_on,request_key) VALUES
 ('40000000-0000-0000-0000-000000000001','rdhotels','30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001',current_date,gen_random_uuid()),
 ('40000000-0000-0000-0000-000000000002','slnt','30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000004',current_date,gen_random_uuid()),
 ('40000000-0000-0000-0000-000000000003','rdhotels','30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000001',current_date,gen_random_uuid());
INSERT INTO public.lms_attempts(organization_slug,assignment_id,employee_id,attempt_no,status,completed_at) VALUES('rdhotels','40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002',1,'completed',now());
INSERT INTO public.lms_audit_log(organization_slug,actor_id,employee_id,action,entity_id) VALUES('rdhotels','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','assigned','40000000-0000-0000-0000-000000000001');
DO $$ BEGIN
 BEGIN INSERT INTO public.lms_assignments(organization_slug,version_id,employee_id,assigned_by,starts_on,request_key) VALUES('rdhotels','30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001',current_date,gen_random_uuid()); RAISE EXCEPTION 'Cross tenant version accepted'; EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 BEGIN UPDATE public.lms_course_versions SET title='tampered' WHERE status='published'; RAISE EXCEPTION 'Published version changed'; EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN DELETE FROM public.lms_attempts WHERE status='completed'; RAISE EXCEPTION 'Completion removed'; EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN DELETE FROM public.lms_audit_log; RAISE EXCEPTION 'Audit removed'; EXCEPTION WHEN check_violation THEN NULL; END;
 IF has_table_privilege('anon','public.lms_assignments','SELECT') OR has_table_privilege('authenticated','public.lms_assignments','INSERT') OR has_table_privilege('authenticated','public.lms_attempts','UPDATE') THEN RAISE EXCEPTION 'Unsafe grants'; END IF;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
DO $$ BEGIN
 IF (SELECT count(*) FROM public.lms_courses)<>2 OR (SELECT count(*) FROM public.lms_assignments)<>1 OR (SELECT count(*) FROM public.lms_attempts)<>1 OR (SELECT count(*) FROM public.lms_audit_log)<>1 THEN RAISE EXCEPTION 'HR scope incorrect'; END IF;
 IF EXISTS(SELECT 1 FROM public.lms_courses WHERE organization_slug<>'rdhotels') THEN RAISE EXCEPTION 'Foreign course visible'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
DO $$ BEGIN
 IF (SELECT count(*) FROM public.lms_courses)<>1 OR (SELECT count(*) FROM public.lms_course_versions)<>1 OR (SELECT count(*) FROM public.lms_assignments)<>1 OR (SELECT count(*) FROM public.lms_attempts)<>1 OR EXISTS(SELECT 1 FROM public.lms_audit_log) THEN RAISE EXCEPTION 'Learner scope incorrect'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.lms_assignments) OR EXISTS(SELECT 1 FROM public.lms_courses) THEN RAISE EXCEPTION 'Manager gained access before policy approval'; END IF; END $$;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000004',true);
DO $$ BEGIN IF (SELECT count(*) FROM public.lms_courses)<>1 OR (SELECT count(*) FROM public.lms_assignments)<>1 OR EXISTS(SELECT 1 FROM public.lms_attempts) THEN RAISE EXCEPTION 'SLNT scope incorrect'; END IF; END $$;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000007',true);
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.lms_courses) THEN RAISE EXCEPTION 'Deleted HR access'; END IF; END $$;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000008',true);
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.lms_courses) THEN RAISE EXCEPTION 'Inactive tenant access'; END IF; END $$;
RESET ROLE;
UPDATE public.profiles SET organization_slug='slnt' WHERE id='10000000-0000-0000-0000-000000000002';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.lms_assignments) OR EXISTS(SELECT 1 FROM public.lms_attempts) THEN RAISE EXCEPTION 'Transferred employee old evidence visible'; END IF; END $$;
ROLLBACK;
