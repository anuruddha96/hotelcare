-- Phase 8 only. Apply after financial-core schema. No production seed.
ALTER TABLE public.service_catalog_items
  ADD COLUMN IF NOT EXISTS ntak_main text,
  ADD COLUMN IF NOT EXISTS ntak_sub text,
  ADD COLUMN IF NOT EXISTS in_package boolean NOT NULL DEFAULT false;

-- Category pairs correspond exactly to _shared/ntak/codes.ts (annex 12.3).
ALTER TABLE public.service_catalog_items ADD CONSTRAINT service_catalog_ntak_category_check CHECK (
  (ntak_main IS NULL AND ntak_sub IS NULL AND NOT in_package)
  OR (ntak_main IS NOT NULL AND (
    (ntak_main = 'SZALLASDIJ' AND ntak_sub IS NULL)
    OR (ntak_main = 'IFA' AND ntak_sub IS NULL)
    OR (ntak_main = 'KOZFURDO' AND ntak_sub IS NOT NULL AND ntak_sub IN ('FURDO_PROGRAM', 'STRAND_PROGRAM', 'USZODAI_PROGRAM', 'WELLNESS_PROGRAM', 'EGESZSEGUGYI_SZOLGALTATAS'))
    OR (ntak_main = 'TERMESZETES_FURDO' AND ntak_sub IS NOT NULL AND ntak_sub IN ('SZABADVIZI_STRAND_PROGRAM'))
    OR (ntak_main = 'MUZEUM_VAR_KASTELY' AND ntak_sub IS NOT NULL AND ntak_sub IN ('KIALLITAS', 'MUZEUMPEDAGOGIA', 'TARLATVEZETES', 'EGYHAZI_LETESITMENY_LATOGATASA', 'KASTELYLATOGATAS', 'VARLATOGATAS', 'EGYEB_MUEMLEK_LATOGATASA', 'OKTATASI_PROGRAM'))
    OR (ntak_main = 'TURISZTIKAI_KOZLEKEDES' AND ntak_sub IS NOT NULL AND ntak_sub IN ('TAVI_HAJOZAS', 'FOLYAMI_HAJOZAS', 'HOP_ON_HOP_OFF'))
    OR (ntak_main = 'KALANDPARK' AND ntak_sub IS NOT NULL AND ntak_sub IN ('KALANDPARKI_PROGRAM', 'ELMENYKOZPONTI_PROGRAM'))
    OR (ntak_main = 'ALLATKERT' AND ntak_sub IS NOT NULL AND ntak_sub IN ('ALLATKERTI_PROGRAM', 'VADASPARKI_PROGRAM'))
    OR (ntak_main = 'VIDAMPARK' AND ntak_sub IS NOT NULL AND ntak_sub IN ('VIDAMPARKI_PROGRAM'))
    OR (ntak_main = 'VEDETT_TERMESZETI_TERULET' AND ntak_sub IS NOT NULL AND ntak_sub IN ('NEMZETI_PARK_LATOGATAS', 'BARLANGLATOGATAS', 'TARLATVEZETES', 'OKTATASI_PROGRAM', 'PARKLATOGATAS', 'TEMATIKUS_BEMUTATOHELY_LATOGATAS', 'TURAK_KIRANDULASOK'))
    OR (ntak_main = 'ZENES_TANCOS_RENDEZVENY' AND ntak_sub IS NOT NULL AND ntak_sub IN ('KULTURALIS_RENDEZVENY', 'KONCERT', 'FESZTIVAL'))
    OR (ntak_main = 'ETEL' AND ntak_sub IS NOT NULL AND ntak_sub IN ('REGGELI', 'SZENDVICS', 'ELOETEL', 'LEVES', 'FOETEL', 'KORET', 'SAVANYUSAG_SALATA', 'KOSTOLO', 'PEKSUTEMENY', 'DESSZERT', 'SNACK', 'FOETEL_KORETTEL', 'ETELCSOMAG', 'EGYEB'))
    OR (ntak_main = 'ALKMENTESITAL_HELYBEN' AND ntak_sub IS NOT NULL AND ntak_sub IN ('VIZ', 'LIMONADE_SZORP_FACSART', 'ALKOHOLMENTES_KOKTEL', 'TEA_FORROCSOKOLADE', 'ITALCSOMAG', 'KAVE'))
    OR (ntak_main = 'ALKMENTESITAL_NEM_HELYBEN' AND ntak_sub IS NOT NULL AND ntak_sub IN ('VIZ', 'ROSTOS_UDITO', 'SZENSAVAS_UDITO', 'SZENSAVMENTES_UDITO', 'ITALCSOMAG'))
    OR (ntak_main = 'ALKOHOLOSITAL' AND ntak_sub IS NOT NULL AND ntak_sub IN ('KOKTEL', 'LIKOR', 'PARLAT', 'SOR', 'BOR', 'PEZSGO', 'ITALCSOMAG'))
    OR (ntak_main = 'EGYEB' AND ntak_sub IS NOT NULL AND ntak_sub IN ('EGYEB', 'SZERVIZDIJ', 'BORRAVALO', 'EGYEB_VENDEGLATAS'))
  ) AND (ntak_main <> 'SZALLASDIJ' OR in_package) AND (ntak_main <> 'IFA' OR NOT in_package))
);

