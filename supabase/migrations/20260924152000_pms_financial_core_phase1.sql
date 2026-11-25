-- HotelCare PMS financial core, Phase 1
-- Additive only: does not activate Szamlazz.hu, NAV, card processing or fiscal issuing.
-- Existing guest_folios stays in place as a compatibility source during migration.

CREATE TABLE IF NOT EXISTS public.reservation_folios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_slug text NOT NULL,
  hotel_id text NOT NULL,
  reservation_id uuid NOT NULL REFERENCES public.reservations(id) ON DELETE CASCADE,
  parent_folio_id uuid REFERENCES public.reservation_folios(id) ON DELETE RESTRICT,
  group_key text,
  folio_type text NOT NULL DEFAULT 'master'
    CHECK (folio_type IN ('master','room','guest','company')),
  display_name text NOT NULL DEFAULT 'Main account',
  currency text NOT NULL DEFAULT 'HUF',
  base_reservation_amount numeric(14,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS reservation_folios_one_master_idx
  ON public.reservation_folios(reservation_id)
  WHERE folio_type = 'master' AND parent_folio_id IS NULL;

CREATE INDEX IF NOT EXISTS reservation_folios_reservation_idx
  ON public.reservation_folios(reservation_id);
CREATE INDEX IF NOT EXISTS reservation_folios_org_hotel_idx
  ON public.reservation_folios(organization_slug, hotel_id);

CREATE TABLE IF NOT EXISTS public.service_catalog_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_slug text NOT NULL,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'other',
  unit text NOT NULL DEFAULT 'item',
  default_gross_price numeric(14,2) NOT NULL DEFAULT 0 CHECK (default_gross_price >= 0),
  currency text NOT NULL DEFAULT 'HUF',
  vat_code text NOT NULL DEFAULT 'REVIEW_REQUIRED',
  vat_rate numeric(7,4),
  allowed_hotel_ids text[] NOT NULL DEFAULT '{}'::text[],
  price_editable boolean NOT NULL DEFAULT true,
  requires_manager_approval boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 100,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (vat_rate IS NULL OR (vat_rate >= 0 AND vat_rate <= 100))
);

CREATE INDEX IF NOT EXISTS service_catalog_items_org_active_idx
  ON public.service_catalog_items(organization_slug, is_active, sort_order);

CREATE TABLE IF NOT EXISTS public.folio_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folio_id uuid NOT NULL REFERENCES public.reservation_folios(id) ON DELETE RESTRICT,
  service_catalog_item_id uuid REFERENCES public.service_catalog_items(id) ON DELETE SET NULL,
  source_type text NOT NULL DEFAULT 'manual',
  description text NOT NULL,
  service_date date NOT NULL DEFAULT CURRENT_DATE,
  service_period_from date,
  service_period_to date,
  room_id uuid REFERENCES public.rooms(id) ON DELETE SET NULL,
  guest_id uuid REFERENCES public.guests(id) ON DELETE SET NULL,
  quantity numeric(12,3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit text NOT NULL DEFAULT 'item',
  currency text NOT NULL,
  gross_unit_price numeric(14,4) NOT NULL DEFAULT 0,
  net_total numeric(14,2) NOT NULL DEFAULT 0,
  vat_code text NOT NULL DEFAULT 'REVIEW_REQUIRED',
  vat_rate numeric(7,4),
  vat_total numeric(14,2) NOT NULL DEFAULT 0,
  gross_total numeric(14,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','invoiced','reversed','voided')),
  origin_line_id uuid REFERENCES public.folio_lines(id) ON DELETE RESTRICT,
  legacy_guest_folio_id uuid UNIQUE,
  adjustment_reason text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (vat_rate IS NULL OR (vat_rate >= 0 AND vat_rate <= 100))
);

CREATE INDEX IF NOT EXISTS folio_lines_folio_status_idx
  ON public.folio_lines(folio_id, status, service_date);

CREATE TABLE IF NOT EXISTS public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_slug text NOT NULL,
  hotel_id text NOT NULL,
  reservation_id uuid NOT NULL REFERENCES public.reservations(id) ON DELETE RESTRICT,
  folio_id uuid NOT NULL REFERENCES public.reservation_folios(id) ON DELETE RESTRICT,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL,
  method text NOT NULL,
  provider text,
  provider_transaction_id text,
  reference text,
  status text NOT NULL DEFAULT 'recorded'
    CHECK (status IN ('pending','authorized','captured','recorded','failed','refunded','reversed')),
  received_at timestamptz NOT NULL DEFAULT now(),
  legacy_guest_folio_id uuid UNIQUE,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payments_reservation_status_idx
  ON public.payments(reservation_id, status, received_at);
CREATE INDEX IF NOT EXISTS payments_folio_status_idx
  ON public.payments(folio_id, status, received_at);

CREATE TABLE IF NOT EXISTS public.payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE RESTRICT,
  folio_id uuid NOT NULL REFERENCES public.reservation_folios(id) ON DELETE RESTRICT,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(payment_id, folio_id)
);

