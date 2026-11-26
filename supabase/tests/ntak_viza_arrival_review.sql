-- Disposable CI only: load base + activation fixtures before this script.
-- Exact production gender/stay state/arrival state checks read from pg_constraint.
ALTER TABLE public.guests ADD COLUMN nationality text,ADD COLUMN date_of_birth date,ADD COLUMN birth_place text,ADD COLUMN gender text,ADD COLUMN id_document_type text,ADD COLUMN id_document_number text;
ALTER TABLE public.guests ADD CONSTRAINT guests_gender_check CHECK (gender IS NULL OR gender=ANY(ARRAY['male','female','other']));
ALTER TABLE public.reservation_guests ADD CONSTRAINT reservation_guests_stay_state_check CHECK (stay_state=ANY(ARRAY['expected','in_house','departed','void']));
ALTER TABLE public.viza_guest_events ADD CONSTRAINT viza_guest_events_arrival_state_check CHECK(arrival_state=ANY(ARRAY['queued','sent','failed','blocked']));
ALTER TABLE public.viza_guest_events ADD CONSTRAINT viza_guest_events_departure_state_check CHECK(departure_state IS NULL OR departure_state=ANY(ARRAY['queued','sent','failed']));
-- Isolate the legacy check-in delegate; assert the production wrapper guards it.
CREATE FUNCTION public.pms_check_in_phase2(uuid,timestamptz,uuid[],uuid,boolean) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{"ok":true}'::jsonb $$;
\ir ../migrations/20261124010200_viza_arrival_mandatory_data.sql
INSERT INTO public.profiles(id,role,organization_slug) VALUES('00000000-0000-4000-8000-000000000091','reception','fixture');
INSERT INTO public.hotel_access VALUES('00000000-0000-4000-8000-000000000091','viza-hotel');
INSERT INTO public.viza_settings(hotel_id,organization_slug,enabled,adatszolgaltatasi_azonosito) VALUES('viza-hotel','fixture',true,'TEST0001');
INSERT INTO public.guests(id,first_name,last_name,hotel_id,nationality,date_of_birth,birth_place,gender,id_document_type,id_document_number) VALUES
('00000000-0000-4000-8000-000000000092','Adult','Missing','viza-hotel','HU','1990-01-01','Budapest','male',null,null),
('00000000-0000-4000-8000-000000000093','Minor','Complete','viza-hotel','HU',(current_date-interval '10 years')::date,'Budapest','female',null,null);
INSERT INTO public.reservations(id,hotel_id,organization_slug,guest_id,check_in_date,check_out_date) VALUES
('00000000-0000-4000-8000-000000000094','viza-hotel','fixture','00000000-0000-4000-8000-000000000092',current_date,current_date+1);
INSERT INTO public.reservation_guests(reservation_id,guest_id) VALUES
('00000000-0000-4000-8000-000000000094','00000000-0000-4000-8000-000000000092'),
('00000000-0000-4000-8000-000000000094','00000000-0000-4000-8000-000000000093');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000091',false);
DO $$ BEGIN
 BEGIN
 PERFORM public.pms_check_in('00000000-0000-4000-8000-000000000094',NULL,NULL,NULL,true);
 RAISE EXCEPTION 'Incomplete adult admitted through legacy override';
 EXCEPTION WHEN raise_exception THEN
 IF SQLERRM NOT LIKE 'VIZA_GUEST_DATA_INCOMPLETE:%id_document_type%id_document_number%' THEN RAISE; END IF;
 END;
END $$;
INSERT INTO public.ntak_settings(hotel_id,organization_slug,enabled) VALUES('viza-hotel','fixture',true);
DO $$ BEGIN
 BEGIN
 PERFORM public.pms_guest_transition('00000000-0000-4000-8000-000000000094','arrive',ARRAY['00000000-0000-4000-8000-000000000092'::uuid],NULL,NULL,false,true);
 RAISE EXCEPTION 'Incomplete selected adult admitted through guest override';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'VIZA_GUEST_DATA_INCOMPLETE:%' THEN RAISE; END IF; END;
 -- Minor does not need a document. This calls the same shared guard.
 PERFORM public.pms_assert_viza_arrival_data('00000000-0000-4000-8000-000000000094',ARRAY['00000000-0000-4000-8000-000000000093'::uuid],current_date);
