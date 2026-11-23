-- NTAK Phase 5: non-reservation sales. Apply only after Phase 2 and review.
-- HUF only; an atomic sale RPC is the only client write path.
CREATE TABLE public.pos_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL,
  organization_slug text NOT NULL,
  business_day date NOT NULL,
  note text NOT NULL DEFAULT '' CHECK (length(note)<=500),
  created_by uuid NOT NULL,
  request_payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pos_sales_property_day_idx ON public.pos_sales(hotel_id,organization_slug,business_day,id);

CREATE TABLE public.pos_sale_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES public.pos_sales(id) ON DELETE RESTRICT,
  service_catalog_item_id uuid NOT NULL REFERENCES public.service_catalog_items(id) ON DELETE RESTRICT,
  description text NOT NULL,
  gross_total numeric(14,2) NOT NULL CHECK (gross_total>0),
  vat_rate numeric(7,4) NOT NULL CHECK (vat_rate IN (0,5,18,27)),
  ntak_main text NOT NULL,
  ntak_sub text NOT NULL,
  CONSTRAINT pos_sale_line_other_category CHECK ((ntak_main,ntak_sub) IN (
    ('KOZFURDO','FURDO_PROGRAM'),
    ('KOZFURDO','STRAND_PROGRAM'),
    ('KOZFURDO','USZODAI_PROGRAM'),
    ('KOZFURDO','WELLNESS_PROGRAM'),
    ('KOZFURDO','EGESZSEGUGYI_SZOLGALTATAS'),
    ('TERMESZETES_FURDO','SZABADVIZI_STRAND_PROGRAM'),
    ('MUZEUM_VAR_KASTELY','KIALLITAS'),
    ('MUZEUM_VAR_KASTELY','MUZEUMPEDAGOGIA'),
    ('MUZEUM_VAR_KASTELY','TARLATVEZETES'),
    ('MUZEUM_VAR_KASTELY','EGYHAZI_LETESITMENY_LATOGATASA'),
    ('MUZEUM_VAR_KASTELY','KASTELYLATOGATAS'),
    ('MUZEUM_VAR_KASTELY','VARLATOGATAS'),
    ('MUZEUM_VAR_KASTELY','EGYEB_MUEMLEK_LATOGATASA'),
    ('MUZEUM_VAR_KASTELY','OKTATASI_PROGRAM'),
    ('TURISZTIKAI_KOZLEKEDES','TAVI_HAJOZAS'),
    ('TURISZTIKAI_KOZLEKEDES','FOLYAMI_HAJOZAS'),
    ('TURISZTIKAI_KOZLEKEDES','HOP_ON_HOP_OFF'),
    ('KALANDPARK','KALANDPARKI_PROGRAM'),
    ('KALANDPARK','ELMENYKOZPONTI_PROGRAM'),
    ('ALLATKERT','ALLATKERTI_PROGRAM'),
    ('ALLATKERT','VADASPARKI_PROGRAM'),
    ('VIDAMPARK','VIDAMPARKI_PROGRAM'),
    ('VEDETT_TERMESZETI_TERULET','NEMZETI_PARK_LATOGATAS'),
    ('VEDETT_TERMESZETI_TERULET','BARLANGLATOGATAS'),
    ('VEDETT_TERMESZETI_TERULET','TARLATVEZETES'),
    ('VEDETT_TERMESZETI_TERULET','OKTATASI_PROGRAM'),
    ('VEDETT_TERMESZETI_TERULET','PARKLATOGATAS'),
    ('VEDETT_TERMESZETI_TERULET','TEMATIKUS_BEMUTATOHELY_LATOGATAS'),
    ('VEDETT_TERMESZETI_TERULET','TURAK_KIRANDULASOK'),
    ('ZENES_TANCOS_RENDEZVENY','KULTURALIS_RENDEZVENY'),
    ('ZENES_TANCOS_RENDEZVENY','KONCERT'),
    ('ZENES_TANCOS_RENDEZVENY','FESZTIVAL'),
    ('ETEL','REGGELI'),
    ('ETEL','SZENDVICS'),
    ('ETEL','ELOETEL'),
    ('ETEL','LEVES'),
    ('ETEL','FOETEL'),
    ('ETEL','KORET'),
    ('ETEL','SAVANYUSAG_SALATA'),
    ('ETEL','KOSTOLO'),
    ('ETEL','PEKSUTEMENY'),
    ('ETEL','DESSZERT'),
    ('ETEL','SNACK'),
    ('ETEL','FOETEL_KORETTEL'),
    ('ETEL','ETELCSOMAG'),
    ('ETEL','EGYEB'),
    ('ALKMENTESITAL_HELYBEN','VIZ'),
    ('ALKMENTESITAL_HELYBEN','LIMONADE_SZORP_FACSART'),
    ('ALKMENTESITAL_HELYBEN','ALKOHOLMENTES_KOKTEL'),
    ('ALKMENTESITAL_HELYBEN','TEA_FORROCSOKOLADE'),
    ('ALKMENTESITAL_HELYBEN','ITALCSOMAG'),
    ('ALKMENTESITAL_HELYBEN','KAVE'),
    ('ALKMENTESITAL_NEM_HELYBEN','VIZ'),
    ('ALKMENTESITAL_NEM_HELYBEN','ROSTOS_UDITO'),
    ('ALKMENTESITAL_NEM_HELYBEN','SZENSAVAS_UDITO'),
    ('ALKMENTESITAL_NEM_HELYBEN','SZENSAVMENTES_UDITO'),
    ('ALKMENTESITAL_NEM_HELYBEN','ITALCSOMAG'),
    ('ALKOHOLOSITAL','KOKTEL'),
    ('ALKOHOLOSITAL','LIKOR'),
    ('ALKOHOLOSITAL','PARLAT'),
    ('ALKOHOLOSITAL','SOR'),
    ('ALKOHOLOSITAL','BOR'),
    ('ALKOHOLOSITAL','PEZSGO'),
    ('ALKOHOLOSITAL','ITALCSOMAG'),
    ('EGYEB','EGYEB'),
    ('EGYEB','SZERVIZDIJ'),
    ('EGYEB','BORRAVALO'),
    ('EGYEB','EGYEB_VENDEGLATAS')
  ))
);
CREATE INDEX pos_sale_lines_sale_idx ON public.pos_sale_lines(sale_id);
CREATE TABLE public.pos_sale_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES public.pos_sales(id) ON DELETE RESTRICT,
  method text NOT NULL CHECK (method IN ('cash','card','card_terminal','online_card','bank_transfer','coupon','szep_otp','szep_mbh','szep_kh','other')),
  amount numeric(14,2) NOT NULL CHECK (amount>0)
);
CREATE INDEX pos_sale_payments_sale_idx ON public.pos_sale_payments(sale_id);

