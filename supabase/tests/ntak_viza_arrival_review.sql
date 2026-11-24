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
DO $backfill$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.guests WHERE mother_name='Legacy Mother' AND mother_family_name='Legacy' AND mother_given_name='Mother') THEN RAISE EXCEPTION 'Two-word name not backfilled'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.guests WHERE mother_name='Compound Family Mother' AND mother_family_name IS NULL AND mother_given_name IS NULL) THEN RAISE EXCEPTION 'Ambiguous name backfilled'; END IF;
END $backfill$;
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
