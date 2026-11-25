-- Disposable CI PostgreSQL only. Simulate existing push functions without sending any push.
\set ON_ERROR_STOP on
BEGIN;
CREATE TABLE public.ntak_ci_push_log (org text, hotel text, roles text[], payload jsonb);
CREATE OR REPLACE FUNCTION public.hotelcare_push_recipients(_organization_slug text,_hotel_id text,_roles text[])
RETURNS uuid[] LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.ntak_ci_push_log(org,hotel,roles) VALUES (_organization_slug,_hotel_id,_roles);
  RETURN ARRAY['00000000-0000-0000-0000-000000000001'::uuid];
END $$;
CREATE OR REPLACE FUNCTION public.hotelcare_dispatch_push(_user_ids uuid[],_title text,_body text,_url text,_tag text,_event_type text,_data jsonb DEFAULT '{}'::jsonb)
RETURNS bigint LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.ntak_ci_push_log SET payload=_data;
  RETURN 1;
END $$;
\ir ../migrations/20261123235000_ntak_phase9_message_recovery.sql
DO $$
DECLARE parent uuid; child uuid; actor uuid := '00000000-0000-0000-0000-000000000002';
BEGIN
  INSERT INTO public.ntak_messages(hotel_id,organization_slug,environment,kind,ref,request_xml,created_by,override_reason)
  VALUES('phase9-hotel','phase9-org','test','closure','2026-11-20','original',actor,'test certification') RETURNING id INTO parent;
  INSERT INTO public.ntak_daily_closures(hotel_id,organization_slug,closed_day,classification,snapshot,snapshot_hash,message_id,override_by,override_reason)
  VALUES('phase9-hotel','phase9-org','2026-11-20','UJ','{}','hash',parent,actor,'test certification');
  UPDATE public.ntak_messages SET state='accepted',ntak_status='BEFOGADVA' WHERE id=parent;
  IF EXISTS(SELECT 1 FROM public.ntak_ci_push_log) THEN RAISE EXCEPTION 'accepted message must not notify'; END IF;
  UPDATE public.ntak_messages SET state='verified',ntak_status='VIZSGALANDO' WHERE id=parent;
  UPDATE public.ntak_messages SET state='verified',ntak_status='VIZSGALANDO' WHERE id=parent;
  IF (SELECT count(*) FROM public.ntak_ci_push_log) <> 1 THEN RAISE EXCEPTION 'action notification must be sent once'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.ntak_ci_push_log WHERE org='phase9-org' AND hotel='phase9-hotel' AND roles=ARRAY['admin','top_management','top_management_manager'] AND payload->>'messageId'=parent::text) THEN RAISE EXCEPTION 'wrong notification scope'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.ntak_daily_closures WHERE message_id=parent AND override_by=actor AND override_reason='test certification') THEN RAISE EXCEPTION 'override audit missing'; END IF;
  INSERT INTO public.ntak_messages(hotel_id,organization_slug,environment,kind,ref,request_xml,resend_of) VALUES('phase9-hotel','phase9-org','test','closure','2026-11-20','original',parent) RETURNING id INTO child;
  INSERT INTO public.ntak_messages(hotel_id,organization_slug,environment,kind,ref,request_xml,resend_of) VALUES('phase9-hotel','phase9-org','test','closure','2026-11-20','original',parent) ON CONFLICT(resend_of) DO NOTHING;
  IF (SELECT count(*) FROM public.ntak_messages WHERE resend_of=parent) <> 1 THEN RAISE EXCEPTION 'resend must be unique'; END IF;
  IF has_function_privilege('authenticated','public.ntak_notify_message_action()','EXECUTE') THEN RAISE EXCEPTION 'client can invoke notification trigger'; END IF;
  BEGIN
    UPDATE public.ntak_messages SET override_reason=' ' WHERE id=parent;
    RAISE EXCEPTION 'blank override reason accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
ROLLBACK;
