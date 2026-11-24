-- Disposable PostgreSQL only, after Phase 8 catalogue integration.
-- Run unchanged before and after the new finance-consistency migration.
-- Owner SQL bypasses table RLS only to isolate the BEFORE INSERT trigger;
-- auth.uid() still resolves a non-manager reception actor. No privilege
-- or RLS changes are made, and all test writes are rolled back.
BEGIN;
INSERT INTO public.profiles(id,role,organization_slug)
VALUES ('00000000-0000-4000-8000-000000000096','reception','rdhotels');
INSERT INTO public.hotel_access(user_id,hotel_id)
VALUES ('00000000-0000-4000-8000-000000000096','previo-hotel');
UPDATE public.reservations SET organization_slug=NULL,status='checked_out'
WHERE id='00000000-0000-4000-8000-000000000001';
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000096',true);
DO $$
DECLARE ext uuid:='00000000-0000-4000-8000-000000000001';
        fol uuid:='00000000-0000-4000-8000-000000000003';
        native uuid:='00000000-0000-4000-8000-000000000002';
        native_folio uuid;
BEGIN
  IF auth.uid() IS DISTINCT FROM '00000000-0000-4000-8000-000000000096'::uuid
    OR public.get_user_role(auth.uid())::text IS DISTINCT FROM 'reception' THEN
    RAISE EXCEPTION 'Invalid regression actor';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.reservations WHERE id=ext AND organization_slug IS NULL AND status='checked_out') THEN
    RAISE EXCEPTION 'NULL organization fixture absent';
  END IF;
  IF public.pms_finance_is_native_pms(ext) IS DISTINCT FROM false
    OR public.pms_finance_is_native_pms(native) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Native classifier is not NULL-safe';
  END IF;
  -- Old Phase 8 guard fails on this first insert: NULL <> 'channex' is NULL.
  INSERT INTO public.guest_folios(reservation_id,description,amount,charge_type,charge_date,created_by)
  VALUES(ext,'NULL org legacy posting',2,'other',current_date,auth.uid());
  INSERT INTO public.payments(organization_slug,hotel_id,reservation_id,folio_id,amount,currency,method,status)
  VALUES('rdhotels','previo-hotel',ext,fol,3,'EUR','cash','recorded');
  INSERT INTO public.folio_lines(folio_id,source_type,description,service_date,quantity,unit,currency,gross_unit_price,net_total,vat_code,vat_total,gross_total)
  VALUES(fol,'manual','NULL org folio line',current_date,1,'item','EUR',4,4,'REVIEW_REQUIRED',0,4);
  IF NOT EXISTS(SELECT 1 FROM public.guest_folios WHERE reservation_id=ext AND description='NULL org legacy posting')
    OR NOT EXISTS(SELECT 1 FROM public.payments WHERE reservation_id=ext AND amount=3)
    OR NOT EXISTS(SELECT 1 FROM public.folio_lines WHERE folio_id=fol AND description='NULL org folio line') THEN
    RAISE EXCEPTION 'External NULL organization postings were not preserved';
  END IF;
  IF (SELECT balance_due FROM public.reservations WHERE id=ext) IS DISTINCT FROM 73 THEN
    RAISE EXCEPTION 'Imported external balance changed';
  END IF;
  -- Same non-manager role on a checked-out native reservation remains blocked
  -- by each of the three trigger paths, irrespective of table owner access.
  PERFORM set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000097',true);
  SELECT id INTO STRICT native_folio FROM public.reservation_folios WHERE reservation_id=native AND folio_type='master' AND parent_folio_id IS NULL;
  BEGIN
    INSERT INTO public.guest_folios(reservation_id,description,amount,charge_type,charge_date,created_by)
    VALUES(native,'Native forbidden legacy posting',2,'other',current_date,auth.uid());
    RAISE EXCEPTION 'Native guest folio bypass';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM IS DISTINCT FROM 'POST_DEPARTURE_REQUIRES_MANAGER' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO public.payments(organization_slug,hotel_id,reservation_id,folio_id,amount,currency,method,status)
    VALUES('channex','native-hotel',native,native_folio,3,'EUR','cash','recorded');
    RAISE EXCEPTION 'Native payment bypass';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM IS DISTINCT FROM 'POST_DEPARTURE_REQUIRES_MANAGER' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO public.folio_lines(folio_id,source_type,description,service_date,quantity,unit,currency,gross_unit_price,net_total,vat_code,vat_total,gross_total)
    VALUES(native_folio,'manual','Native forbidden folio line',current_date,1,'item','EUR',4,4,'REVIEW_REQUIRED',0,4);
    RAISE EXCEPTION 'Native folio line bypass';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM IS DISTINCT FROM 'POST_DEPARTURE_REQUIRES_MANAGER' THEN RAISE; END IF;
  END;
END $$;
ROLLBACK;
