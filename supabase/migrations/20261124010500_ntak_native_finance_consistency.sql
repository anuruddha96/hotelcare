-- Native mirrored financial postings share the finance-core balance. No historical amount rewrite.
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
  -- A mirrored native posting must never recalculate via the legacy ledger.
  -- Keep the booked total as the base; core adds extras and subtracts payments.
  IF ledger_id IS NOT NULL THEN
    PERFORM public.pms_finance_recalculate_reservation(r.id);
  ELSE
    PERFORM public.pms_recalc_reservation_financials(r.id);
  END IF;
  SELECT balance_due INTO balance FROM public.reservations WHERE id=r.id;
  INSERT INTO public.reservation_events(reservation_id,hotel_id,organization_slug,event_type,metadata,created_by)
  VALUES(r.id,r.hotel_id,r.organization_slug,
    CASE WHEN _charge_type='payment' THEN 'payment' ELSE 'folio_charge' END,
    jsonb_build_object('business_day',day,'ledger_id',ledger_id,'amount',_amount,'charge_type',_charge_type),actor);
  RETURN jsonb_build_object('ok',true,'reservation_id',r.id,'balance_due',balance,'ledger_id',ledger_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.pms_phase8_posting_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.reservations%ROWTYPE;
  item public.service_catalog_items%ROWTYPE;
  actor uuid := auth.uid();
  managerial boolean;
BEGIN
  IF TG_TABLE_NAME = 'folio_lines' THEN
    SELECT res.* INTO r FROM public.reservations res
      JOIN public.reservation_folios f ON f.reservation_id = res.id WHERE f.id = NEW.folio_id;
  ELSE
    SELECT * INTO r FROM public.reservations WHERE id = NEW.reservation_id;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'RESERVATION_NOT_FOUND'; END IF;
  -- Internal imports with no authenticated caller retain their current behavior.
  IF actor IS NULL OR NOT public.pms_finance_is_native_pms(r.id) THEN RETURN NEW; END IF;
  managerial := COALESCE(public.get_user_role(actor)::text IN ('admin','manager','top_management','top_management_manager'),false);
  IF r.status IN ('cancelled','no_show') THEN RAISE EXCEPTION 'INVALID_STATUS'; END IF;
  IF r.status = 'checked_out' AND NOT managerial THEN RAISE EXCEPTION 'POST_DEPARTURE_REQUIRES_MANAGER'; END IF;
  IF TG_TABLE_NAME = 'folio_lines' THEN
    IF NEW.service_catalog_item_id IS NOT NULL THEN
      SELECT * INTO item FROM public.service_catalog_items WHERE id = NEW.service_catalog_item_id;
      IF NOT FOUND OR item.organization_slug <> r.organization_slug OR NOT item.is_active
        OR (cardinality(item.allowed_hotel_ids) > 0 AND NOT (r.hotel_id = ANY(item.allowed_hotel_ids)))
        OR upper(item.currency) <> upper(NEW.currency) THEN RAISE EXCEPTION 'SERVICE_ITEM_NOT_AVAILABLE'; END IF;
      IF item.requires_manager_approval AND NOT managerial THEN RAISE EXCEPTION 'SERVICE_ITEM_REQUIRES_MANAGER'; END IF;
      IF NOT item.price_editable AND NEW.gross_unit_price <> item.default_gross_price THEN RAISE EXCEPTION 'SERVICE_PRICE_LOCKED'; END IF;
      -- Room base amount is already on the financial account. A separate
      -- accommodation catalogue line must not double-bill a nonzero base.
      IF item.ntak_main = 'SZALLASDIJ' AND EXISTS (
        SELECT 1 FROM public.reservation_folios f WHERE f.reservation_id=r.id AND f.folio_type='master'
        AND f.parent_folio_id IS NULL AND f.base_reservation_amount > 0
      ) THEN RAISE EXCEPTION 'ACCOMMODATION_ALREADY_IN_BASE_RATE'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- The existing native classifier stays internal. Expose only a scoped capability.
CREATE OR REPLACE FUNCTION public.pms_finance_native_access(_reservation_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT COALESCE(auth.uid() IS NOT NULL AND public.can_access_reservation(auth.uid(),_reservation_id)
   AND EXISTS(SELECT 1 FROM public.reservations r WHERE r.id=_reservation_id AND public.can_access_pms_hotel(auth.uid(),r.hotel_id,r.organization_slug))
   AND public.pms_finance_is_native_pms(_reservation_id),false);
$$;
REVOKE ALL ON FUNCTION public.pms_finance_native_access(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pms_finance_native_access(uuid) TO authenticated;