END $$;
UPDATE public.ntak_settings SET enabled=false;
UPDATE public.guests SET id_document_type='other',id_document_number='TEST-OTHER' WHERE id='00000000-0000-4000-8000-000000000092';
SELECT public.pms_check_in('00000000-0000-4000-8000-000000000094',NULL,NULL,NULL,true);
UPDATE public.guests SET id_document_number=NULL WHERE id='00000000-0000-4000-8000-000000000092';
UPDATE public.viza_settings SET adatszolgaltatasi_azonosito=NULL;
SELECT public.pms_check_in('00000000-0000-4000-8000-000000000094',NULL,NULL,NULL,true);
DO $$ BEGIN
 IF public.pms_viza_registration_required('00000000-0000-4000-8000-000000000094') THEN RAISE EXCEPTION 'Unregistered hotel incorrectly requires VIZA data'; END IF;
END $$;
UPDATE public.viza_settings SET adatszolgaltatasi_azonosito='TEST0001',enabled=false;
SELECT public.pms_check_in('00000000-0000-4000-8000-000000000094',NULL,NULL,NULL,true);
INSERT INTO public.viza_guest_events(hotel_id,organization_slug,reservation_id,guest_id,arrival_state,tavozas_ideje)
VALUES('viza-hotel','fixture','00000000-0000-4000-8000-000000000094','00000000-0000-4000-8000-000000000092','failed',now());
UPDATE public.viza_guest_events SET arrival_state='sent';
DO $$ BEGIN
 IF (SELECT departure_state FROM public.viza_guest_events) IS DISTINCT FROM 'queued' THEN RAISE EXCEPTION 'Repaired arrival stranded departure'; END IF;
END $$;

-- New document-aware guard on the same disposable fixture.
ALTER TABLE public.guests ADD COLUMN IF NOT EXISTS birth_last_name text,
 ADD COLUMN IF NOT EXISTS birth_first_name text, ADD COLUMN IF NOT EXISTS visa_number text,
 ADD COLUMN IF NOT EXISTS entry_date date, ADD COLUMN IF NOT EXISTS entry_place text,
 ADD COLUMN IF NOT EXISTS document_scan jsonb, ADD COLUMN IF NOT EXISTS mother_name text;
UPDATE public.guests SET mother_name=CASE WHEN last_name='Missing' THEN 'Legacy Mother' ELSE 'Compound Family Mother' END;
\ir ../migrations/20261124131000_viza_document_aware_admission.sql
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.guests WHERE mother_name='Legacy Mother' AND mother_family_name='Legacy' AND mother_given_name='Mother') THEN RAISE EXCEPTION 'Two-word name not backfilled'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.guests WHERE mother_name='Compound Family Mother' AND mother_family_name IS NULL AND mother_given_name IS NULL) THEN RAISE EXCEPTION 'Ambiguous name backfilled'; END IF;
END $$;
UPDATE public.viza_settings SET enabled=true,adatszolgaltatasi_azonosito='TEST0001';
UPDATE public.reservations SET adults=1,children=1;
UPDATE public.guests SET birth_last_name=last_name,birth_first_name=first_name,
 mother_family_name='Synthetic Family',mother_given_name='Synthetic Given',
 viza_review='{"reservation_id":"00000000-0000-4000-8000-000000000094","parent_statement":true,"manual_reason":"Scanner failure"}';
UPDATE public.guests SET id_document_type='id_card',id_document_number='TEST-ID'
 WHERE id='00000000-0000-4000-8000-000000000092';
SELECT public.pms_assert_viza_arrival_data('00000000-0000-4000-8000-000000000094',NULL,current_date);
UPDATE public.guests SET mother_given_name=NULL,
 viza_review=viza_review||'{"mother_name_absent":true}'::jsonb WHERE id='00000000-0000-4000-8000-000000000092';
DO $$ BEGIN
 BEGIN
  PERFORM public.pms_assert_viza_arrival_data('00000000-0000-4000-8000-000000000094',ARRAY['00000000-0000-4000-8000-000000000092'::uuid],current_date);
  RAISE EXCEPTION 'Hungarian ID missing mother name was admitted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'VIZA_GUEST_DATA_INCOMPLETE:%mother_given_name%' THEN RAISE; END IF; END;
END $$;
UPDATE public.guests SET nationality='DE',id_document_type='passport',mother_family_name=NULL,
 birth_last_name=NULL,birth_first_name=NULL,birth_place=NULL,
 viza_review=viza_review||'{"birth_name_absent":true,"birth_place_absent":true}'::jsonb
 WHERE id='00000000-0000-4000-8000-000000000092';
