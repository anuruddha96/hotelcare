-- Phase 5: run only against the disposable CI database.
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000071',false);
SET ROLE authenticated;
DO $$
DECLARE
  sale uuid:='00000000-0000-4000-8000-000000000301';
  lines jsonb:='[
    {"service_catalog_item_id":"00000000-0000-4000-8000-000000000201","gross_total":5800},
    {"service_catalog_item_id":"00000000-0000-4000-8000-000000000202","gross_total":4600,"ntak_main":"ETEL","ntak_sub":"FOETEL"},
    {"service_catalog_item_id":"00000000-0000-4000-8000-000000000203","gross_total":1000,"ntak_main":"EGYEB","ntak_sub":"EGYEB_VENDEGLATAS"},
    {"service_catalog_item_id":"00000000-0000-4000-8000-000000000204","gross_total":10000}
  ]';
  payments jsonb:='[{"method":"card_terminal","amount":21400}]';
BEGIN
  PERFORM public.pms_record_walk_in_sale('channex-test-property','2026-11-18',lines,payments,'NZ_02',sale);
  PERFORM public.pms_record_walk_in_sale('channex-test-property','2026-11-18',lines,payments,'NZ_02',sale);
  IF (SELECT count(*) FROM public.pos_sales WHERE id=sale)<>1
    OR (SELECT count(*) FROM public.pos_sale_lines WHERE sale_id=sale)<>4
    OR (SELECT sum(gross_total) FROM public.pos_sale_lines WHERE sale_id=sale)<>21400
    OR (SELECT count(*) FROM public.pos_sale_payments WHERE sale_id=sale)<>1
    OR (SELECT sum(amount) FROM public.pos_sale_payments WHERE sale_id=sale)<>21400
    OR NOT EXISTS(SELECT 1 FROM public.pos_sale_lines WHERE sale_id=sale AND ntak_main='KOZFURDO' AND vat_rate=18 AND gross_total=5800)
    OR NOT EXISTS(SELECT 1 FROM public.pos_sale_lines WHERE sale_id=sale AND ntak_sub='FOETEL' AND vat_rate=5 AND gross_total=4600)
    OR NOT EXISTS(SELECT 1 FROM public.pos_sale_lines WHERE sale_id=sale AND ntak_sub='EGYEB_VENDEGLATAS' AND vat_rate=27 AND gross_total=1000)
    OR NOT EXISTS(SELECT 1 FROM public.pos_sale_lines WHERE sale_id=sale AND ntak_main='ALKOHOLOSITAL' AND vat_rate=27 AND gross_total=10000)
  THEN RAISE EXCEPTION 'NZ_02 totals or classification incorrect'; END IF;
  BEGIN
    PERFORM public.pms_record_walk_in_sale('channex-test-property','2026-11-18',lines,'[{"method":"cash","amount":1}]','bad');
    RAISE EXCEPTION 'unbalanced sale accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'SALE_PAYMENT_TOTAL_MISMATCH' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.pms_record_walk_in_sale('channex-test-property','2026-11-18',lines,payments,'modified',sale);
    RAISE EXCEPTION 'changed retry accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'SALE_ID_REUSED_WITH_DIFFERENT_DATA' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.pms_record_walk_in_sale('channex-test-property','2026-11-18',
      '[{"service_catalog_item_id":"00000000-0000-4000-8000-000000000205","gross_total":100}]','[{"method":"cash","amount":100}]','bad tenant');
    RAISE EXCEPTION 'foreign catalogue accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'INVALID_CATALOG_ITEM' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.pms_record_walk_in_sale('channex-test-property','2026-11-18',
      '[{"service_catalog_item_id":"00000000-0000-4000-8000-000000000201","gross_total":100,"ntak_main":"SZALLASDIJ","ntak_sub":"EGYEB"}]','[{"method":"cash","amount":100}]');
    RAISE EXCEPTION 'accommodation charge accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  IF (SELECT count(*) FROM public.pos_sales)<>1 THEN RAISE EXCEPTION 'partial sale persisted'; END IF;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000074',false);
SET ROLE authenticated;
DO $$
BEGIN
  BEGIN
    PERFORM public.pms_record_walk_in_sale('channex-test-property',(now() AT TIME ZONE 'Europe/Budapest')::date-1,
      '[{"service_catalog_item_id":"00000000-0000-4000-8000-000000000201","gross_total":100}]','[{"method":"cash","amount":100}]');
    RAISE EXCEPTION 'reception backdated sale';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'BACKDATING_REQUIRES_MANAGER' THEN RAISE; END IF; END;
  PERFORM public.pms_record_walk_in_sale('channex-test-property',NULL,
    '[{"service_catalog_item_id":"00000000-0000-4000-8000-000000000201","gross_total":100}]',
    '[{"method":"cash","amount":50},{"method":"card_terminal","amount":50}]');
  BEGIN
    INSERT INTO public.pos_sales(id,hotel_id,organization_slug,business_day,created_by,request_payload)
      VALUES(gen_random_uuid(),'channex-test-property','channex',current_date,auth.uid(),'{}');
    RAISE EXCEPTION 'direct ledger write permitted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000073',false);
SET ROLE authenticated;
DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM public.pos_sales) OR EXISTS(SELECT 1 FROM public.pos_sale_lines) OR EXISTS(SELECT 1 FROM public.pos_sale_payments)
  THEN RAISE EXCEPTION 'Cross-tenant ledger leaked'; END IF;
END $$;
RESET ROLE;
