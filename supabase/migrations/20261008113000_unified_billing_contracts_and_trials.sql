-- Negotiated multi-module agreements, per-hotel/module trials, and one atomic admin save.
-- These structures DO NOT alter operational hotel status or create Stripe charges.
CREATE TABLE IF NOT EXISTS public.billing_fixed_agreements (
  organization_slug text NOT NULL REFERENCES public.organizations(slug) ON DELETE CASCADE,
  agreement_code text NOT NULL,
  label text NOT NULL DEFAULT 'Revenue agreement',
  price_cents integer NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  enabled boolean NOT NULL DEFAULT false,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_slug, agreement_code)
);
ALTER TABLE public.billing_fixed_agreements ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.billing_agreement_entitlements (
  organization_slug text NOT NULL,
  agreement_code text NOT NULL,
  hotel_id text NOT NULL,
  module text NOT NULL CHECK (module IN ('operations','revenue_bi','revenue_automation','maintenance')),
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_slug, agreement_code, hotel_id, module),
  FOREIGN KEY (organization_slug, agreement_code)
    REFERENCES public.billing_fixed_agreements(organization_slug, agreement_code) ON DELETE CASCADE
);
ALTER TABLE public.billing_agreement_entitlements ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.billing_module_trials (
  organization_slug text NOT NULL REFERENCES public.organizations(slug) ON DELETE CASCADE,
  hotel_id text NOT NULL,
  module text NOT NULL CHECK (module IN ('operations','revenue_bi','revenue_automation','maintenance')),
  enabled boolean NOT NULL DEFAULT false,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_slug, hotel_id, module),
  CONSTRAINT billing_module_trials_dates CHECK (ends_on >= starts_on)
);
ALTER TABLE public.billing_module_trials ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS billing_agreement_entitlements_hotel_idx
  ON public.billing_agreement_entitlements(organization_slug,hotel_id);
CREATE INDEX IF NOT EXISTS billing_module_trials_hotel_idx
  ON public.billing_module_trials(organization_slug,hotel_id);