SELECT public.pms_assert_viza_arrival_data('00000000-0000-4000-8000-000000000094',NULL,current_date);
UPDATE public.guests SET nationality='LK' WHERE id='00000000-0000-4000-8000-000000000092';
DO $$ BEGIN
 BEGIN
  PERFORM public.pms_assert_viza_arrival_data('00000000-0000-4000-8000-000000000094',NULL,current_date);
  RAISE EXCEPTION 'Third-country arrival missing entry was admitted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'VIZA_GUEST_DATA_INCOMPLETE:%entry_date%entry_place%visa_number%' THEN RAISE; END IF; END;
END $$;
UPDATE public.guests SET entry_date=current_date,entry_place='Vienna',
 viza_review=viza_review||'{"visa_exempt":true}'::jsonb WHERE id='00000000-0000-4000-8000-000000000092';
SELECT public.pms_assert_viza_arrival_data('00000000-0000-4000-8000-000000000094',NULL,current_date);
UPDATE public.reservations SET adults=2;
DO $$ BEGIN
 BEGIN
  PERFORM public.pms_assert_viza_arrival_data('00000000-0000-4000-8000-000000000094',NULL,current_date);
  RAISE EXCEPTION 'Incomplete occupant roster was admitted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'VIZA_GUEST_DATA_INCOMPLETE:%occupant_count%' THEN RAISE; END IF; END;
END $$;

-- Whole-booking VIZA-only route: two adult guests, no NTAK lifecycle.
UPDATE public.reservations SET adults=2,children=0;
UPDATE public.guests SET nationality='HU',id_document_type='id_card',id_document_number='TEST-HU',
 date_of_birth='1990-01-01',birth_last_name='Synthetic',birth_first_name='Guest',birth_place='Budapest',
 mother_family_name='Synthetic',mother_given_name='Mother',
 viza_review='{"reservation_id":"00000000-0000-4000-8000-000000000094","manual_reason":"Scanner failure"}'
 WHERE id='00000000-0000-4000-8000-000000000092';
UPDATE public.guests SET nationality='DE',id_document_type='passport',id_document_number='TEST-DE',
 date_of_birth='1991-01-01',birth_last_name=NULL,birth_first_name=NULL,birth_place=NULL,
 mother_family_name=NULL,mother_given_name=NULL,
 viza_review='{"reservation_id":"00000000-0000-4000-8000-000000000094","manual_reason":"Scanner failure","birth_name_absent":true,"birth_place_absent":true,"mother_name_absent":true}'
 WHERE id='00000000-0000-4000-8000-000000000093';
SELECT public.pms_check_in('00000000-0000-4000-8000-000000000094',NULL,NULL,NULL,true);


