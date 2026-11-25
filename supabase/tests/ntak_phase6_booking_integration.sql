-- Verify actual Phase 6 DDL, constraints, authorization and dirty trigger.
INSERT INTO profiles(id,role,organization_slug) VALUES
 ('00000000-0000-4000-8000-000000000061','manager','test'),
 ('00000000-0000-4000-8000-000000000062','reception','test'),
 ('00000000-0000-4000-8000-000000000063','manager','other');
INSERT INTO hotel_access VALUES
 ('00000000-0000-4000-8000-000000000061','h6'),
 ('00000000-0000-4000-8000-000000000062','h6'),
 ('00000000-0000-4000-8000-000000000063','other');
INSERT INTO ntak_settings(hotel_id,organization_slug,enabled,unit_scope) VALUES('h6','test',true,'all');
INSERT INTO reservations(id,hotel_id,organization_slug,check_in_date,check_out_date,reservation_number,total_amount)
 VALUES('00000000-0000-4000-8000-000000000064','h6','test',current_date+1,current_date+2,'FOGL_04',20000);
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000061',false);
DO $$
DECLARE q timestamptz; v jsonb; n integer; rid uuid:='00000000-0000-4000-8000-000000000064';
BEGIN
 v:=public.pms_ntak_booking_fields('h6','test',rid);
 IF v IS NULL OR v->>'ntak_guaranteed' IS NOT NULL OR (v->>'can_edit_booking_no')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'legacy/default read failed'; END IF;
 PERFORM public.pms_save_ntak_booking_fields(rid,'{"ntak_guaranteed":true,"ntak_market_segment":"UZLETI_EGYENI","ntak_sales_channel":"DIREKT_ONLINE","booker_country":"HU","expected_guests":1}');
 SELECT dirty_at INTO q FROM ntak_booking_queue WHERE hotel_id='h6' AND booking_no='FOGL_04';
 IF q IS NULL THEN RAISE EXCEPTION 'booking not queued'; END IF;
 PERFORM pg_sleep(0.01);
 PERFORM public.pms_save_ntak_booking_fields(rid,'{"ntak_guaranteed":false}');
 IF NOT EXISTS(SELECT 1 FROM reservations WHERE id=rid AND ntak_guaranteed=false AND booker_country='HU') OR NOT EXISTS(SELECT 1 FROM ntak_booking_queue WHERE hotel_id='h6' AND booking_no='FOGL_04' AND dirty_at>q) THEN RAISE EXCEPTION 'false or dirty update lost'; END IF;
 BEGIN
   PERFORM public.pms_save_ntak_booking_fields(rid,'{"booker_country":"ZZ"}');
   RAISE EXCEPTION 'invalid country accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
   PERFORM public.pms_update_reservation_phase6(jsonb_build_object('_reservation_id',rid,'_rate_per_night',40000),'{"expected_guests":100}');
   RAISE EXCEPTION 'invalid guest count accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 IF (SELECT total_amount FROM reservations WHERE id=rid)<>20000 THEN RAISE EXCEPTION 'atomic rollback failed'; END IF;
 PERFORM public.pms_update_reservation_phase6(jsonb_build_object('_reservation_id',rid,'_rate_per_night',40000,'_check_in',current_date),'{"expected_guests":2}');
 IF NOT EXISTS(SELECT 1 FROM reservations WHERE id=rid AND total_amount=40000 AND expected_guests=2 AND check_in_date=current_date) THEN RAISE EXCEPTION 'atomic update failed'; END IF;
 SELECT count(*) INTO n FROM reservations;
 BEGIN
   PERFORM public.pms_create_reservation_phase6(jsonb_build_object('_hotel_id','h6','_check_in',current_date+1,'_check_out',current_date+2,'_adults',1,'_children',0,'_rate_per_night',100,'_status','confirmed'),'{"ntak_sales_channel":"INVALID"}');
   RAISE EXCEPTION 'invalid channel accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 IF (SELECT count(*) FROM reservations)<>n THEN RAISE EXCEPTION 'create rollback failed'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000062',false);
DO $$
DECLARE rid uuid:='00000000-0000-4000-8000-000000000064';
BEGIN
 IF (public.pms_ntak_booking_fields('h6','test',rid)->>'can_edit_booking_no')::boolean IS DISTINCT FROM false THEN RAISE EXCEPTION 'reception booking ID permission'; END IF;
 BEGIN
   PERFORM public.pms_save_ntak_booking_fields(rid,'{"ntak_booking_no":"FORBIDDEN"}');
   RAISE EXCEPTION 'manager guard bypassed';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'MANAGER_REQUIRED' THEN RAISE; END IF; END;
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000063',false);
DO $$
DECLARE rid uuid:='00000000-0000-4000-8000-000000000064';
BEGIN
 IF public.pms_ntak_booking_fields('h6','test',rid) IS NOT NULL THEN RAISE EXCEPTION 'cross-tenant read'; END IF;
 BEGIN
   PERFORM public.pms_save_ntak_booking_fields(rid,'{"ntak_guaranteed":true}');
   RAISE EXCEPTION 'cross-tenant write';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'ACCESS_DENIED' THEN RAISE; END IF; END;
END $$;
