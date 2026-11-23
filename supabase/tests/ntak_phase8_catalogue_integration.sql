-- Disposable finance integration fixture only; run after Phase 3 guard suite.
\i supabase/migrations/20261123235900_ntak_phase8_catalogue_categories.sql
SELECT set_config('request.jwt.claim.sub','',false);

INSERT INTO public.service_catalog_items(id,organization_slug,name,category,unit,default_gross_price,currency,vat_code,vat_rate,allowed_hotel_ids,price_editable,ntak_main,ntak_sub,in_package)
VALUES
 ('00000000-0000-4000-8000-000000000081','channex','Phase 8 breakfast','other','item',5,'EUR','REVIEW_REQUIRED',27,ARRAY['native-hotel'],false,'ETEL','REGGELI',true),
 ('00000000-0000-4000-8000-000000000082','channex','Phase 8 beer','other','item',6,'EUR','REVIEW_REQUIRED',27,ARRAY['native-hotel'],false,'ALKOHOLOSITAL','SOR',false);
DO $$
BEGIN
  BEGIN
    UPDATE public.service_catalog_items SET ntak_sub='SOR' WHERE id='00000000-0000-4000-8000-000000000081';
    RAISE EXCEPTION 'Invalid category pair accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.service_catalog_items SET ntak_sub=NULL WHERE id='00000000-0000-4000-8000-000000000081';
    RAISE EXCEPTION 'Missing category subcode accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000098',false);
SET ROLE authenticated;
DO $$
DECLARE
  r uuid:='00000000-0000-4000-8000-000000000002';
  first_item uuid:='00000000-0000-4000-8000-000000000081';
  second_item uuid:='00000000-0000-4000-8000-000000000082';
  result jsonb;
BEGIN
  BEGIN
    PERFORM public.pms_finance_post_catalogue(r,ARRAY[first_item,'00000000-0000-4000-8000-000000000083'::uuid],NULL);
    RAISE EXCEPTION 'Invalid batch accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM IS DISTINCT FROM 'SERVICE_ITEM_NOT_AVAILABLE' THEN RAISE; END IF;
  END;
  result:=public.pms_finance_post_catalogue(r,ARRAY[first_item,second_item],NULL);
  IF (result->>'posted')::int<>2 OR (result->>'balance_due')::numeric<>186 THEN
    RAISE EXCEPTION 'Batch response mismatch: %',result;
  END IF;
END $$;
RESET ROLE;
DO $$
BEGIN
  IF (SELECT count(*) FROM public.folio_lines WHERE service_catalog_item_id IN ('00000000-0000-4000-8000-000000000081','00000000-0000-4000-8000-000000000082'))<>2 THEN
    RAISE EXCEPTION 'Partial batch or duplicate ledger charges';
  END IF;
  IF (SELECT count(*) FROM public.guest_folios WHERE description IN ('Phase 8 breakfast','Phase 8 beer'))<>2 THEN
    RAISE EXCEPTION 'Legacy mirror mismatch';
  END IF;
END $$;

INSERT INTO public.profiles(id,role,organization_slug) VALUES ('00000000-0000-4000-8000-000000000097','reception','channex');
INSERT INTO public.hotel_access(user_id,hotel_id) VALUES ('00000000-0000-4000-8000-000000000097','native-hotel');
UPDATE public.reservations SET status='checked_out' WHERE id='00000000-0000-4000-8000-000000000002';
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000097',false);
SET ROLE authenticated;
DO $$
DECLARE r uuid:='00000000-0000-4000-8000-000000000002';
BEGIN
  BEGIN
    PERFORM public.pms_finance_post_catalogue(r,ARRAY['00000000-0000-4000-8000-000000000081'::uuid],NULL);
    RAISE EXCEPTION 'Receptionist posted after departure';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM IS DISTINCT FROM 'POST_DEPARTURE_REQUIRES_MANAGER' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.pms_finance_record_payment(r,10,'EUR','card',NULL,now());
    RAISE EXCEPTION 'Receptionist paid after departure';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM IS DISTINCT FROM 'POST_DEPARTURE_REQUIRES_MANAGER' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000098',false);
SET ROLE authenticated;
SELECT public.pms_finance_post_catalogue('00000000-0000-4000-8000-000000000002',ARRAY['00000000-0000-4000-8000-000000000082'::uuid],NULL);
SELECT public.pms_finance_record_payment('00000000-0000-4000-8000-000000000002',6,'EUR','card',NULL,now());
RESET ROLE;
DO $$
BEGIN
  IF (SELECT balance_due FROM public.reservations WHERE id='00000000-0000-4000-8000-000000000002') IS DISTINCT FROM 186 THEN
    RAISE EXCEPTION 'Manager post-departure balance mismatch';
  END IF;
END $$;