-- Express registration regression: extend the disposable fixture to match the
-- guest/stay columns used by the production linking helper.
ALTER TABLE public.guests ADD COLUMN IF NOT EXISTS organization_slug text;
ALTER TABLE public.reservation_guests ADD COLUMN IF NOT EXISTS created_by uuid;
CREATE OR REPLACE FUNCTION public.pms_add_stay_guest(
  _reservation_id uuid,_guest_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.reservations%ROWTYPE; g public.guests%ROWTYPE; actor uuid:=auth.uid();
BEGIN
  SELECT * INTO r FROM public.reservations WHERE id=_reservation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RESERVATION_NOT_FOUND'; END IF;
  IF actor IS NULL OR NOT public.can_access_pms_hotel(actor,r.hotel_id,r.organization_slug) THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
  SELECT * INTO g FROM public.guests WHERE id=_guest_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'GUEST_NOT_FOUND'; END IF;
  IF g.organization_slug IS DISTINCT FROM r.organization_slug
    OR (g.hotel_id IS NOT NULL AND NOT public.user_can_access_hotel(actor,g.hotel_id)) THEN
    RAISE EXCEPTION 'GUEST_WRONG_PROPERTY';
  END IF;
  INSERT INTO public.reservation_guests(reservation_id,guest_id,room_id,created_by)
  VALUES(r.id,g.id,r.room_id,actor)
  ON CONFLICT (reservation_id,guest_id) DO NOTHING;
  RETURN jsonb_build_object('ok',true,'guest_id',g.id);
END;
$$;
\ir ../migrations/20261124143000_pms_express_guest_registration.sql
\ir ../migrations/20261124212000_viza_conditional_passport_fields.sql
-- British passport: absent entry information is accepted only after explicit review.
UPDATE public.guests SET nationality='GB',entry_date=NULL,entry_place=NULL,visa_number=NULL,
 viza_review=viza_review||'{"entry_details_absent":true,"visa_exempt":true}'::jsonb WHERE id='00000000-0000-4000-8000-000000000093';
SELECT public.pms_assert_viza_arrival_data('00000000-0000-4000-8000-000000000094',NULL,current_date);
UPDATE public.guests SET entry_date=current_date+1 WHERE id='00000000-0000-4000-8000-000000000093';
DO $$ BEGIN
 BEGIN
  PERFORM public.pms_assert_viza_arrival_data('00000000-0000-4000-8000-000000000094',NULL,current_date);
  RAISE EXCEPTION 'Invalid future entry date accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'VIZA_GUEST_DATA_INCOMPLETE:%entry_date%' THEN RAISE; END IF; END;
END $$;
UPDATE public.guests SET entry_date=NULL,nationality='DE' WHERE id='00000000-0000-4000-8000-000000000093';
UPDATE public.guests SET organization_slug='fixture';
UPDATE public.reservations SET adults=3 WHERE id='00000000-0000-4000-8000-000000000094';

DO $express_test$
DECLARE
  res uuid:='00000000-0000-4000-8000-000000000094';
  registered jsonb;
  payload jsonb := '{"first_name":"New","last_name":"Visitor","nationality":"DE","gender":"female","date_of_birth":"1992-01-01","id_document_type":"passport","id_document_number":"EXPRESS-TEST","viza_review":{"birth_name_absent":true,"birth_place_absent":true,"mother_name_absent":true},"document_scan":{"source":"mrz_camera","format":"TD3","valid":true,"read_at":"2026-11-24T10:00:00Z","fields":{"csaladnev":"VISITOR","utonev":"NEW","szuletesiDatum":"1992-01-01","allampolgarsagKod":"DE","nem":"NO","okmanyTipus":"UTLEVEL","okmanyAzonositoSzam":"EXPRESS-TEST"}}}';
  candidate uuid;
BEGIN
  -- No cross-tenant access, even when the caller supplies a valid reservation ID.
  PERFORM set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000099',false);
  BEGIN
    PERFORM public.pms_register_scanned_stay_guest(res,payload,NULL);
    RAISE EXCEPTION 'unauthorized registration succeeded';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'ACCESS_DENIED' THEN RAISE; END IF; END;
  PERFORM set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000091',false);
  -- Existing document identity: no update or link until explicit confirmation.
  INSERT INTO public.guests(first_name,last_name,hotel_id,organization_slug,nationality,date_of_birth,id_document_type,id_document_number)
    VALUES('New','Visitor','viza-hotel','fixture','DE','1992-01-01','passport','EXPRESS-TEST') RETURNING id INTO candidate;
  registered:=public.pms_register_scanned_stay_guest(res,payload,NULL);
  IF registered->>'status'<>'match' OR (registered->>'guest_id')::uuid<>candidate
     OR EXISTS(SELECT 1 FROM public.reservation_guests WHERE reservation_id=res AND guest_id=candidate)
     OR EXISTS(SELECT 1 FROM public.guests WHERE id=candidate AND document_scan IS NOT NULL) THEN RAISE EXCEPTION 'unconfirmed match changed data'; END IF;
  BEGIN
    PERFORM public.pms_register_scanned_stay_guest(res,payload||'{"first_name":"Other"}'::jsonb,candidate);
    RAISE EXCEPTION 'identity mismatch accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'EXPRESS_IDENTITY_CONFLICT' THEN RAISE; END IF; END;
  registered:=public.pms_register_scanned_stay_guest(res,payload,candidate);
  IF registered->>'status'<>'registered' OR (registered->>'guest_id')::uuid<>candidate
     OR NOT EXISTS(SELECT 1 FROM public.reservation_guests WHERE reservation_id=res AND guest_id=candidate)
     OR NOT EXISTS(SELECT 1 FROM public.guests WHERE id=candidate AND document_scan->'fields'->>'okmanyAzonositoSzam'='EXPRESS-TEST')
     THEN RAISE EXCEPTION 'confirmed match did not register'; END IF;
  PERFORM public.pms_assert_viza_arrival_data(res,NULL,current_date);
  BEGIN
    PERFORM public.pms_register_scanned_stay_guest(res,payload||'{"id_document_number":"OVERFLOW"}'::jsonb,NULL);
    RAISE EXCEPTION 'overfilled reservation';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'EXPRESS_OCCUPANCY_FULL' THEN RAISE; END IF; END;
  UPDATE public.reservations SET adults=4 WHERE id=res;
  registered:=public.pms_register_scanned_stay_guest(res,
    payload||'{"first_name":"Second","id_document_number":"EXPRESS-NEW"}'::jsonb
      ||jsonb_build_object('document_scan',jsonb_set(payload->'document_scan','{fields,okmanyAzonositoSzam}','"EXPRESS-NEW"'::jsonb)),NULL);
  IF registered->>'status'<>'registered' OR NOT EXISTS(
      SELECT 1 FROM public.guests g JOIN public.reservation_guests rg ON rg.guest_id=g.id
      WHERE rg.reservation_id=res AND g.id=(registered->>'guest_id')::uuid AND g.hotel_id='viza-hotel' AND g.organization_slug='fixture')
    THEN RAISE EXCEPTION 'new guest was not atomically registered'; END IF;
  PERFORM public.pms_assert_viza_arrival_data(res,NULL,current_date);
END $express_test$;


-- Room-level channel names are a read-only hint; never pull other rooms or
-- unaccepted revisions, and never resurrect purged payloads.
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS channex_room_index integer;
CREATE TABLE public.channex_booking_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), hotel_id text, channex_booking_id text,
  reservation_ids uuid[] NOT NULL DEFAULT '{}', state text, created_at timestamptz DEFAULT now(), payload jsonb
);
\ir ../migrations/20261124143100_pms_express_channel_guest_hints.sql
UPDATE public.reservations SET channex_booking_id='11111111-1111-4111-8111-111111111111',channex_room_index=1
 WHERE id='00000000-0000-4000-8000-000000000094';