ALTER TABLE public.pos_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_sale_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_sale_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pos_sales,public.pos_sale_lines,public.pos_sale_payments FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.pos_sales,public.pos_sale_lines,public.pos_sale_payments TO authenticated,service_role;
CREATE POLICY pos_sales_scoped_read ON public.pos_sales FOR SELECT TO authenticated
USING (public.has_pms_access(auth.uid())
  AND organization_slug=public.get_user_organization_slug(auth.uid())
  AND public.can_access_pms_hotel(auth.uid(),hotel_id,organization_slug));
CREATE POLICY pos_lines_scoped_read ON public.pos_sale_lines FOR SELECT TO authenticated
USING (EXISTS(SELECT 1 FROM public.pos_sales s WHERE s.id=pos_sale_lines.sale_id));
CREATE POLICY pos_payments_scoped_read ON public.pos_sale_payments FOR SELECT TO authenticated
USING (EXISTS(SELECT 1 FROM public.pos_sales s WHERE s.id=pos_sale_payments.sale_id));

CREATE OR REPLACE FUNCTION public.pms_record_walk_in_sale(
  _hotel_id text,_business_day date,_lines jsonb,_payments jsonb,_note text DEFAULT '',
  _sale_id uuid DEFAULT gen_random_uuid()
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor uuid := auth.uid();
  org text;
  actor_role text;
  can_manage boolean;
  d date := COALESCE(_business_day,(now() AT TIME ZONE 'Europe/Budapest')::date);
  today date := (now() AT TIME ZONE 'Europe/Budapest')::date;
  item public.service_catalog_items%ROWTYPE;
  row_data jsonb;
  mapped jsonb;
  config jsonb;
  defaults jsonb := '{"breakfast":{"main":"ETEL","sub":"REGGELI"},"restaurant":{"main":"ETEL","sub":"EGYEB"},"food":{"main":"ETEL","sub":"EGYEB"},"bar":{"main":"ALKOHOLOSITAL","sub":"ITALCSOMAG"},"minibar":{"main":"EGYEB","sub":"EGYEB"},"spa":{"main":"KOZFURDO","sub":"WELLNESS_PROGRAM"},"wellness":{"main":"KOZFURDO","sub":"WELLNESS_PROGRAM"},"service":{"main":"EGYEB","sub":"SZERVIZDIJ"},"parking":{"main":"EGYEB","sub":"EGYEB"},"other":{"main":"EGYEB","sub":"EGYEB"},"legacy":{"main":"EGYEB","sub":"EGYEB"}}'::jsonb;
  category_key text;
  main_code text;
  sub_code text;
  amount_value numeric;
  gross_sum numeric := 0;
  paid_sum numeric := 0;
  existing public.pos_sales%ROWTYPE;
  payload jsonb := jsonb_build_object('lines',_lines,'payments',_payments,'note',btrim(COALESCE(_note,'')));
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
  SELECT p.organization_slug,p.role::text,
    COALESCE(p.is_super_admin,false) OR p.role::text IN ('admin','manager','top_management','top_management_manager')
    INTO org,actor_role,can_manage FROM public.profiles p WHERE p.id=actor;
  IF org IS NULL OR NOT COALESCE(public.has_pms_access(actor),false)
    OR NOT COALESCE(public.can_access_pms_hotel(actor,_hotel_id,org),false)
    OR actor_role IS NULL OR actor_role NOT IN ('admin','manager','top_management','top_management_manager','reception','front_office')
  THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
  IF d>today THEN RAISE EXCEPTION 'BUSINESS_DAY_CANNOT_BE_FUTURE'; END IF;
  IF d<>today THEN
    PERFORM public.pms_assert_business_moment(_hotel_id,org,(d::timestamp+interval '12 hours') AT TIME ZONE 'Europe/Budapest');
  END IF;
  IF _sale_id IS NULL OR length(COALESCE(_note,''))>500 THEN RAISE EXCEPTION 'INVALID_SALE'; END IF;
  IF jsonb_typeof(_lines) IS DISTINCT FROM 'array' OR jsonb_typeof(_payments) IS DISTINCT FROM 'array'
  THEN RAISE EXCEPTION 'INVALID_SALE'; END IF;
  IF jsonb_array_length(_lines) NOT BETWEEN 1 AND 100 OR jsonb_array_length(_payments) NOT BETWEEN 1 AND 20
  THEN RAISE EXCEPTION 'INVALID_SALE'; END IF;
  -- Request ID prevents duplicate posting after a lost HTTP response.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(_sale_id::text,0));
  SELECT * INTO existing FROM public.pos_sales WHERE id=_sale_id;
  IF FOUND THEN
    IF existing.hotel_id IS DISTINCT FROM _hotel_id OR existing.organization_slug IS DISTINCT FROM org
      OR existing.created_by IS DISTINCT FROM actor OR existing.business_day IS DISTINCT FROM d
    THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
    IF existing.request_payload IS DISTINCT FROM payload THEN RAISE EXCEPTION 'SALE_ID_REUSED_WITH_DIFFERENT_DATA'; END IF;
    RETURN existing.id;
  END IF;
  SELECT ledger_config INTO config FROM public.ntak_settings WHERE hotel_id=_hotel_id AND organization_slug=org;
  INSERT INTO public.pos_sales(id,hotel_id,organization_slug,business_day,note,created_by,request_payload)
  VALUES(_sale_id,_hotel_id,org,d,btrim(COALESCE(_note,'')),actor,payload);
  FOR row_data IN SELECT value FROM jsonb_array_elements(_lines) LOOP
    SELECT * INTO item FROM public.service_catalog_items
      WHERE id=(row_data->>'service_catalog_item_id')::uuid AND organization_slug=org
      AND is_active AND (cardinality(allowed_hotel_ids)=0 OR _hotel_id=ANY(allowed_hotel_ids))
      FOR SHARE;
    IF NOT FOUND OR item.currency IS DISTINCT FROM 'HUF' THEN RAISE EXCEPTION 'INVALID_CATALOG_ITEM'; END IF;
    IF item.requires_manager_approval AND NOT COALESCE(can_manage,false) THEN RAISE EXCEPTION 'MANAGER_APPROVAL_REQUIRED'; END IF;
    IF item.vat_rate IS NULL OR item.vat_rate NOT IN (0,5,18,27) THEN RAISE EXCEPTION 'INVALID_CATALOG_VAT'; END IF;
    amount_value := (row_data->>'gross_total')::numeric;
    IF amount_value IS NULL OR amount_value<=0 OR amount_value>999999999999.99 OR amount_value<>round(amount_value,2)
      OR (NOT item.price_editable AND amount_value<>item.default_gross_price)
    THEN RAISE EXCEPTION 'INVALID_SALE_AMOUNT'; END IF;
    category_key := lower(btrim(item.category));
    IF category_key=ANY(ARRAY['room','accommodation','legacy_room','room_night','szallasdij','city_tax','tourist_tax','tourism_tax','ifa','payment','adjustment'])
    THEN RAISE EXCEPTION 'NOT_WALK_IN_CATEGORY'; END IF;
    mapped := COALESCE(config->'categoryMap'->category_key,defaults->category_key,config->'categoryMap'->'other',defaults->'other');
    main_code := COALESCE(NULLIF(row_data->>'ntak_main',''),mapped->>'main');
    sub_code := COALESCE(NULLIF(row_data->>'ntak_sub',''),mapped->>'sub');
    -- The table constraint enforces categoryProblem('other', main, sub).
    INSERT INTO public.pos_sale_lines(sale_id,service_catalog_item_id,description,gross_total,vat_rate,ntak_main,ntak_sub)
    VALUES(_sale_id,item.id,item.name,amount_value,item.vat_rate,main_code,sub_code);
    gross_sum := gross_sum+amount_value;
  END LOOP;
  FOR row_data IN SELECT value FROM jsonb_array_elements(_payments) LOOP
    amount_value := (row_data->>'amount')::numeric;
    IF amount_value IS NULL OR amount_value<=0 OR amount_value>999999999999.99 OR amount_value<>round(amount_value,2)
    THEN RAISE EXCEPTION 'INVALID_PAYMENT_AMOUNT'; END IF;
    INSERT INTO public.pos_sale_payments(sale_id,method,amount)
      VALUES(_sale_id,row_data->>'method',amount_value);
    paid_sum := paid_sum+amount_value;
  END LOOP;
  IF gross_sum<>paid_sum THEN RAISE EXCEPTION 'SALE_PAYMENT_TOTAL_MISMATCH'; END IF;
  RETURN _sale_id;
END;
$$;
REVOKE ALL ON FUNCTION public.pms_record_walk_in_sale(text,date,jsonb,jsonb,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pms_record_walk_in_sale(text,date,jsonb,jsonb,text,uuid) TO authenticated;