-- Only the billing-admin-config Edge Function's service role may call this.
-- Everything is committed together or rolled back together, including general settings.
CREATE OR REPLACE FUNCTION public.billing_admin_save_all(
  p_slug text,
  p_settings jsonb,
  p_modules jsonb,
  p_access jsonb,
  p_agreements jsonb,
  p_entitlements jsonb,
  p_trials jsonb,
  p_actor uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org uuid;
  item jsonb;
  v_hotel text;
  v_module text;
  v_mode text;
  v_price integer;
  v_code text;
  v_start date;
  v_end date;
  v_cols text;
  v_set text;
BEGIN
  SELECT id INTO v_org FROM public.organizations WHERE slug = p_slug;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Unknown organization'; END IF;

  IF p_settings IS NOT NULL THEN
    IF jsonb_typeof(p_settings) <> 'object' THEN RAISE EXCEPTION 'Invalid settings'; END IF;
    INSERT INTO public.billing_settings(organization_slug) VALUES(p_slug)
      ON CONFLICT (organization_slug) DO NOTHING;
    SELECT string_agg(format('%1$I = (jsonb_populate_record(s, $1)).%1$I',column_name), ', ')
      INTO v_set
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'billing_settings'
        AND column_name NOT IN ('id','organization_slug','created_at','updated_at');
    EXECUTE 'UPDATE public.billing_settings s SET ' || v_set ||
      ', updated_at = now() WHERE s.organization_slug = $2'
      USING p_settings,p_slug;
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(coalesce(p_modules,'[]'::jsonb)) LOOP
    v_hotel := nullif(item->>'hotel_id','');
    IF v_hotel IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.hotel_configurations WHERE hotel_id=v_hotel AND organization_id=v_org
    ) THEN RAISE EXCEPTION 'Hotel outside organization: %',v_hotel; END IF;
    v_module := item->>'module';
    v_mode := item->>'pricing_mode';
    v_price := coalesce((item->>'price_cents')::integer,0);
    IF v_module NOT IN ('operations','revenue_bi','revenue_automation','maintenance')
       OR v_mode NOT IN ('inherit','per_room','fixed_monthly')
       OR v_price < 0 OR (v_mode <> 'inherit' AND v_price = 0)
    THEN RAISE EXCEPTION 'Invalid module price'; END IF;
    INSERT INTO public.billing_module_overrides
      (organization_slug,hotel_id,module,pricing_mode,price_cents,updated_by,updated_at)
    VALUES (p_slug,v_hotel,v_module,v_mode,CASE WHEN v_mode='inherit' THEN 0 ELSE v_price END,p_actor,now())
    ON CONFLICT (organization_slug,scope_key,module)
    DO UPDATE SET pricing_mode=excluded.pricing_mode,price_cents=excluded.price_cents,
      updated_by=excluded.updated_by,updated_at=now();
  END LOOP;

  FOR item IN SELECT value FROM jsonb_array_elements(coalesce(p_access,'[]'::jsonb)) LOOP
    v_hotel := nullif(item->>'hotel_id','');
    IF v_hotel IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.hotel_configurations WHERE hotel_id=v_hotel AND organization_id=v_org
    ) THEN RAISE EXCEPTION 'Hotel outside organization: %',v_hotel; END IF;
    INSERT INTO public.billing_access_overrides
      (organization_slug,hotel_id,bypass_billing,reason,expires_at,updated_by,updated_at)
    VALUES (p_slug,v_hotel,coalesce((item->>'bypass_billing')::boolean,false),
      left(item->>'reason',500),nullif(item->>'expires_at','')::timestamptz,p_actor,now())
    ON CONFLICT (organization_slug,scope_key)
    DO UPDATE SET bypass_billing=excluded.bypass_billing,reason=excluded.reason,
      expires_at=excluded.expires_at,updated_by=excluded.updated_by,updated_at=now();
  END LOOP;

  FOR item IN SELECT value FROM jsonb_array_elements(coalesce(p_agreements,'[]'::jsonb)) LOOP
    v_code := item->>'agreement_code';
    v_price := coalesce((item->>'price_cents')::integer,0);
    IF v_code <> 'revenue' OR v_price < 0
      OR (coalesce((item->>'enabled')::boolean,false) AND v_price = 0)
    THEN RAISE EXCEPTION 'Invalid organization agreement'; END IF;
    INSERT INTO public.billing_fixed_agreements
      (organization_slug,agreement_code,label,price_cents,enabled,updated_by,updated_at)
    VALUES (p_slug,v_code,left(coalesce(item->>'label','Revenue agreement'),120),v_price,
      coalesce((item->>'enabled')::boolean,false),p_actor,now())
    ON CONFLICT (organization_slug,agreement_code)
    DO UPDATE SET label=excluded.label,price_cents=excluded.price_cents,
      enabled=excluded.enabled,updated_by=excluded.updated_by,updated_at=now();
  END LOOP;

  FOR item IN SELECT value FROM jsonb_array_elements(coalesce(p_entitlements,'[]'::jsonb)) LOOP
    v_hotel := item->>'hotel_id';
    v_module := item->>'module';
    v_code := item->>'agreement_code';
    IF v_code <> 'revenue' OR v_module NOT IN ('revenue_bi','revenue_automation')
      OR NOT EXISTS (SELECT 1 FROM public.hotel_configurations WHERE hotel_id=v_hotel AND organization_id=v_org)
      OR NOT EXISTS (SELECT 1 FROM public.billing_fixed_agreements
         WHERE organization_slug=p_slug AND agreement_code=v_code)
    THEN RAISE EXCEPTION 'Invalid contract entitlement'; END IF;
    INSERT INTO public.billing_agreement_entitlements
      (organization_slug,agreement_code,hotel_id,module,enabled,updated_at)
    VALUES (p_slug,v_code,v_hotel,v_module,coalesce((item->>'enabled')::boolean,false),now())
    ON CONFLICT (organization_slug,agreement_code,hotel_id,module)
    DO UPDATE SET enabled=excluded.enabled,updated_at=now();
  END LOOP;

  FOR item IN SELECT value FROM jsonb_array_elements(coalesce(p_trials,'[]'::jsonb)) LOOP
    v_hotel := item->>'hotel_id';
    v_module := item->>'module';
    v_start := nullif(item->>'starts_on','')::date;
    v_end := nullif(item->>'ends_on','')::date;
    IF v_module NOT IN ('operations','revenue_bi','revenue_automation','maintenance')
      OR NOT EXISTS (SELECT 1 FROM public.hotel_configurations WHERE hotel_id=v_hotel AND organization_id=v_org)
      OR v_start IS NULL OR v_end IS NULL OR v_end < v_start
    THEN RAISE EXCEPTION 'Invalid property/module trial'; END IF;
    INSERT INTO public.billing_module_trials
      (organization_slug,hotel_id,module,enabled,starts_on,ends_on,updated_at)
    VALUES (p_slug,v_hotel,v_module,coalesce((item->>'enabled')::boolean,false),v_start,v_end,now())
    ON CONFLICT (organization_slug,hotel_id,module)
    DO UPDATE SET enabled=excluded.enabled,starts_on=excluded.starts_on,
      ends_on=excluded.ends_on,updated_at=now();
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.billing_admin_save_all(text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.billing_admin_save_all(text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,uuid)
  TO service_role;
COMMENT ON FUNCTION public.billing_admin_save_all(text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,uuid)
  IS 'Atomic billing admin save, service-role only. Does not update Stripe subscriptions.';