INSERT INTO public.channex_booking_revisions(hotel_id,channex_booking_id,reservation_ids,state,created_at,payload) VALUES
('viza-hotel','11111111-1111-4111-8111-111111111111',ARRAY['00000000-0000-4000-8000-000000000094'::uuid],'applied',now()-interval '2 days',
 '{"rooms":[{"guests":[{"name":"Wrong","surname":"Room"}]},{"guests":[{"name":"Correct","surname":"Companion","email":"not-returned@example.invalid"}]}]}'),
('viza-hotel','11111111-1111-4111-8111-111111111111',ARRAY['00000000-0000-4000-8000-000000000094'::uuid],'review',now()-interval '1 day',
 '{"rooms":[{},{"guests":[{"name":"Pending","surname":"Revision"}]}]}');
DO $hint_test$
DECLARE
  res uuid:='00000000-0000-4000-8000-000000000094';
  result jsonb;
BEGIN
  result:=public.pms_express_channel_guest_hints(res);
  IF result IS DISTINCT FROM '[{"first_name":"Correct","last_name":"Companion"}]'::jsonb THEN RAISE EXCEPTION 'wrong room/revision or extra PII returned'; END IF;
  PERFORM set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000099',false);
  BEGIN
    PERFORM public.pms_express_channel_guest_hints(res);
    RAISE EXCEPTION 'unauthorized channel names returned';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'ACCESS_DENIED' THEN RAISE; END IF; END;
  PERFORM set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000091',false);
  INSERT INTO public.channex_booking_revisions(hotel_id,channex_booking_id,reservation_ids,state,created_at,payload)
    VALUES('viza-hotel','11111111-1111-4111-8111-111111111111',ARRAY[res],'applied',now(),NULL);
  IF public.pms_express_channel_guest_hints(res) IS DISTINCT FROM '[]'::jsonb THEN RAISE EXCEPTION 'purged payload resurrected'; END IF;
END $hint_test$;