CREATE TABLE IF NOT EXISTS public.pms_financial_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_slug text NOT NULL,
  hotel_id text NOT NULL,
  reservation_id uuid NOT NULL REFERENCES public.reservations(id) ON DELETE RESTRICT,
  folio_id uuid REFERENCES public.reservation_folios(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  entity_type text,
  entity_id uuid,
  amount numeric(14,2),
  currency text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pms_financial_events_reservation_idx
  ON public.pms_financial_events(reservation_id, created_at DESC);

ALTER TABLE public.reservation_folios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_catalog_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.folio_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pms_financial_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "PMS finance view reservation folios" ON public.reservation_folios;
CREATE POLICY "PMS finance view reservation folios"
ON public.reservation_folios FOR SELECT TO authenticated
USING (
  public.has_pms_access(auth.uid())
  AND public.can_access_reservation(auth.uid(), reservation_id)
);

DROP POLICY IF EXISTS "PMS finance view service catalogue" ON public.service_catalog_items;
CREATE POLICY "PMS finance view service catalogue"
ON public.service_catalog_items FOR SELECT TO authenticated
USING (
  public.has_pms_access(auth.uid())
  AND organization_slug = public.get_user_organization_slug(auth.uid())
);

DROP POLICY IF EXISTS "PMS finance manage service catalogue" ON public.service_catalog_items;
CREATE POLICY "PMS finance manage service catalogue"
ON public.service_catalog_items FOR ALL TO authenticated
USING (
  organization_slug = public.get_user_organization_slug(auth.uid())
  AND public.get_user_role(auth.uid())::text IN ('admin','manager','top_management','top_management_manager')
)
WITH CHECK (
  organization_slug = public.get_user_organization_slug(auth.uid())
  AND public.get_user_role(auth.uid())::text IN ('admin','manager','top_management','top_management_manager')
);

DROP POLICY IF EXISTS "PMS finance view folio lines" ON public.folio_lines;
CREATE POLICY "PMS finance view folio lines"
ON public.folio_lines FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.reservation_folios f
    WHERE f.id = folio_lines.folio_id
      AND public.can_access_reservation(auth.uid(), f.reservation_id)
  )
);

DROP POLICY IF EXISTS "PMS finance view payments" ON public.payments;
CREATE POLICY "PMS finance view payments"
ON public.payments FOR SELECT TO authenticated
USING (
  public.can_access_reservation(auth.uid(), reservation_id)
);

DROP POLICY IF EXISTS "PMS finance view allocations" ON public.payment_allocations;
CREATE POLICY "PMS finance view allocations"
ON public.payment_allocations FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.reservation_folios f
    WHERE f.id = payment_allocations.folio_id
      AND public.can_access_reservation(auth.uid(), f.reservation_id)
  )
);

DROP POLICY IF EXISTS "PMS finance view audit" ON public.pms_financial_events;
CREATE POLICY "PMS finance view audit"
ON public.pms_financial_events FOR SELECT TO authenticated
USING (
  public.can_access_reservation(auth.uid(), reservation_id)
);

