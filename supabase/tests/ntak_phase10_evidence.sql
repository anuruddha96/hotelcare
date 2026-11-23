-- Run only in the disposable NTAK integration fixture.
BEGIN;
INSERT INTO public.ntak_messages(id, hotel_id, organization_slug, environment, kind, ref)
VALUES ('00000000-0000-4000-8000-000000000010','phase10-test','ci','test','start_date','2026-11-23');
INSERT INTO public.ntak_message_evidence(message_id,hotel_id,environment,kind,ref,phase,uzenet_id,sent_at,evidence_day,request_xml,status)
VALUES
('00000000-0000-4000-8000-000000000010','phase10-test','test','start_date','2026-11-23','send','00000000-0000-4000-8000-000000000011',now(),'2026-11-23','<signed/>','BEFOGADVA'),
('00000000-0000-4000-8000-000000000010','phase10-test','test','start_date','2026-11-23','send','00000000-0000-4000-8000-000000000012',now(),'2026-11-23','<signed/>','rejected');
INSERT INTO public.ntak_message_evidence(message_id,hotel_id,environment,kind,ref,phase,uzenet_id,query_id,sent_at,evidence_day,request_xml,status)
VALUES
('00000000-0000-4000-8000-000000000010','phase10-test','test','start_date','2026-11-23','verify','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000013',now(),'2026-11-23','<verify/>','BEFOGADVA'),
('00000000-0000-4000-8000-000000000010','phase10-test','test','start_date','2026-11-23','verify','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000014',now(),'2026-11-23','<verify/>','TELJESEN_SIKERES');
DO $$
BEGIN
  IF (SELECT count(*) FROM public.ntak_message_evidence WHERE hotel_id='phase10-test') <> 4 THEN RAISE EXCEPTION 'Evidence attempts missing'; END IF;
  IF has_table_privilege('authenticated','public.ntak_message_evidence','SELECT')
     OR has_table_privilege('anon','public.ntak_message_evidence','SELECT')
     OR has_table_privilege('authenticated','public.ntak_message_evidence','INSERT')
     OR NOT has_table_privilege('service_role','public.ntak_message_evidence','SELECT')
  THEN RAISE EXCEPTION 'Evidence access control failed'; END IF;
  BEGIN
    DELETE FROM public.ntak_messages WHERE id='00000000-0000-4000-8000-000000000010';
    RAISE EXCEPTION 'Evidence deletion was not restricted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
END $$;
ROLLBACK;