-- V2 parity cases are shared with the frontend fixture and run only in disposable CI.
\ir ../migrations/20261125090000_viza_field_requirements_v2.sql
\set fixture `cat src/lib/idScan/vizaRequirementsCases.json`
SELECT set_config('viza.test_fixtures', :'fixture', false);
DO $v2$
DECLARE fixtures jsonb:=current_setting('viza.test_fixtures')::jsonb;
  c jsonb; g public.guests%ROWTYPE; actual jsonb; expected text[]; found_fields text[];
  res uuid:=(fixtures->>'reservationId')::uuid;
  target uuid:='00000000-0000-4000-8000-000000000093';
  day date:=(fixtures->>'day')::date;
  refused boolean;
BEGIN
  IF NOT has_function_privilege('authenticated','public.pms_viza_arrival_requirements(uuid,uuid[],date)','EXECUTE')
    OR has_function_privilege('anon','public.pms_viza_arrival_requirements(uuid,uuid[],date)','EXECUTE')
    OR has_function_privilege('authenticated','public.pms_assert_viza_arrival_data(uuid,uuid[],date)','EXECUTE')
    OR NOT has_function_privilege('service_role','public.pms_assert_viza_arrival_data(uuid,uuid[],date)','EXECUTE')
    THEN RAISE EXCEPTION 'VIZA v2 incorrect grants'; END IF;
  PERFORM set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000099',false);
  BEGIN
    PERFORM public.pms_viza_arrival_requirements(res,NULL,day);
    RAISE EXCEPTION 'unauthorized v2 query';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'ACCESS_DENIED' THEN RAISE; END IF; END;
  PERFORM set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000091',false);
  BEGIN
    PERFORM public.pms_viza_arrival_requirements(res,ARRAY['00000000-0000-4000-8000-000000000099'::uuid],day);
    RAISE EXCEPTION 'unlinked guest exposed';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'ACCESS_DENIED' THEN RAISE; END IF; END;
  FOR c IN SELECT value FROM jsonb_array_elements(fixtures->'cases') LOOP
    g:=jsonb_populate_record(NULL::public.guests,(fixtures->'base')||(c->'patch'));
    UPDATE public.guests SET first_name=g.first_name,last_name=g.last_name,nationality=g.nationality,
      date_of_birth=g.date_of_birth,gender=g.gender,id_document_type=g.id_document_type,id_document_number=g.id_document_number,
      birth_first_name=g.birth_first_name,birth_last_name=g.birth_last_name,birth_place=g.birth_place,
      mother_family_name=g.mother_family_name,mother_given_name=g.mother_given_name,
      visa_number=g.visa_number,entry_date=g.entry_date,entry_place=g.entry_place,
      viza_review=g.viza_review,document_scan=g.document_scan WHERE id=target;
    actual:=public.pms_viza_arrival_requirements(res,ARRAY[target],day);
    SELECT COALESCE(array_agg(value ORDER BY value),ARRAY[]::text[]) INTO expected FROM jsonb_array_elements_text(c->'missing');
    SELECT COALESCE(array_agg(value ORDER BY value),ARRAY[]::text[]) INTO found_fields FROM jsonb_array_elements_text(actual->'guests'->0->'missing');
    IF actual->>'version'<>'2' OR actual->>'occupant_count_ok'<>'true' OR expected IS DISTINCT FROM found_fields THEN
      RAISE EXCEPTION 'VIZA fixture %: expected %, found %, response %',c->>'name',expected,found_fields,actual; END IF;
    refused:=false;
    BEGIN PERFORM public.pms_assert_viza_arrival_data(res,ARRAY[target],day);
    EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'VIZA_GUEST_DATA_INCOMPLETE:%' THEN RAISE; END IF; refused:=true; END;
    IF refused IS DISTINCT FROM (cardinality(expected)>0) THEN RAISE EXCEPTION 'Assertion mismatch for %',c->>'name'; END IF;
  END LOOP;
END $v2$;


-- Verified duplicate selection: no write on discovery; no name/email-only
-- match, no cross-property disclosure, no extra occupant on linked reuse.
ALTER TABLE public.guests ADD COLUMN IF NOT EXISTS email text;
\ir ../migrations/20261126151000_express_guest_duplicate_resolution.sql
DO $duplicate_resolution$
DECLARE
  res uuid:='00000000-0000-4000-8000-000000000094';
  a uuid; b uuid; foreign_id uuid;
  answer jsonb;
  before_count integer;
  payload jsonb:='{"first_name":"Same","last_name":"Person","nationality":"DE","gender":"female","date_of_birth":"1992-01-01","id_document_type":"passport","id_document_number":"DUPLICATE-TEST","viza_review":{"birth_name_absent":true,"birth_place_absent":true,"mother_name_absent":true},"document_scan":{"source":"mrz_camera","format":"TD3","valid":true,"fields":{"csaladnev":"PERSON","utonev":"SAME","szuletesiDatum":"1992-01-01","allampolgarsagKod":"DE","nem":"NO","okmanyTipus":"UTLEVEL","okmanyAzonositoSzam":"DUPLICATE-TEST"}}}';
