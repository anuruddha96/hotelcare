-- Synthetic production-schema acceptance; run only in disposable CI.
-- No production rows, endpoint access, or changes to Claude's schema.
-- psql variable expect_old_guard selects the original Phase 8 reproduction.
\if :{?expect_old_guard}
\else
\set expect_old_guard false
\endif
BEGIN;
INSERT INTO acceptance.hotel_scope VALUES ('previo-ci','rdhotels','Synthetic Previo Display'),('native-ci','channex','Synthetic Native Display');
INSERT INTO auth.users(id) VALUES ('00000000-0000-4000-8000-000000000091'),('00000000-0000-4000-8000-000000000092'),('00000000-0000-4000-8000-000000000093');
INSERT INTO public.profiles(id,email,full_name,role,organization_slug) VALUES
 ('00000000-0000-4000-8000-000000000091','previo-ci@example.invalid','Previo reception','reception','rdhotels'),
 ('00000000-0000-4000-8000-000000000092','native-ci@example.invalid','Native reception','reception','channex'),
 ('00000000-0000-4000-8000-000000000093','manager-ci@example.invalid','Native manager','admin','channex');
INSERT INTO acceptance.hotel_access VALUES ('00000000-0000-4000-8000-000000000091','previo-ci'),('00000000-0000-4000-8000-000000000092','native-ci'),('00000000-0000-4000-8000-000000000093','native-ci');
INSERT INTO public.rooms(id,hotel,room_number,organization_slug,status) VALUES
 ('00000000-0000-4000-8000-000000000011','Synthetic Native Display','101','channex','dirty'),
 ('00000000-0000-4000-8000-000000000012','Synthetic Native Display','102','channex','clean');
INSERT INTO public.guests(id,hotel_id,organization_slug,first_name,last_name,date_of_birth) VALUES
 ('00000000-0000-4000-8000-000000000021','previo-ci','rdhotels','Synthetic','Legacy',DATE '1990-01-01'),
 ('00000000-0000-4000-8000-000000000022','native-ci','channex','Synthetic','Native',DATE '1990-01-01'),
 ('00000000-0000-4000-8000-000000000023','native-ci','channex','Synthetic','Companion',DATE '1990-01-01');
INSERT INTO public.reservations(id,hotel_id,organization_slug,guest_id,room_id,status,check_in_date,check_out_date,total_amount,rate_per_night,currency,balance_due,payment_status) VALUES
 ('00000000-0000-4000-8000-000000000001','previo-ci',NULL,'00000000-0000-4000-8000-000000000021',NULL,'checked_out',(now() AT TIME ZONE 'Europe/Budapest')::date-2,(now() AT TIME ZONE 'Europe/Budapest')::date-1,200,100,'EUR',73,'partial'),
 ('00000000-0000-4000-8000-000000000002','native-ci','channex','00000000-0000-4000-8000-000000000022','00000000-0000-4000-8000-000000000011','checked_out',(now() AT TIME ZONE 'Europe/Budapest')::date-2,(now() AT TIME ZONE 'Europe/Budapest')::date-1,200,90,'EUR',200,'unpaid'),
 ('00000000-0000-4000-8000-000000000003','native-ci','channex','00000000-0000-4000-8000-000000000022','00000000-0000-4000-8000-000000000012','confirmed',(now() AT TIME ZONE 'Europe/Budapest')::date,(now() AT TIME ZONE 'Europe/Budapest')::date+1,100,100,'EUR',100,'unpaid');
INSERT INTO public.reservation_guests(reservation_id,guest_id,is_primary) VALUES
 ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000021',true),
 ('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000022',true);
INSERT INTO public.reservation_folios(id,organization_slug,hotel_id,reservation_id,currency,base_reservation_amount) VALUES
 ('00000000-0000-4000-8000-000000000031','rdhotels','previo-ci','00000000-0000-4000-8000-000000000001','EUR',200),
 ('00000000-0000-4000-8000-000000000032','channex','native-ci','00000000-0000-4000-8000-000000000002','EUR',200);