-- Server-side gate applies to every finance route, including direct RPC callers.
-- Existing posted entries can still be voided/reversed via their established RPC.
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
  IF actor IS NULL OR r.organization_slug <> 'channex' THEN RETURN NEW; END IF;
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
REVOKE ALL ON FUNCTION public.pms_phase8_posting_guard() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER pms_phase8_posting_guard BEFORE INSERT ON public.folio_lines
  FOR EACH ROW EXECUTE FUNCTION public.pms_phase8_posting_guard();
CREATE TRIGGER pms_phase8_posting_guard BEFORE INSERT ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.pms_phase8_posting_guard();
CREATE TRIGGER pms_phase8_posting_guard BEFORE INSERT ON public.guest_folios
  FOR EACH ROW EXECUTE FUNCTION public.pms_phase8_posting_guard();

-- Atomic multi-select posting. Use server catalogue price, VAT and currency,
-- never client-provided financial attributes. No partial success.
CREATE OR REPLACE FUNCTION public.pms_finance_post_catalogue(
  _reservation_id uuid, _item_ids uuid[], _service_date date
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor uuid := auth.uid();
  r public.reservations%ROWTYPE;
  item public.service_catalog_items%ROWTYPE;
  item_id uuid;
  line_id uuid;
  legacy_id uuid;
  balance numeric;
  day date := COALESCE(_service_date,(now() AT TIME ZONE 'Europe/Budapest')::date);
BEGIN
  SELECT * INTO r FROM public.reservations WHERE id=_reservation_id FOR UPDATE;
  IF NOT FOUND OR actor IS NULL OR NOT public.can_access_pms_hotel(actor,r.hotel_id,r.organization_slug)
     OR NOT public.can_access_reservation(actor,_reservation_id) THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
  IF NOT public.pms_finance_is_native_pms(r.id) THEN RAISE EXCEPTION 'EXTERNAL_PMS_LEDGER_READ_ONLY'; END IF;
  IF COALESCE(cardinality(_item_ids),0) NOT BETWEEN 1 AND 100 OR
     (SELECT count(DISTINCT x) FROM unnest(_item_ids) x) <> cardinality(_item_ids)
  THEN RAISE EXCEPTION 'INVALID_CATALOGUE_SELECTION'; END IF;
  IF day<>(now() AT TIME ZONE 'Europe/Budapest')::date THEN
    PERFORM public.pms_assert_business_moment(r.hotel_id,r.organization_slug,(day+time '12:00') AT TIME ZONE 'Europe/Budapest');
  END IF;
  FOREACH item_id IN ARRAY _item_ids LOOP
    SELECT * INTO item FROM public.service_catalog_items WHERE id=item_id FOR SHARE;
    IF NOT FOUND OR item.organization_slug<>r.organization_slug OR NOT item.is_active
      OR (cardinality(item.allowed_hotel_ids)>0 AND NOT (r.hotel_id=ANY(item.allowed_hotel_ids)))
      OR upper(item.currency)<>upper(COALESCE(r.currency,'HUF')) THEN RAISE EXCEPTION 'SERVICE_ITEM_NOT_AVAILABLE'; END IF;
    IF item.ntak_main = 'SZALLASDIJ' THEN RAISE EXCEPTION 'ACCOMMODATION_ALREADY_IN_BASE_RATE'; END IF;
    IF item.default_gross_price <= 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
    -- Mirror the legacy account, which reception and invoicing still read.
    INSERT INTO public.guest_folios(reservation_id,guest_id,description,amount,charge_type,charge_date,created_by)
    VALUES(r.id,r.guest_id,item.name,item.default_gross_price,CASE WHEN item.ntak_main='IFA' THEN 'city_tax' ELSE 'other' END,day,actor)
    RETURNING id INTO legacy_id;
    line_id := public.pms_finance_add_charge(r.id,item.name,1,item.unit,item.default_gross_price,item.currency,
      item.vat_code,item.vat_rate,item.id,day);
    UPDATE public.folio_lines SET legacy_guest_folio_id=legacy_id WHERE id=line_id;
  END LOOP;
  PERFORM public.pms_finance_recalculate_reservation(r.id);
  SELECT balance_due INTO balance FROM public.reservations WHERE id=r.id;
  RETURN jsonb_build_object('posted',cardinality(_item_ids),'balance_due',balance);
END;
$$;
REVOKE ALL ON FUNCTION public.pms_finance_post_catalogue(uuid,uuid[],date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.pms_finance_post_catalogue(uuid,uuid[],date) TO authenticated;