BEGIN
  PERFORM set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000091',false);
  UPDATE public.reservations SET adults=8 WHERE id=res;
  SELECT count(*) INTO before_count FROM public.reservation_guests WHERE reservation_id=res;
  INSERT INTO public.guests(first_name,last_name,hotel_id,organization_slug,nationality,date_of_birth,id_document_type,id_document_number,email)
    VALUES('Same','Person','viza-hotel','fixture','DE','1992-01-01','passport','DUPLICATE-TEST','first@example.com') RETURNING id INTO a;
  INSERT INTO public.guests(first_name,last_name,hotel_id,organization_slug,nationality,date_of_birth,id_document_type,id_document_number,email)
    VALUES('Same','Person','viza-hotel','fixture','DE','1992-01-01','passport','DUPLICATE-TEST','second@example.com') RETURNING id INTO b;
  INSERT INTO public.guests(first_name,last_name,hotel_id,organization_slug,nationality,date_of_birth,id_document_type,id_document_number,email)
    VALUES('Same','Person','other-hotel','fixture','DE','1992-01-01','passport','DUPLICATE-TEST','private@example.com') RETURNING id INTO foreign_id;
  answer:=public.pms_register_scanned_stay_guest(res,payload,NULL);
  IF answer->>'status'<>'match' OR jsonb_array_length(answer->'candidates')<>2
    OR answer::text LIKE '%private@example.com%' OR answer::text NOT LIKE '%first@example.com%'
    OR answer::text NOT LIKE '%second@example.com%'
    OR (SELECT count(*) FROM public.reservation_guests WHERE reservation_id=res)<>before_count
    THEN RAISE EXCEPTION 'duplicate discovery incorrect'; END IF;
  BEGIN
    PERFORM public.pms_register_scanned_stay_guest(res,payload,foreign_id);
    RAISE EXCEPTION 'foreign selection accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'EXPRESS_IDENTITY_CONFLICT' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.pms_register_scanned_stay_guest(res,payload||'{"date_of_birth":"1993-01-01"}',b);
    RAISE EXCEPTION 'mismatching DOB accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'EXPRESS_IDENTITY_CONFLICT' THEN RAISE; END IF; END;
  answer:=public.pms_register_scanned_stay_guest(res,payload||'{"confirmed_contact_email":"updated@example.com"}',b);
  IF answer->>'status'<>'registered' OR (answer->>'guest_id')::uuid<>b
    OR (SELECT email FROM public.guests WHERE id=b)<>'updated@example.com'
    OR (SELECT email FROM public.guests WHERE id=a)<>'first@example.com'
    OR (SELECT count(*) FROM public.reservation_guests WHERE reservation_id=res)<>before_count+1
    THEN RAISE EXCEPTION 'selected profile was not reused safely'; END IF;
  answer:=public.pms_register_scanned_stay_guest(res,payload,NULL);
  IF jsonb_array_length(answer->'candidates')<>1 OR answer->'candidates'->0->>'linked'<>'true'
    OR (answer->>'guest_id')::uuid<>b THEN RAISE EXCEPTION 'linked guest was not prioritized'; END IF;
  answer:=public.pms_register_scanned_stay_guest(res,payload,b);
  IF answer->>'status'<>'registered' OR (SELECT count(*) FROM public.reservation_guests WHERE reservation_id=res)<>before_count+1
    THEN RAISE EXCEPTION 'linked guest reuse created extra occupant'; END IF;
  answer:=public.pms_register_scanned_stay_guest(res,
    payload||'{"id_document_number":"DIFFERENT-DOCUMENT","email":"updated@example.com"}'
      ||jsonb_build_object('document_scan',jsonb_set(payload->'document_scan','{fields,okmanyAzonositoSzam}','"DIFFERENT-DOCUMENT"'::jsonb)),NULL);
  IF answer->>'status'<>'registered' OR (answer->>'guest_id')::uuid=b THEN RAISE EXCEPTION 'name/email-only deduplication occurred'; END IF;
