-- Execute after finance-core and Phase 8 fixtures in disposable PostgreSQL.
-- Fault injection ensures any accidental legacy recalculation on native PMS fails.
CREATE OR REPLACE FUNCTION public.pms_recalc_reservation_financials(_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF public.pms_finance_is_native_pms(_id) THEN RAISE EXCEPTION 'LEGACY_RECALC_USED_FOR_NATIVE'; END IF;
END;
$$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000098',false);
SET ROLE authenticated;
DO $$
DECLARE r uuid:='00000000-0000-4000-8000-000000000002'; result jsonb;
BEGIN
 IF NOT public.pms_finance_native_access(r) OR public.pms_finance_native_access('00000000-0000-4000-8000-000000000001') THEN RAISE EXCEPTION 'Wrong native capability'; END IF;
 result:=public.pms_record_business_folio_item(r,'Review mixed posting',7,'other',NULL,NULL);
 IF (result->>'balance_due')::numeric<>193 THEN RAISE EXCEPTION 'Legacy-path balance mismatch: %',result; END IF;
 result:=public.pms_finance_post_catalogue(r,ARRAY['00000000-0000-4000-8000-000000000081'::uuid],NULL);
 IF (result->>'balance_due')::numeric<>198 THEN RAISE EXCEPTION 'Catalogue-path balance mismatch: %',result; END IF;
 result:=public.pms_record_business_folio_item(r,'Review mixed payment',8,'payment',NULL,'cash');
 IF (result->>'balance_due')::numeric<>190 THEN RAISE EXCEPTION 'Mixed payment balance mismatch: %',result; END IF;
END $$;
RESET ROLE;
DO $$
BEGIN
 IF (SELECT total_amount FROM public.reservations WHERE id='00000000-0000-4000-8000-000000000002')<>200 THEN RAISE EXCEPTION 'Booked base was rewritten'; END IF;
 IF (SELECT base_reservation_amount FROM public.reservation_folios WHERE reservation_id='00000000-0000-4000-8000-000000000002' AND folio_type='master')<>200 THEN RAISE EXCEPTION 'Master base was double counted'; END IF;
END $$;
-- Existing reversal and void functions update, not insert, so reception's
-- authorized corrections must not be blocked by the post-departure insert guard.
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000097',false);
SET ROLE authenticated;
SELECT public.pms_finance_reverse_payment(id,'review regression') FROM public.payments WHERE reservation_id='00000000-0000-4000-8000-000000000002' AND amount=8 AND status='recorded';
SELECT public.pms_finance_void_charge(id,'review regression') FROM public.folio_lines WHERE description='Review mixed posting';
RESET ROLE;
DO $$ BEGIN
 IF (SELECT balance_due FROM public.reservations WHERE id='00000000-0000-4000-8000-000000000002')<>191 THEN RAISE EXCEPTION 'Existing reverse/void balance mismatch'; END IF;
END $$;
