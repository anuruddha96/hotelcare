BEGIN;
INSERT INTO public.pms_refresh_queue(hotel_id,status,request_kind)
VALUES ('ottofiori','running','manual');
DO $$ BEGIN
 BEGIN
  INSERT INTO public.pms_refresh_queue(hotel_id,status,request_kind)
  VALUES ('gozsdu-court','running','automatic');
  RAISE EXCEPTION 'Global single-running PMS invariant did not block the second job';
 EXCEPTION WHEN unique_violation THEN NULL;
 END;
 IF (SELECT count(*) FROM public.pms_refresh_queue WHERE status='running')<>1
 THEN RAISE EXCEPTION 'Expected exactly one active PMS worker'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public'
   AND indexname='pms_refresh_queue_own_status_lookup')
 THEN RAISE EXCEPTION 'Manual queue status lookup index missing'; END IF;
END $$;
ROLLBACK;