CREATE OR REPLACE FUNCTION public.pms_finance_ensure_master_folio(_reservation_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r public.reservations%ROWTYPE;
  folio_id uuid;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.can_access_reservation(auth.uid(), _reservation_id) THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;

  SELECT * INTO r FROM public.reservations WHERE id = _reservation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'RESERVATION_NOT_FOUND'; END IF;

  SELECT id INTO folio_id
  FROM public.reservation_folios
  WHERE reservation_id = _reservation_id
    AND folio_type = 'master'
    AND parent_folio_id IS NULL
  LIMIT 1;

  IF folio_id IS NULL THEN
    INSERT INTO public.reservation_folios (
      organization_slug, hotel_id, reservation_id, folio_type, display_name,
      currency, base_reservation_amount, created_by
    ) VALUES (
      COALESCE(r.organization_slug, 'unknown'), COALESCE(r.hotel_id, 'unknown'), r.id,
      'master', 'Main account', COALESCE(r.currency, 'HUF'),
      COALESCE(r.total_amount, 0), auth.uid()
    )
    ON CONFLICT DO NOTHING
    RETURNING id INTO folio_id;

    IF folio_id IS NULL THEN
      SELECT id INTO folio_id
      FROM public.reservation_folios
      WHERE reservation_id = _reservation_id
        AND folio_type = 'master'
        AND parent_folio_id IS NULL
      LIMIT 1;
    END IF;
  ELSE
    UPDATE public.reservation_folios
       SET base_reservation_amount = COALESCE(r.total_amount, 0),
           currency = COALESCE(r.currency, currency),
           updated_at = now()
     WHERE id = folio_id
       AND status = 'open';
  END IF;

  RETURN folio_id;
END;
$$;

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
  _service_date date DEFAULT CURRENT_DATE
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
    COALESCE(_service_date, CURRENT_DATE), _quantity, COALESCE(NULLIF(btrim(_unit), ''), 'item'),
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

-- Backfill only existing legacy folio activity; ordinary reservations are created lazily on first Account open.
INSERT INTO public.reservation_folios (
  organization_slug, hotel_id, reservation_id, folio_type, display_name,
  currency, base_reservation_amount, created_by
)
SELECT DISTINCT
  COALESCE(r.organization_slug, 'unknown'),
  COALESCE(r.hotel_id, 'unknown'),
  r.id,
  'master',
  'Main account',
  COALESCE(r.currency, 'HUF'),
  COALESCE(r.total_amount, 0),
  NULL
FROM public.reservations r
JOIN public.guest_folios gf ON gf.reservation_id = r.id
WHERE NOT EXISTS (
  SELECT 1 FROM public.reservation_folios f
  WHERE f.reservation_id = r.id
    AND f.folio_type = 'master'
    AND f.parent_folio_id IS NULL
);

INSERT INTO public.folio_lines (
  folio_id, source_type, description, service_date, quantity, unit, currency,
  gross_unit_price, net_total, vat_code, vat_rate, vat_total, gross_total,
  legacy_guest_folio_id, created_by, created_at
)
SELECT
  f.id,
  CASE WHEN gf.charge_type = 'room' THEN 'legacy_room' ELSE 'legacy' END,
  gf.description,
  gf.charge_date,
  1,
  'item',
  COALESCE(r.currency, f.currency),
  ABS(gf.amount),
  ABS(gf.amount),
  'LEGACY_UNMAPPED',
  NULL,
  0,
  ABS(gf.amount),
  gf.id,
  gf.created_by,
  gf.created_at
FROM public.guest_folios gf
JOIN public.reservations r ON r.id = gf.reservation_id
JOIN public.reservation_folios f
  ON f.reservation_id = r.id
 AND f.folio_type = 'master'
 AND f.parent_folio_id IS NULL
WHERE gf.charge_type <> 'payment'
  AND NOT EXISTS (
    SELECT 1 FROM public.folio_lines fl WHERE fl.legacy_guest_folio_id = gf.id
  );

INSERT INTO public.payments (
  organization_slug, hotel_id, reservation_id, folio_id,
  amount, currency, method, reference, status, received_at,
  legacy_guest_folio_id, created_by, created_at
)
SELECT
  f.organization_slug,
  f.hotel_id,
  r.id,
  f.id,
  ABS(gf.amount),
  COALESCE(r.currency, f.currency),
  'legacy',
  'Migrated from guest_folios',
  'recorded',
  gf.created_at,
  gf.id,
  gf.created_by,
  gf.created_at
FROM public.guest_folios gf
JOIN public.reservations r ON r.id = gf.reservation_id
JOIN public.reservation_folios f
  ON f.reservation_id = r.id
 AND f.folio_type = 'master'
 AND f.parent_folio_id IS NULL
WHERE gf.charge_type = 'payment'
  AND ABS(gf.amount) > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.payments p WHERE p.legacy_guest_folio_id = gf.id
  );

INSERT INTO public.payment_allocations(payment_id, folio_id, amount, created_by, created_at)
SELECT p.id, p.folio_id, p.amount, p.created_by, p.created_at
FROM public.payments p
WHERE p.legacy_guest_folio_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.payment_allocations pa
    WHERE pa.payment_id = p.id AND pa.folio_id = p.folio_id
  );

REVOKE ALL ON FUNCTION public.pms_finance_ensure_master_folio(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pms_finance_recalculate_reservation(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pms_finance_add_charge(uuid,text,numeric,text,numeric,text,text,numeric,uuid,date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pms_finance_record_payment(uuid,numeric,text,text,text,timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pms_finance_void_charge(uuid,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pms_finance_reverse_payment(uuid,text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.pms_finance_ensure_master_folio(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pms_finance_recalculate_reservation(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.pms_finance_add_charge(uuid,text,numeric,text,numeric,text,text,numeric,uuid,date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pms_finance_record_payment(uuid,numeric,text,text,text,timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pms_finance_void_charge(uuid,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pms_finance_reverse_payment(uuid,text) TO authenticated, service_role;

GRANT SELECT ON public.reservation_folios, public.service_catalog_items, public.folio_lines,
  public.payments, public.payment_allocations, public.pms_financial_events TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.service_catalog_items TO authenticated;
GRANT ALL ON public.reservation_folios, public.service_catalog_items, public.folio_lines,
  public.payments, public.payment_allocations, public.pms_financial_events TO service_role;
