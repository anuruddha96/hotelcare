-- Execute the exact review SQL before these assertions, never against production.
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id='hr-personnel-documents' AND public=false AND file_size_limit=10485760) THEN RAISE EXCEPTION 'Private bucket missing'; END IF;
 IF has_table_privilege('authenticated','public.hr_personnel_documents','SELECT') OR has_table_privilege('anon','public.hr_personnel_documents','SELECT') OR has_table_privilege('authenticated','public.hr_personnel_document_audit','SELECT') THEN RAISE EXCEPTION 'Confidential table directly accessible'; END IF;
END $$;
SET LOCAL ROLE service_role;
INSERT INTO public.hr_personnel_documents(id,staff_id,organization_slug,title,category,original_name,mime_type,size_bytes,object_path,created_by)
VALUES('99000000-0000-0000-0000-000000000020','99000000-0000-0000-0000-000000000010','rdhotels','Fixture','contract','fixture.pdf','application/pdf',100,'rdhotels/fixture','90000000-0000-0000-0000-000000000001');
INSERT INTO storage.objects(bucket_id,name) VALUES('hr-personnel-documents','rdhotels/fixture');
UPDATE public.hr_personnel_documents SET archived_at=now(),archived_by='90000000-0000-0000-0000-000000000001' WHERE id='99000000-0000-0000-0000-000000000020';
DO $$ BEGIN
 IF (SELECT count(*) FROM public.hr_personnel_document_audit WHERE document_id='99000000-0000-0000-0000-000000000020')<>2 THEN RAISE EXCEPTION 'Upload/archive not audited'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.hr_personnel_document_audit WHERE event='upload') OR NOT EXISTS(SELECT 1 FROM public.hr_personnel_document_audit WHERE event='archive') THEN RAISE EXCEPTION 'Audit events missing'; END IF;
 BEGIN
  INSERT INTO public.hr_personnel_documents(id,staff_id,organization_slug,title,category,original_name,mime_type,size_bytes,object_path,created_by) VALUES(gen_random_uuid(),'99000000-0000-0000-0000-000000000010','rdhotels','Bad','contract','bad.exe','application/octet-stream',1,'bad','90000000-0000-0000-0000-000000000001');
  RAISE EXCEPTION 'Invalid MIME accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$
DECLARE actor uuid; target uuid; n integer;
BEGIN
 FOREACH actor IN ARRAY ARRAY['90000000-0000-0000-0000-000000000001'::uuid,'90000000-0000-0000-0000-000000000003'::uuid] LOOP
  PERFORM set_config('request.jwt.claim.sub',actor::text,true);
  IF (SELECT count(*) FROM public.rooms)<>0 OR (SELECT count(*) FROM public.tickets)<>0 THEN RAISE EXCEPTION 'HR can read operational rows'; END IF;
  UPDATE public.rooms SET id=id; GET DIAGNOSTICS n=ROW_COUNT; IF n<>0 THEN RAISE EXCEPTION 'HR updated rooms'; END IF;
  DELETE FROM public.tickets; GET DIAGNOSTICS n=ROW_COUNT; IF n<>0 THEN RAISE EXCEPTION 'HR deleted tickets'; END IF;
  BEGIN INSERT INTO public.rooms DEFAULT VALUES; RAISE EXCEPTION 'HR inserted room'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF (SELECT count(*) FROM storage.objects WHERE bucket_id='hr-personnel-documents')<>0 THEN RAISE EXCEPTION 'HR read private storage directly'; END IF;
  BEGIN INSERT INTO storage.objects(bucket_id,name) VALUES('hr-personnel-documents','unauthorized'); RAISE EXCEPTION 'Direct upload allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM 1 FROM public.hr_personnel_documents; RAISE EXCEPTION 'Direct metadata access allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  FOREACH target IN ARRAY ARRAY['99000000-0000-0000-0000-000000000002'::uuid,'99000000-0000-0000-0000-000000000003'::uuid,'10000000-0000-0000-0000-000000000011'::uuid,actor] LOOP
   BEGIN UPDATE public.workforce_staff SET profile_id=target WHERE id='99000000-0000-0000-0000-000000000010'; RAISE EXCEPTION 'Invalid account linked: %',target; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
  BEGIN UPDATE public.workforce_staff SET profile_id=NULL WHERE id='99000000-0000-0000-0000-000000000011'; RAISE EXCEPTION 'Privileged account detached'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  UPDATE public.workforce_staff SET profile_id='99000000-0000-0000-0000-000000000001' WHERE id='99000000-0000-0000-0000-000000000010';
  GET DIAGNOSTICS n=ROW_COUNT; IF n<>1 THEN RAISE EXCEPTION 'Valid account link failed'; END IF;
  BEGIN UPDATE public.workforce_staff SET profile_id='99000000-0000-0000-0000-000000000001' WHERE id='40000000-0000-0000-0000-000000000020'; RAISE EXCEPTION 'Duplicate link allowed'; EXCEPTION WHEN unique_violation THEN NULL; END;
  UPDATE public.workforce_staff SET profile_id=NULL WHERE id='99000000-0000-0000-0000-000000000010';
 END LOOP;
 PERFORM set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000011',true);
 IF (SELECT count(*) FROM public.rooms)<>1 OR (SELECT count(*) FROM public.tickets)<>1 THEN RAISE EXCEPTION 'Administrator operations regressed'; END IF;
 IF (SELECT count(*) FROM storage.objects WHERE bucket_id='other')<>1 OR (SELECT count(*) FROM storage.objects WHERE bucket_id='hr-personnel-documents')<>0 THEN RAISE EXCEPTION 'Storage scope regression'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
 IF (SELECT count(*) FROM storage.objects WHERE bucket_id='hr-personnel-documents')<>0 THEN RAISE EXCEPTION 'Anonymous private access'; END IF;
 BEGIN PERFORM 1 FROM public.hr_personnel_document_audit; RAISE EXCEPTION 'Anonymous audit access'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;
