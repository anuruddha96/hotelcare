-- Phase 3 follow-up, NEW migration. Does not modify applied Phase 1, finance-core,
-- or Phase 2 migrations. Apply after BOTH 20261123193000 and 20261123193100.
-- Native HotelCare PMS is currently identified by organization_slug='channex'.
-- When per-property PMS ownership is configurable, change ONLY this helper.
-- The finance-core ledger must never replace Previo-imported balances.
CREATE OR REPLACE FUNCTION public.pms_finance_is_native_pms(_reservation_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public
AS $$
  SELECT COALESCE((
    SELECT r.organization_slug = 'channex'
    FROM public.reservations r WHERE r.id = _reservation_id
  ), false);
$$;
REVOKE ALL ON FUNCTION public.pms_finance_is_native_pms(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pms_finance_is_native_pms(uuid) TO service_role;

-- PostgreSQL default is timezone-independent DATE, not CURRENT_DATE from UTC.
-- Makes 00:30 Budapest (winter and summer) the correct *current business day*.
ALTER TABLE public.folio_lines
  ALTER COLUMN service_date SET DEFAULT ((now() AT TIME ZONE 'Europe/Budapest')::date);

CREATE OR REPLACE FUNCTION public.pms_finance_recalculate_reservation(_reservation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  base_amount numeric(14,2) := 0;
  extra_charges numeric(14,2) := 0;
  paid_amount numeric(14,2) := 0;
  new_balance numeric(14,2) := 0;
  pay_status text := 'unpaid';
BEGIN
  -- Defense in depth: even trusted internal callers cannot replace the PMS
  -- balance imported by Previo on an external-PMS reservation.
  IF NOT public.pms_finance_is_native_pms(_reservation_id) THEN
    RETURN;
  END IF;
  SELECT COALESCE(MAX(base_reservation_amount), 0)
    INTO base_amount
  FROM public.reservation_folios
  WHERE reservation_id = _reservation_id
    AND folio_type = 'master'
    AND parent_folio_id IS NULL;

  SELECT COALESCE(SUM(fl.gross_total), 0)
    INTO extra_charges
  FROM public.folio_lines fl
  JOIN public.reservation_folios f ON f.id = fl.folio_id
  WHERE f.reservation_id = _reservation_id
    AND fl.status IN ('open','invoiced');

  SELECT COALESCE(SUM(p.amount), 0)
    INTO paid_amount
  FROM public.payments p
  WHERE p.reservation_id = _reservation_id
    AND p.status IN ('recorded','captured');

  new_balance := ROUND(base_amount + extra_charges - paid_amount, 2);

  IF paid_amount <= 0 THEN
    pay_status := 'unpaid';
  ELSIF new_balance <= 0 THEN
    pay_status := 'paid';
  ELSE
    pay_status := 'partial';
  END IF;

  UPDATE public.reservations
     SET balance_due = new_balance,
         payment_status = pay_status,
         updated_at = now()
   WHERE id = _reservation_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.pms_finance_add_charge(
  _reservation_id uuid,
  _description text,
  _quantity numeric,
  _unit text,
  _gross_unit_price numeric,
  _currency text,
  _vat_code text,
  _vat_rate numeric DEFAULT NULL,
  _service_catalog_item_id uuid DEFAULT NULL,
  _service_date date DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  folio_id uuid;
  f public.reservation_folios%ROWTYPE;
  line_id uuid;
  gross numeric(14,2);
  net numeric(14,2);
  vat numeric(14,2);
  normalized_description text;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.can_access_reservation(auth.uid(), _reservation_id) THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;
  -- Finance-core writes are native-PMS only; never overwrite imported Previo balances.
  IF NOT public.pms_finance_is_native_pms(_reservation_id) THEN
    RAISE EXCEPTION 'EXTERNAL_PMS_LEDGER_READ_ONLY';
  END IF;

  normalized_description := btrim(COALESCE(_description, ''));
  IF normalized_description = '' THEN RAISE EXCEPTION 'INVALID_DESCRIPTION'; END IF;
  IF _quantity IS NULL OR _quantity <= 0 THEN RAISE EXCEPTION 'INVALID_QUANTITY'; END IF;
  IF _gross_unit_price IS NULL OR _gross_unit_price < 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
  IF _vat_rate IS NOT NULL AND (_vat_rate < 0 OR _vat_rate > 100) THEN RAISE EXCEPTION 'INVALID_VAT'; END IF;

  folio_id := public.pms_finance_ensure_master_folio(_reservation_id);
  SELECT * INTO f FROM public.reservation_folios WHERE id = folio_id;

  IF upper(COALESCE(_currency, f.currency)) <> upper(f.currency) THEN
    RAISE EXCEPTION 'CURRENCY_MISMATCH';
  END IF;

  IF _service_catalog_item_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.service_catalog_items sci
    WHERE sci.id = _service_catalog_item_id
      AND sci.organization_slug = f.organization_slug
      AND sci.is_active = true
      AND (cardinality(sci.allowed_hotel_ids) = 0 OR f.hotel_id = ANY(sci.allowed_hotel_ids))
  ) THEN
    RAISE EXCEPTION 'SERVICE_ITEM_NOT_AVAILABLE';
  END IF;

  gross := ROUND(_quantity * _gross_unit_price, 2);
  IF _vat_rate IS NULL THEN
    net := gross;
    vat := 0;
  ELSE
    net := ROUND(gross / (1 + (_vat_rate / 100)), 2);
    vat := ROUND(gross - net, 2);
  END IF;

  INSERT INTO public.folio_lines (
    folio_id, service_catalog_item_id, source_type, description, service_date,
    quantity, unit, currency, gross_unit_price, net_total, vat_code, vat_rate,
    vat_total, gross_total, created_by
  ) VALUES (
    folio_id, _service_catalog_item_id, 'manual', normalized_description,
    COALESCE(_service_date, (now() AT TIME ZONE 'Europe/Budapest')::date), _quantity, COALESCE(NULLIF(btrim(_unit), ''), 'item'),
    upper(f.currency), _gross_unit_price, net, COALESCE(NULLIF(btrim(_vat_code), ''), 'REVIEW_REQUIRED'),
    _vat_rate, vat, gross, auth.uid()
  )
  RETURNING id INTO line_id;

  INSERT INTO public.pms_financial_events (
    organization_slug, hotel_id, reservation_id, folio_id,
    event_type, entity_type, entity_id, amount, currency, actor_user_id,
    metadata
  ) VALUES (
    f.organization_slug, f.hotel_id, _reservation_id, folio_id,
    'charge_added', 'folio_line', line_id, gross, f.currency, auth.uid(),
    jsonb_build_object('description', normalized_description, 'quantity', _quantity, 'vat_code', _vat_code, 'vat_rate', _vat_rate)
  );

  PERFORM public.pms_finance_recalculate_reservation(_reservation_id);
  RETURN line_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.pms_finance_record_payment(
  _reservation_id uuid,
  _amount numeric,
  _currency text,
  _method text,
  _reference text DEFAULT NULL,
  _received_at timestamptz DEFAULT now()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  folio_id uuid;
  f public.reservation_folios%ROWTYPE;
  payment_id uuid;
  method_name text;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.can_access_reservation(auth.uid(), _reservation_id) THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;
  -- Finance-core writes are native-PMS only; never overwrite imported Previo balances.
  IF NOT public.pms_finance_is_native_pms(_reservation_id) THEN
    RAISE EXCEPTION 'EXTERNAL_PMS_LEDGER_READ_ONLY';
  END IF;

  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
  method_name := btrim(COALESCE(_method, ''));
  IF method_name = '' THEN RAISE EXCEPTION 'PAYMENT_METHOD_REQUIRED'; END IF;

  folio_id := public.pms_finance_ensure_master_folio(_reservation_id);
  SELECT * INTO f FROM public.reservation_folios WHERE id = folio_id;

  IF upper(COALESCE(_currency, f.currency)) <> upper(f.currency) THEN
    RAISE EXCEPTION 'CURRENCY_MISMATCH';
  END IF;

  INSERT INTO public.payments (
    organization_slug, hotel_id, reservation_id, folio_id,
    amount, currency, method, reference, status, received_at, created_by
  ) VALUES (
    f.organization_slug, f.hotel_id, _reservation_id, folio_id,
    ROUND(_amount, 2), upper(f.currency), method_name, NULLIF(btrim(COALESCE(_reference,'')), ''),
    'recorded', COALESCE(_received_at, now()), auth.uid()
  )
  RETURNING id INTO payment_id;

  INSERT INTO public.payment_allocations(payment_id, folio_id, amount, created_by)
  VALUES (payment_id, folio_id, ROUND(_amount, 2), auth.uid());

  INSERT INTO public.pms_financial_events (
    organization_slug, hotel_id, reservation_id, folio_id,
    event_type, entity_type, entity_id, amount, currency, actor_user_id,
    metadata
  ) VALUES (
    f.organization_slug, f.hotel_id, _reservation_id, folio_id,
    'payment_recorded', 'payment', payment_id, ROUND(_amount, 2), f.currency, auth.uid(),
    jsonb_build_object('method', method_name, 'reference', _reference)
  );

  PERFORM public.pms_finance_recalculate_reservation(_reservation_id);
  RETURN payment_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.pms_finance_void_charge(_line_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  line public.folio_lines%ROWTYPE;
  f public.reservation_folios%ROWTYPE;
BEGIN
  SELECT * INTO line FROM public.folio_lines WHERE id = _line_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CHARGE_NOT_FOUND'; END IF;
  SELECT * INTO f FROM public.reservation_folios WHERE id = line.folio_id;

  IF auth.uid() IS NOT NULL AND NOT public.can_access_reservation(auth.uid(), f.reservation_id) THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;
  -- Finance-core writes are native-PMS only; never overwrite imported Previo balances.
  IF NOT public.pms_finance_is_native_pms(f.reservation_id) THEN
    RAISE EXCEPTION 'EXTERNAL_PMS_LEDGER_READ_ONLY';
  END IF;
  IF line.status <> 'open' THEN RAISE EXCEPTION 'CHARGE_LOCKED'; END IF;
  IF btrim(COALESCE(_reason,'')) = '' THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;

  UPDATE public.folio_lines
     SET status = 'voided', adjustment_reason = _reason, updated_at = now()
   WHERE id = _line_id;

  INSERT INTO public.pms_financial_events (
    organization_slug, hotel_id, reservation_id, folio_id,
    event_type, entity_type, entity_id, amount, currency, actor_user_id, metadata
  ) VALUES (
    f.organization_slug, f.hotel_id, f.reservation_id, f.id,
    'charge_voided', 'folio_line', line.id, line.gross_total, line.currency, auth.uid(),
    jsonb_build_object('reason', _reason)
  );

  PERFORM public.pms_finance_recalculate_reservation(f.reservation_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.pms_finance_reverse_payment(_payment_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  p public.payments%ROWTYPE;
BEGIN
  SELECT * INTO p FROM public.payments WHERE id = _payment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAYMENT_NOT_FOUND'; END IF;

  IF auth.uid() IS NOT NULL AND NOT public.can_access_reservation(auth.uid(), p.reservation_id) THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;
  -- Finance-core writes are native-PMS only; never overwrite imported Previo balances.
  IF NOT public.pms_finance_is_native_pms(p.reservation_id) THEN
    RAISE EXCEPTION 'EXTERNAL_PMS_LEDGER_READ_ONLY';
  END IF;
  IF p.status NOT IN ('recorded','captured') THEN RAISE EXCEPTION 'PAYMENT_LOCKED'; END IF;
  IF btrim(COALESCE(_reason,'')) = '' THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;

  UPDATE public.payments
     SET status = 'reversed', updated_at = now()
   WHERE id = _payment_id;

  INSERT INTO public.pms_financial_events (
    organization_slug, hotel_id, reservation_id, folio_id,
    event_type, entity_type, entity_id, amount, currency, actor_user_id, metadata
  ) VALUES (
    p.organization_slug, p.hotel_id, p.reservation_id, p.folio_id,
    'payment_reversed', 'payment', p.id, p.amount, p.currency, auth.uid(),
    jsonb_build_object('reason', _reason)
  );

  PERFORM public.pms_finance_recalculate_reservation(p.reservation_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.pms_record_business_folio_item(
  _reservation_id uuid,_description text,_amount numeric,_charge_type text,
  _business_day date DEFAULT NULL,_method text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor uuid := auth.uid();
  r public.reservations%ROWTYPE;
  legacy_id uuid;
  ledger_id uuid;
  balance numeric;
  adjustment_folio_id uuid;
  day date := COALESCE(_business_day,(now() AT TIME ZONE 'Europe/Budapest')::date);
  paid_at timestamptz;
BEGIN
  SELECT * INTO r FROM public.reservations WHERE id=_reservation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RESERVATION_NOT_FOUND'; END IF;
  IF actor IS NULL OR NOT public.can_access_pms_hotel(actor,r.hotel_id,r.organization_slug) THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
  IF r.status IN ('cancelled','no_show') THEN RAISE EXCEPTION 'INVALID_STATUS'; END IF;
  IF COALESCE(btrim(_description),'')='' OR length(_description)>300 THEN RAISE EXCEPTION 'INVALID_DESCRIPTION'; END IF;
  IF _amount IS NULL OR _amount=0 OR ABS(_amount)>100000000 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
  IF _charge_type NOT IN ('room','minibar','restaurant','bar','spa','city_tax','service','payment','adjustment','other') THEN
    RAISE EXCEPTION 'INVALID_CHARGE_TYPE';
  END IF;
  -- Refund-like negative lines are permitted only as auditable adjustments;
  -- payments and normal service charges must remain positive.
  IF _amount < 0 AND _charge_type <> 'adjustment' THEN
    RAISE EXCEPTION 'NEGATIVE_AMOUNT_REQUIRES_ADJUSTMENT';
  END IF;
  IF _business_day IS NOT NULL AND day<>(now() AT TIME ZONE 'Europe/Budapest')::date THEN
    PERFORM public.pms_assert_business_moment(r.hotel_id,r.organization_slug,
      (day + time '12:00') AT TIME ZONE 'Europe/Budapest');
  END IF;
  paid_at := (day + time '12:00') AT TIME ZONE 'Europe/Budapest';
  INSERT INTO public.guest_folios(reservation_id,guest_id,description,amount,charge_type,charge_date,created_by)
  VALUES(r.id,r.guest_id,btrim(_description),_amount,_charge_type,day,actor) RETURNING id INTO legacy_id;
  -- The legacy guest folio is deployed even in instances where the earlier
  -- financial-core migration has not yet been applied. Preserve dated
  -- operations now and mirror them once that core is available.
  IF public.pms_finance_is_native_pms(r.id)
     AND to_regclass('public.reservation_folios') IS NOT NULL
     AND to_regclass('public.folio_lines') IS NOT NULL
     AND to_regclass('public.payments') IS NOT NULL THEN
    IF _charge_type='payment' THEN
      ledger_id := public.pms_finance_record_payment(r.id,_amount,r.currency,COALESCE(NULLIF(btrim(_method),''),'other'),NULL,paid_at);
      UPDATE public.payments SET legacy_guest_folio_id=legacy_id WHERE id=ledger_id;
    ELSIF _charge_type='adjustment' AND _amount < 0 THEN
      -- pms_finance_add_charge rejects negative gross prices. Store a signed
      -- adjustment line directly; both ledgers then reduce the balance by the
      -- same amount and preserve the original business day.
      adjustment_folio_id := public.pms_finance_ensure_master_folio(r.id);
      INSERT INTO public.folio_lines (
        folio_id,source_type,description,service_date,quantity,unit,currency,
        gross_unit_price,net_total,vat_code,vat_rate,vat_total,gross_total,
        legacy_guest_folio_id,created_by
      ) VALUES (
        adjustment_folio_id,'adjustment',btrim(_description),day,1,'item',
        COALESCE(r.currency,'HUF'),_amount,_amount,'REVIEW_REQUIRED',NULL,0,
        _amount,legacy_id,actor
      ) RETURNING id INTO ledger_id;
      INSERT INTO public.pms_financial_events (
        organization_slug,hotel_id,reservation_id,folio_id,event_type,entity_type,
        entity_id,amount,currency,actor_user_id,metadata
      ) VALUES (
        r.organization_slug,r.hotel_id,r.id,adjustment_folio_id,'charge_added','folio_line',
        ledger_id,_amount,COALESCE(r.currency,'HUF'),actor,
        jsonb_build_object('description',btrim(_description),'charge_type','adjustment','business_day',day)
      );
      PERFORM public.pms_finance_recalculate_reservation(r.id);
    ELSE
      ledger_id := public.pms_finance_add_charge(r.id,btrim(_description),1,'item',_amount,r.currency,'REVIEW_REQUIRED',NULL,NULL,day);
      UPDATE public.folio_lines SET legacy_guest_folio_id=legacy_id,source_type=_charge_type WHERE id=ledger_id;
    END IF;
  END IF;
  -- Preserve the established reception balance until all legacy folios are
  -- migrated into the financial-core ledger.
  PERFORM public.pms_recalc_reservation_financials(r.id);
  SELECT balance_due INTO balance FROM public.reservations WHERE id=r.id;
  INSERT INTO public.reservation_events(reservation_id,hotel_id,organization_slug,event_type,metadata,created_by)
  VALUES(r.id,r.hotel_id,r.organization_slug,
    CASE WHEN _charge_type='payment' THEN 'payment' ELSE 'folio_charge' END,
    jsonb_build_object('business_day',day,'ledger_id',ledger_id,'amount',_amount,'charge_type',_charge_type),actor);
  RETURN jsonb_build_object('ok',true,'reservation_id',r.id,'balance_due',balance,'ledger_id',ledger_id);
END;
$$;

-- Replacements retain existing function signatures and public grants. Service
-- role retains finance-core access for the native-PMS hotel only.
REVOKE ALL ON FUNCTION public.pms_finance_add_charge(uuid,text,numeric,text,numeric,text,text,numeric,uuid,date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pms_finance_record_payment(uuid,numeric,text,text,text,timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pms_finance_void_charge(uuid,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pms_finance_reverse_payment(uuid,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pms_finance_recalculate_reservation(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pms_record_business_folio_item(uuid,text,numeric,text,date,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pms_finance_add_charge(uuid,text,numeric,text,numeric,text,text,numeric,uuid,date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pms_finance_record_payment(uuid,numeric,text,text,text,timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pms_finance_void_charge(uuid,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pms_finance_reverse_payment(uuid,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pms_finance_recalculate_reservation(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.pms_record_business_folio_item(uuid,text,numeric,text,date,text) TO authenticated;