INSERT INTO public.ntak_settings(hotel_id,organization_slug,enabled,environment,unit_scope) VALUES ('previo-ci','rdhotels',false,'test','all'),('native-ci','channex',false,'test','all');
INSERT INTO public.viza_settings(hotel_id,organization_slug,enabled,environment,thf_url) VALUES ('previo-ci','rdhotels',false,'test','https://invalid.invalid'),('native-ci','channex',false,'test','https://invalid.invalid');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000091',true);
SELECT set_config('acceptance.expect_old_guard', :'expect_old_guard', true);
DO $$
DECLARE ext uuid:='00000000-0000-4000-8000-000000000001'; native uuid:='00000000-0000-4000-8000-000000000002'; fol uuid:='00000000-0000-4000-8000-000000000031'; old_guard boolean:=current_setting('acceptance.expect_old_guard')::boolean; d date:=(now() AT TIME ZONE 'Europe/Budapest')::date;
BEGIN
 IF public.pms_finance_is_native_pms(ext) IS DISTINCT FROM false OR public.pms_finance_is_native_pms(native) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Native classifier wrong'; END IF;
 BEGIN
  INSERT INTO public.guest_folios(reservation_id,description,amount,charge_type,charge_date,created_by) VALUES(ext,'Legacy NULL posting',2,'other',d,auth.uid());
  IF old_guard THEN RAISE EXCEPTION 'Original Phase 8 failed to reproduce NULL guard bug'; END IF;
 EXCEPTION WHEN OTHERS THEN
  IF NOT old_guard OR SQLERRM IS DISTINCT FROM 'POST_DEPARTURE_REQUIRES_MANAGER' THEN RAISE; END IF;
  RAISE NOTICE 'Reproduced original NULL-organization posting rejection';
 END;
 IF old_guard THEN RETURN; END IF;
 INSERT INTO public.payments(organization_slug,hotel_id,reservation_id,folio_id,amount,currency,method) VALUES('rdhotels','previo-ci',ext,fol,3,'EUR','cash');
 INSERT INTO public.folio_lines(folio_id,source_type,description,service_date,currency,gross_unit_price,net_total,gross_total) VALUES(fol,'manual','Legacy NULL line',d,'EUR',4,4,4);
 IF (SELECT balance_due FROM public.reservations WHERE id=ext) IS DISTINCT FROM 73 THEN RAISE EXCEPTION 'Imported balance overwritten'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.guest_folios WHERE reservation_id=ext AND description='Legacy NULL posting') OR NOT EXISTS(SELECT 1 FROM public.payments WHERE reservation_id=ext AND amount=3) OR NOT EXISTS(SELECT 1 FROM public.folio_lines WHERE folio_id=fol AND description='Legacy NULL line') THEN RAISE EXCEPTION 'NULL-org postings missing'; END IF;
END $$;
\if :expect_old_guard
ROLLBACK;
\else
-- Original CHECK and exclusions remain in force; display-name room lookup.
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000093',true);
DO $$
DECLARE rid uuid:='00000000-0000-4000-8000-000000000011'; d date:=(now() AT TIME ZONE 'Europe/Budapest')::date;
BEGIN
 PERFORM public.pms_add_room_state_period('native-ci',rid,'out_of_service',d,d,'Synthetic OOS');
 IF (SELECT status FROM public.rooms WHERE id=rid) IS DISTINCT FROM 'maintenance' THEN RAISE EXCEPTION 'OOS legacy mapping wrong'; END IF;
 BEGIN
  PERFORM public.pms_add_room_state_period('native-ci',rid,'out_of_order',d,d,'Overlapping period');
  RAISE EXCEPTION 'Overlap allowed';
 EXCEPTION WHEN exclusion_violation THEN NULL; END;
 BEGIN
  PERFORM public.pms_add_room_state_period('native-ci','00000000-0000-4000-8000-000000000012','out_of_order',d-1,d-1,'Historical disallowed');
  RAISE EXCEPTION 'Backdating allowed while disabled';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM IS DISTINCT FROM 'BACKDATING_DISABLED' THEN RAISE; END IF; END;
 BEGIN
  UPDATE public.reservations SET booker_country='ZZZ' WHERE id='00000000-0000-4000-8000-000000000003';
  RAISE EXCEPTION 'Missing country CHECK';
 EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
-- Authority hidden from reception; disabled-hotel writes allowed; scoped
-- NTAK direct guest mutations denied by replayed policies.
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000091',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.ntak_settings WHERE hotel_id='previo-ci') THEN RAISE EXCEPTION 'Reception sees authority settings'; END IF;
 UPDATE public.reservation_guests SET ifa_status='KOTELES' WHERE reservation_id='00000000-0000-4000-8000-000000000001';
 IF NOT FOUND THEN RAISE EXCEPTION 'Legacy guest edit blocked'; END IF;