END $duplicate_resolution$;


-- Production regression: accented Hungarian OCR names and older MRZ spellings
-- must resolve to the same verified document candidates; email is not identity.
\ir ../migrations/20261126154000_express_hungarian_duplicate_email.sql
DO $hungarian_email$
DECLARE
  res uuid:='00000000-0000-4000-8000-000000000094';
  plain_id uuid; accented_id uuid; wrong_id uuid;
  answer jsonb;
  payload jsonb:='{"first_name":"Éva","last_name":"Őr","nationality":"HU","gender":"female","date_of_birth":"1992-01-01","id_document_type":"id_card","id_document_number":"HU-ACCENT-TEST","viza_review":{"birth_name_absent":true,"birth_place_absent":true,"mother_name_absent":true},"document_scan":{"source":"mrz_camera","format":"TD1","valid":true,"fields":{"csaladnev":"OR","utonev":"EVA","szuletesiDatum":"1992-01-01","allampolgarsagKod":"HU","nem":"NO","okmanyTipus":"SZEMELYI_IGAZOLVANY","okmanyAzonositoSzam":"HU-ACCENT-TEST"}}}';
BEGIN
  PERFORM set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000091',false);
  UPDATE public.reservations SET adults=20 WHERE id=res;
  INSERT INTO public.guests(first_name,last_name,hotel_id,organization_slug,nationality,date_of_birth,id_document_type,id_document_number,email)
    VALUES('Eva','Or','viza-hotel','fixture','HU','1992-01-01','id_card','HU-ACCENT-TEST','existing@example.com') RETURNING id INTO plain_id;
  INSERT INTO public.guests(first_name,last_name,hotel_id,organization_slug,nationality,date_of_birth,id_document_type,id_document_number,email)
    VALUES('Éva','Őr','viza-hotel','fixture','HU','1992-01-01','id_card','HU-ACCENT-TEST',NULL) RETURNING id INTO accented_id;
  INSERT INTO public.guests(first_name,last_name,hotel_id,organization_slug,nationality,date_of_birth,id_document_type,id_document_number,email)
    VALUES('Éva','Őr','viza-hotel','fixture','HU','1993-01-01','id_card','HU-ACCENT-TEST','wrong@example.com') RETURNING id INTO wrong_id;
  answer:=public.pms_register_scanned_stay_guest(res,payload,NULL);
  IF answer->>'status'<>'match' OR jsonb_array_length(answer->'candidates')<>2
    OR answer->'candidates'->0->>'guest_id'<>plain_id::text
    OR answer->'candidates'->0->>'email'<>'existing@example.com'
    OR answer::text LIKE '%wrong@example.com%' THEN RAISE EXCEPTION 'accent-equivalent discovery incorrect'; END IF;
  answer:=public.pms_register_scanned_stay_guest(res,payload||'{"first_name":"Eva","last_name":"Or"}',NULL);
  IF jsonb_array_length(answer->'candidates')<>2 OR answer->'candidates'->0->>'email'<>'existing@example.com'
    THEN RAISE EXCEPTION 'ASCII scan discovery differs'; END IF;
  BEGIN
    PERFORM public.pms_register_scanned_stay_guest(res,payload,wrong_id);
    RAISE EXCEPTION 'wrong DOB selection accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'EXPRESS_IDENTITY_CONFLICT' THEN RAISE; END IF; END;
  answer:=public.pms_register_scanned_stay_guest(res,payload,plain_id);
  IF answer->>'status'<>'registered' OR (SELECT email FROM public.guests WHERE id=plain_id) IS DISTINCT FROM 'existing@example.com'
    THEN RAISE EXCEPTION 'existing contact was lost'; END IF;
  answer:=public.pms_register_scanned_stay_guest(res,
    payload||'{"id_document_number":"HU-NEW-EMAIL","confirmed_contact_email":"new@example.com"}'
      ||jsonb_build_object('document_scan',jsonb_set(payload->'document_scan','{fields,okmanyAzonositoSzam}','"HU-NEW-EMAIL"'::jsonb)),NULL);
  IF answer->>'status'<>'registered' OR (SELECT email FROM public.guests WHERE id=(answer->>'guest_id')::uuid) IS DISTINCT FROM 'new@example.com'
    THEN RAISE EXCEPTION 'new guest contact was not saved'; END IF;
END $hungarian_email$;