END $$;
RESET ROLE;
UPDATE public.ntak_settings SET enabled=true WHERE hotel_id='native-ci';
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000092',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.ntak_settings WHERE hotel_id='native-ci') THEN RAISE EXCEPTION 'Reception sees enabled authority settings'; END IF;
 UPDATE public.reservation_guests SET ifa_status='KOTELES' WHERE reservation_id='00000000-0000-4000-8000-000000000003';
 IF FOUND THEN RAISE EXCEPTION 'Scoped guest UPDATE bypass'; END IF;
 DELETE FROM public.reservation_guests WHERE reservation_id='00000000-0000-4000-8000-000000000003';
 IF FOUND THEN RAISE EXCEPTION 'Scoped guest DELETE bypass'; END IF;
 BEGIN
  INSERT INTO public.reservation_guests(reservation_id,guest_id) VALUES('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000023');
  RAISE EXCEPTION 'Scoped guest INSERT bypass';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
UPDATE public.ntak_settings SET enabled=false WHERE hotel_id='native-ci';
-- Native restrictions and finance single source of truth.
INSERT INTO public.service_catalog_items(id,organization_slug,name,category,default_gross_price,currency,vat_rate,ntak_main,ntak_sub) VALUES('00000000-0000-4000-8000-000000000041','channex','Synthetic breakfast','breakfast',5,'EUR',27,'ETEL','REGGELI');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000092',true);
DO $$
DECLARE r uuid:='00000000-0000-4000-8000-000000000002'; f uuid:='00000000-0000-4000-8000-000000000032'; d date:=(now() AT TIME ZONE 'Europe/Budapest')::date;
BEGIN
 BEGIN
  INSERT INTO public.guest_folios(reservation_id,description,amount,charge_type,charge_date) VALUES(r,'Forbidden native',2,'other',d);
  RAISE EXCEPTION 'Native guest folio bypass';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM IS DISTINCT FROM 'POST_DEPARTURE_REQUIRES_MANAGER' THEN RAISE; END IF; END;
 BEGIN
  INSERT INTO public.folio_lines(folio_id,description,service_date,currency,gross_unit_price,net_total,gross_total) VALUES(f,'Forbidden native',d,'EUR',2,2,2);
  RAISE EXCEPTION 'Native folio line bypass';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM IS DISTINCT FROM 'POST_DEPARTURE_REQUIRES_MANAGER' THEN RAISE; END IF; END;
 BEGIN
  INSERT INTO public.payments(organization_slug,hotel_id,reservation_id,folio_id,amount,currency,method) VALUES('channex','native-ci',r,f,2,'EUR','cash');
  RAISE EXCEPTION 'Native payment bypass';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM IS DISTINCT FROM 'POST_DEPARTURE_REQUIRES_MANAGER' THEN RAISE; END IF; END;
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000093',true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE r uuid:='00000000-0000-4000-8000-000000000002'; result jsonb;
BEGIN
 result:=public.pms_record_business_folio_item(r,'Synthetic mixed charge',7,'other',NULL,NULL);
 IF (result->>'balance_due')::numeric IS DISTINCT FROM 207 THEN RAISE EXCEPTION 'Legacy-path balance mismatch: %',result; END IF;
 result:=public.pms_finance_post_catalogue(r,ARRAY['00000000-0000-4000-8000-000000000041'::uuid],NULL);
 IF (result->>'balance_due')::numeric IS DISTINCT FROM 212 THEN RAISE EXCEPTION 'Catalogue-path balance mismatch: %',result; END IF;
 result:=public.pms_record_business_folio_item(r,'Synthetic payment',8,'payment',NULL,'cash');
 IF (result->>'balance_due')::numeric IS DISTINCT FROM 204 THEN RAISE EXCEPTION 'Payment balance mismatch: %',result; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT total_amount FROM public.reservations WHERE id='00000000-0000-4000-8000-000000000002') IS DISTINCT FROM 200 THEN RAISE EXCEPTION 'Booked base rewritten'; END IF;
 IF (SELECT base_reservation_amount FROM public.reservation_folios WHERE id='00000000-0000-4000-8000-000000000032') IS DISTINCT FROM 200 THEN RAISE EXCEPTION 'Folio base rewritten'; END IF;
END $$;
ROLLBACK;
\endif
