-- ============================================================
-- 1. has_pms_access: include top_management_manager
-- ============================================================
CREATE OR REPLACE FUNCTION public.has_pms_access(user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = user_id
    AND role IN ('admin', 'manager', 'reception', 'front_office', 'housekeeping_manager', 'top_management', 'top_management_manager')
  );
$$;

-- ============================================================
-- 2. Hotel-scope helpers
-- ============================================================
CREATE OR REPLACE FUNCTION public.can_access_pms_hotel(_uid uuid, _hotel_id text, _org_slug text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = _uid AND COALESCE(p.is_super_admin, false))
  OR (
    public.has_pms_access(_uid)
    AND CASE
      WHEN _hotel_id IS NULL
        THEN (_org_slug IS NULL OR _org_slug = public.get_user_organization_slug(_uid))
      ELSE public.user_can_access_hotel(_uid, _hotel_id)
    END
  );
$$;
REVOKE ALL ON FUNCTION public.can_access_pms_hotel(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_pms_hotel(uuid, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.can_access_reservation(_uid uuid, _reservation_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.reservations r
    WHERE r.id = _reservation_id
      AND public.can_access_pms_hotel(_uid, r.hotel_id, r.organization_slug)
  );
$$;
REVOKE ALL ON FUNCTION public.can_access_reservation(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_reservation(uuid, uuid) TO authenticated, service_role;

-- ============================================================
-- 3. Hotel-scoped RLS
-- ============================================================
DROP POLICY IF EXISTS "PMS users can view reservations" ON public.reservations;
DROP POLICY IF EXISTS "PMS users can insert reservations in their org" ON public.reservations;
DROP POLICY IF EXISTS "PMS users can update reservations in their org" ON public.reservations;

CREATE POLICY "PMS users can view reservations in their hotel"
ON public.reservations FOR SELECT TO authenticated
USING (public.can_access_pms_hotel(auth.uid(), hotel_id, organization_slug));

CREATE POLICY "PMS users can insert reservations in their hotel"
ON public.reservations FOR INSERT TO authenticated
WITH CHECK (
  public.can_access_pms_hotel(auth.uid(), hotel_id, COALESCE(organization_slug, public.get_user_organization_slug(auth.uid())))
);

CREATE POLICY "PMS users can update reservations in their hotel"
ON public.reservations FOR UPDATE TO authenticated
USING (public.can_access_pms_hotel(auth.uid(), hotel_id, organization_slug))
WITH CHECK (public.can_access_pms_hotel(auth.uid(), hotel_id, COALESCE(organization_slug, public.get_user_organization_slug(auth.uid()))));

DROP POLICY IF EXISTS "PMS users can view guests" ON public.guests;
DROP POLICY IF EXISTS "PMS users can insert guests in their org" ON public.guests;
DROP POLICY IF EXISTS "PMS users can update guests in their org" ON public.guests;

CREATE POLICY "PMS users can view guests in their hotel"
ON public.guests FOR SELECT TO authenticated
USING (public.can_access_pms_hotel(auth.uid(), hotel_id, organization_slug));

CREATE POLICY "PMS users can insert guests in their hotel"
ON public.guests FOR INSERT TO authenticated
WITH CHECK (public.can_access_pms_hotel(auth.uid(), hotel_id, COALESCE(organization_slug, public.get_user_organization_slug(auth.uid()))));

CREATE POLICY "PMS users can update guests in their hotel"
ON public.guests FOR UPDATE TO authenticated
USING (public.can_access_pms_hotel(auth.uid(), hotel_id, organization_slug))
WITH CHECK (public.can_access_pms_hotel(auth.uid(), hotel_id, COALESCE(organization_slug, public.get_user_organization_slug(auth.uid()))));

DROP POLICY IF EXISTS "PMS users can view folios in their org" ON public.guest_folios;
DROP POLICY IF EXISTS "PMS users can insert folios in their org" ON public.guest_folios;

CREATE POLICY "PMS users can view folios for accessible reservations"
ON public.guest_folios FOR SELECT TO authenticated
USING (
  public.has_pms_access(auth.uid())
  AND (
    (reservation_id IS NULL)
    OR public.can_access_reservation(auth.uid(), reservation_id)
  )
);

CREATE POLICY "PMS users can insert folios for accessible reservations"
ON public.guest_folios FOR INSERT TO authenticated
WITH CHECK (
  public.has_pms_access(auth.uid())
  AND reservation_id IS NOT NULL
  AND public.can_access_reservation(auth.uid(), reservation_id)
);

DROP POLICY IF EXISTS "PMS users can manage reservation rooms" ON public.reservation_room_assignments;

CREATE POLICY "PMS users can manage reservation rooms in their hotel"
ON public.reservation_room_assignments FOR ALL TO authenticated
USING (
  public.has_pms_access(auth.uid())
  AND public.can_access_reservation(auth.uid(), reservation_id)
)
WITH CHECK (
  public.has_pms_access(auth.uid())
  AND public.can_access_reservation(auth.uid(), reservation_id)
);

-- ============================================================
-- 4. reservation_events audit table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.reservation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL REFERENCES public.reservations(id) ON DELETE CASCADE,
  hotel_id text,
  organization_slug text,
  event_type text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.reservation_events TO authenticated;
GRANT ALL ON public.reservation_events TO service_role;
ALTER TABLE public.reservation_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "PMS users can view reservation events" ON public.reservation_events;
CREATE POLICY "PMS users can view reservation events"
ON public.reservation_events FOR SELECT TO authenticated
USING (public.can_access_pms_hotel(auth.uid(), hotel_id, organization_slug));

DROP POLICY IF EXISTS "PMS users can insert reservation events" ON public.reservation_events;
CREATE POLICY "PMS users can insert reservation events"
ON public.reservation_events FOR INSERT TO authenticated
WITH CHECK (
  public.can_access_pms_hotel(auth.uid(), hotel_id, COALESCE(organization_slug, public.get_user_organization_slug(auth.uid())))
  AND public.can_access_reservation(auth.uid(), reservation_id)
);

CREATE INDEX IF NOT EXISTS idx_reservation_events_res ON public.reservation_events(reservation_id, created_at DESC);

-- ============================================================
-- 5. Columns, indexes, uniqueness
-- ============================================================
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS pms_guest_name text;

CREATE INDEX IF NOT EXISTS idx_reservations_hotel_checkin ON public.reservations(hotel_id, check_in_date);
CREATE INDEX IF NOT EXISTS idx_reservations_hotel_checkout ON public.reservations(hotel_id, check_out_date);
CREATE INDEX IF NOT EXISTS idx_reservations_hotel_status ON public.reservations(hotel_id, status);
CREATE INDEX IF NOT EXISTS idx_reservations_room ON public.reservations(room_id) WHERE room_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_reservations_hotel_source_ref ON public.reservations(hotel_id, source, source_reservation_id);
CREATE INDEX IF NOT EXISTS idx_guests_hotel ON public.guests(hotel_id);
CREATE INDEX IF NOT EXISTS idx_guests_org ON public.guests(organization_slug);
CREATE INDEX IF NOT EXISTS idx_rra_room_dates ON public.reservation_room_assignments(room_id, check_in_date, check_out_date);
CREATE INDEX IF NOT EXISTS idx_rra_reservation ON public.reservation_room_assignments(reservation_id);
CREATE INDEX IF NOT EXISTS idx_guest_folios_reservation ON public.guest_folios(reservation_id);

-- ============================================================
-- 6. updated_at / total_nights maintenance
-- ============================================================
CREATE OR REPLACE FUNCTION public.pms_reservations_before_write()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.check_in_date IS NOT NULL AND NEW.check_out_date IS NOT NULL THEN
    NEW.total_nights := GREATEST(1, NEW.check_out_date - NEW.check_in_date);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tr_reservations_maintain_fields ON public.reservations;
CREATE TRIGGER tr_reservations_maintain_fields
BEFORE INSERT OR UPDATE ON public.reservations
FOR EACH ROW EXECUTE FUNCTION public.pms_reservations_before_write();

-- ============================================================
-- 7. Availability / conflict helpers
-- ============================================================
CREATE OR REPLACE FUNCTION public.pms_room_has_conflict(_room_id uuid, _from date, _to date, _exclude_reservation uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.reservations r
    WHERE r.room_id = _room_id
      AND r.status IN ('pending','confirmed','checked_in')
      AND (_exclude_reservation IS NULL OR r.id <> _exclude_reservation)
      AND r.check_in_date < _to AND r.check_out_date > _from
  ) OR EXISTS (
    SELECT 1 FROM public.reservation_room_assignments rra
    JOIN public.reservations r2 ON r2.id = rra.reservation_id
    WHERE rra.room_id = _room_id
      AND rra.status IN ('assigned','active')
      AND (_exclude_reservation IS NULL OR rra.reservation_id <> _exclude_reservation)
      AND r2.status IN ('pending','confirmed','checked_in')
      AND rra.check_in_date < _to AND rra.check_out_date > _from
  );
$$;
REVOKE ALL ON FUNCTION public.pms_room_has_conflict(uuid, date, date, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pms_room_has_conflict(uuid, date, date, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.pms_hotel_room_keys(_hotel_id text)
RETURNS SETOF text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT _hotel_id
  UNION
  SELECT hc.hotel_name FROM public.hotel_configurations hc WHERE hc.hotel_id = _hotel_id AND hc.hotel_name IS NOT NULL
  UNION
  SELECT hc.hotel_id FROM public.hotel_configurations hc WHERE hc.hotel_name = _hotel_id;
$$;
REVOKE ALL ON FUNCTION public.pms_hotel_room_keys(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pms_hotel_room_keys(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.pms_available_rooms(_hotel_id text, _from date, _to date, _exclude_reservation uuid DEFAULT NULL)
RETURNS TABLE (
  room_id uuid,
  room_number text,
  room_type text,
  room_status text,
  capacity integer,
  has_conflict boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.can_access_pms_hotel(auth.uid(), _hotel_id, NULL) THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;
  IF _from IS NULL OR _to IS NULL OR _to <= _from THEN
    RAISE EXCEPTION 'INVALID_DATES';
  END IF;
  RETURN QUERY
  SELECT rm.id, rm.room_number, rm.room_type, rm.status,
         COALESCE(rm.room_capacity, 2),
         public.pms_room_has_conflict(rm.id, _from, _to, _exclude_reservation)
  FROM public.rooms rm
  WHERE rm.hotel IN (SELECT public.pms_hotel_room_keys(_hotel_id))
  ORDER BY rm.room_number;
END;
$$;
REVOKE ALL ON FUNCTION public.pms_available_rooms(text, date, date, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pms_available_rooms(text, date, date, uuid) TO authenticated, service_role;

-- ============================================================
-- 8. Financial recalculation
-- ============================================================
CREATE OR REPLACE FUNCTION public.pms_recalc_reservation_financials(_reservation_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  r public.reservations%ROWTYPE;
  charges numeric := 0;
  payments numeric := 0;
  accommodation numeric := 0;
  total numeric := 0;
  balance numeric := 0;
BEGIN
  SELECT * INTO r FROM public.reservations WHERE id = _reservation_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT COALESCE(SUM(amount), 0) INTO charges FROM public.guest_folios
    WHERE reservation_id = _reservation_id AND charge_type <> 'payment';
  SELECT COALESCE(SUM(amount), 0) INTO payments FROM public.guest_folios
    WHERE reservation_id = _reservation_id AND charge_type = 'payment';
  accommodation := COALESCE(r.rate_per_night, 0) * GREATEST(COALESCE(r.total_nights, r.check_out_date - r.check_in_date, 1), 1);
  total := ROUND(accommodation + charges, 2);
  balance := ROUND(total - payments, 2);
  UPDATE public.reservations SET
    total_amount = total,
    balance_due = balance,
    payment_status = CASE
      WHEN payments <= 0 THEN 'unpaid'
      WHEN balance <= 0 THEN 'paid'
      ELSE 'partial'
    END
  WHERE id = _reservation_id;
END;
$$;
REVOKE ALL ON FUNCTION public.pms_recalc_reservation_financials(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pms_recalc_reservation_financials(uuid) TO authenticated, service_role;

-- ============================================================
-- 9. Lifecycle RPCs
-- ============================================================
CREATE OR REPLACE FUNCTION public.pms_check_in_reservation(_reservation_id uuid, _room_id uuid, _override boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  r public.reservations%ROWTYPE;
  rm public.rooms%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.reservations WHERE id = _reservation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RESERVATION_NOT_FOUND'; END IF;
  IF _uid IS NOT NULL AND NOT public.can_access_pms_hotel(_uid, r.hotel_id, r.organization_slug) THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;
  IF r.status NOT IN ('pending','confirmed') THEN RAISE EXCEPTION 'INVALID_STATUS'; END IF;

  SELECT * INTO rm FROM public.rooms WHERE id = _room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ROOM_NOT_FOUND'; END IF;

  IF r.hotel_id IS NOT NULL AND rm.hotel NOT IN (SELECT public.pms_hotel_room_keys(r.hotel_id)) THEN
    RAISE EXCEPTION 'ROOM_WRONG_HOTEL';
  END IF;
  IF rm.status = 'occupied' THEN RAISE EXCEPTION 'ROOM_OCCUPIED'; END IF;
  IF rm.status <> 'clean' AND NOT _override THEN RAISE EXCEPTION 'ROOM_NOT_CLEAN'; END IF;
  IF public.pms_room_has_conflict(_room_id, GREATEST(r.check_in_date, CURRENT_DATE), r.check_out_date, r.id) THEN
    RAISE EXCEPTION 'ROOM_CONFLICT';
  END IF;
  IF COALESCE(rm.room_capacity, 0) > 0 AND (r.adults + r.children) > rm.room_capacity AND NOT _override THEN
    RAISE EXCEPTION 'CAPACITY_EXCEEDED';
  END IF;
  IF (CURRENT_DATE < r.check_in_date - 1 OR CURRENT_DATE >= r.check_out_date) AND NOT _override THEN
    RAISE EXCEPTION 'DATE_OUT_OF_WINDOW';
  END IF;

  UPDATE public.reservations
  SET status = 'checked_in', room_id = _room_id, actual_check_in = now()
  WHERE id = r.id;

  UPDATE public.rooms
  SET status = 'occupied', guest_count = r.adults + r.children, updated_at = now()
  WHERE id = _room_id;

  UPDATE public.reservation_room_assignments
  SET status = 'cancelled'
  WHERE reservation_id = r.id AND room_id <> _room_id AND status IN ('assigned','active');

  IF EXISTS (SELECT 1 FROM public.reservation_room_assignments WHERE reservation_id = r.id AND room_id = _room_id) THEN
    UPDATE public.reservation_room_assignments
    SET status = 'active', check_in_date = r.check_in_date, check_out_date = r.check_out_date
    WHERE reservation_id = r.id AND room_id = _room_id;
  ELSE
    INSERT INTO public.reservation_room_assignments (reservation_id, room_id, check_in_date, check_out_date, status)
    VALUES (r.id, _room_id, r.check_in_date, r.check_out_date, 'active');
  END IF;

  INSERT INTO public.reservation_events (reservation_id, hotel_id, organization_slug, event_type, metadata, created_by)
  VALUES (r.id, r.hotel_id, r.organization_slug, 'check_in',
          jsonb_build_object('room_id', _room_id, 'room_number', rm.room_number, 'override', _override), _uid);

  RETURN jsonb_build_object('ok', true, 'reservation_id', r.id, 'room_number', rm.room_number);
END;
$$;
REVOKE ALL ON FUNCTION public.pms_check_in_reservation(uuid, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pms_check_in_reservation(uuid, uuid, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.pms_check_out_reservation(_reservation_id uuid, _acknowledge_balance boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  r public.reservations%ROWTYPE;
  bal numeric;
BEGIN
  SELECT * INTO r FROM public.reservations WHERE id = _reservation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RESERVATION_NOT_FOUND'; END IF;
  IF _uid IS NOT NULL AND NOT public.can_access_pms_hotel(_uid, r.hotel_id, r.organization_slug) THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;
  IF r.status <> 'checked_in' THEN RAISE EXCEPTION 'INVALID_STATUS'; END IF;

  bal := COALESCE(r.balance_due, 0);
  IF bal > 0 AND NOT _acknowledge_balance THEN RAISE EXCEPTION 'BALANCE_DUE'; END IF;

  UPDATE public.reservations
  SET status = 'checked_out', actual_check_out = now()
  WHERE id = r.id;

  IF r.room_id IS NOT NULL THEN
    UPDATE public.rooms
    SET status = 'dirty', is_checkout_room = true, checkout_time = now(), guest_count = 0, updated_at = now()
    WHERE id = r.room_id;
  END IF;

  UPDATE public.reservation_room_assignments
  SET status = 'completed'
  WHERE reservation_id = r.id AND status IN ('assigned','active');

  INSERT INTO public.reservation_events (reservation_id, hotel_id, organization_slug, event_type, metadata, created_by)
  VALUES (r.id, r.hotel_id, r.organization_slug, 'check_out',
          jsonb_build_object('balance_at_checkout', bal, 'balance_acknowledged', _acknowledge_balance), _uid);

  RETURN jsonb_build_object('ok', true, 'reservation_id', r.id, 'balance_at_checkout', bal);
END;
$$;
REVOKE ALL ON FUNCTION public.pms_check_out_reservation(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pms_check_out_reservation(uuid, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.pms_set_reservation_status(_reservation_id uuid, _new_status text, _reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  r public.reservations%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.reservations WHERE id = _reservation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RESERVATION_NOT_FOUND'; END IF;
  IF _uid IS NOT NULL AND NOT public.can_access_pms_hotel(_uid, r.hotel_id, r.organization_slug) THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;

  IF _new_status = 'confirmed' THEN
    IF r.status <> 'pending' THEN RAISE EXCEPTION 'INVALID_STATUS'; END IF;
    UPDATE public.reservations SET status = 'confirmed' WHERE id = r.id;
  ELSIF _new_status = 'cancelled' THEN
    IF r.status NOT IN ('pending','confirmed') THEN RAISE EXCEPTION 'INVALID_STATUS'; END IF;
    UPDATE public.reservations
    SET status = 'cancelled', cancelled_at = now(), cancellation_reason = NULLIF(TRIM(COALESCE(_reason, '')), '')
    WHERE id = r.id;
    UPDATE public.reservation_room_assignments SET status = 'cancelled'
    WHERE reservation_id = r.id AND status IN ('assigned','active');
  ELSIF _new_status = 'no_show' THEN
    IF r.status NOT IN ('pending','confirmed') THEN RAISE EXCEPTION 'INVALID_STATUS'; END IF;
    UPDATE public.reservations
    SET status = 'no_show', cancelled_at = now(), cancellation_reason = NULLIF(TRIM(COALESCE(_reason, '')), '')
    WHERE id = r.id;
    UPDATE public.reservation_room_assignments SET status = 'cancelled'
    WHERE reservation_id = r.id AND status IN ('assigned','active');
  ELSE
    RAISE EXCEPTION 'UNSUPPORTED_STATUS';
  END IF;

  INSERT INTO public.reservation_events (reservation_id, hotel_id, organization_slug, event_type, metadata, created_by)
  VALUES (r.id, r.hotel_id, r.organization_slug,
          CASE _new_status WHEN 'confirmed' THEN 'confirm' WHEN 'cancelled' THEN 'cancel' ELSE 'no_show' END,
          jsonb_build_object('reason', _reason, 'previous_status', r.status), _uid);

  RETURN jsonb_build_object('ok', true, 'reservation_id', r.id, 'status', _new_status);
END;
$$;
REVOKE ALL ON FUNCTION public.pms_set_reservation_status(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pms_set_reservation_status(uuid, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.pms_add_folio_item(_reservation_id uuid, _description text, _amount numeric, _charge_type text DEFAULT 'other')
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  r public.reservations%ROWTYPE;
  new_balance numeric;
BEGIN
  SELECT * INTO r FROM public.reservations WHERE id = _reservation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RESERVATION_NOT_FOUND'; END IF;
  IF _uid IS NOT NULL AND NOT public.can_access_pms_hotel(_uid, r.hotel_id, r.organization_slug) THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;
  IF r.status IN ('cancelled','no_show') THEN RAISE EXCEPTION 'INVALID_STATUS'; END IF;
  IF _description IS NULL OR TRIM(_description) = '' OR LENGTH(_description) > 300 THEN
    RAISE EXCEPTION 'INVALID_DESCRIPTION';
  END IF;
  IF _amount IS NULL OR _amount = 0 OR ABS(_amount) > 100000000 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT';
  END IF;
  IF _charge_type NOT IN ('room','minibar','restaurant','bar','spa','city_tax','service','payment','adjustment','other') THEN
    RAISE EXCEPTION 'INVALID_CHARGE_TYPE';
  END IF;
  IF _charge_type = 'payment' AND _amount < 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT';
  END IF;

  INSERT INTO public.guest_folios (reservation_id, guest_id, description, amount, charge_type, created_by)
  VALUES (r.id, r.guest_id, TRIM(_description), _amount, _charge_type, _uid);

  PERFORM public.pms_recalc_reservation_financials(r.id);
  SELECT balance_due INTO new_balance FROM public.reservations WHERE id = r.id;

  INSERT INTO public.reservation_events (reservation_id, hotel_id, organization_slug, event_type, metadata, created_by)
  VALUES (r.id, r.hotel_id, r.organization_slug,
          CASE WHEN _charge_type = 'payment' THEN 'payment' ELSE 'folio_charge' END,
          jsonb_build_object('description', TRIM(_description), 'amount', _amount, 'charge_type', _charge_type), _uid);

  RETURN jsonb_build_object('ok', true, 'reservation_id', r.id, 'balance_due', new_balance);
END;
$$;
REVOKE ALL ON FUNCTION public.pms_add_folio_item(uuid, text, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pms_add_folio_item(uuid, text, numeric, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.pms_create_reservation(
  _hotel_id text,
  _guest_id uuid,
  _check_in date,
  _check_out date,
  _adults integer DEFAULT 1,
  _children integer DEFAULT 0,
  _room_id uuid DEFAULT NULL,
  _room_type_requested text DEFAULT NULL,
  _rate_per_night numeric DEFAULT 0,
  _currency text DEFAULT NULL,
  _source text DEFAULT 'direct',
  _special_requests text DEFAULT NULL,
  _internal_notes text DEFAULT NULL,
  _status text DEFAULT 'confirmed'
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  org text;
  cur text;
  nights integer;
  total numeric;
  new_id uuid;
  new_number text;
BEGIN
  IF _hotel_id IS NULL OR TRIM(_hotel_id) = '' THEN RAISE EXCEPTION 'HOTEL_REQUIRED'; END IF;
  IF _uid IS NOT NULL AND NOT public.can_access_pms_hotel(_uid, _hotel_id, NULL) THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;
  IF _check_in IS NULL OR _check_out IS NULL OR _check_out <= _check_in THEN RAISE EXCEPTION 'INVALID_DATES'; END IF;
  IF _check_in < CURRENT_DATE - 30 OR (_check_out - _check_in) > 366 THEN RAISE EXCEPTION 'INVALID_DATES'; END IF;
  IF COALESCE(_adults, 0) < 1 OR COALESCE(_children, -1) < 0 OR (_adults + _children) > 20 THEN RAISE EXCEPTION 'INVALID_PAX'; END IF;
  IF COALESCE(_rate_per_night, 0) < 0 THEN RAISE EXCEPTION 'INVALID_RATE'; END IF;
  IF _status NOT IN ('pending','confirmed') THEN RAISE EXCEPTION 'INVALID_STATUS'; END IF;
  IF _source NOT IN ('direct','walk_in','phone','email','booking_com','expedia','previo','other') THEN
    RAISE EXCEPTION 'INVALID_SOURCE';
  END IF;

  SELECT o.slug INTO org
  FROM public.hotel_configurations hc
  JOIN public.organizations o ON o.id = hc.organization_id
  WHERE hc.hotel_id = _hotel_id OR hc.hotel_name = _hotel_id
  LIMIT 1;
  IF org IS NULL THEN org := public.get_user_organization_slug(_uid); END IF;

  IF _room_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.rooms rm
      WHERE rm.id = _room_id AND rm.hotel IN (SELECT public.pms_hotel_room_keys(_hotel_id))
    ) THEN
      RAISE EXCEPTION 'ROOM_WRONG_HOTEL';
    END IF;
    IF public.pms_room_has_conflict(_room_id, _check_in, _check_out, NULL) THEN
      RAISE EXCEPTION 'ROOM_CONFLICT';
    END IF;
  END IF;

  SELECT COALESCE(NULLIF(TRIM(COALESCE(_currency, '')), ''), hrs.base_currency, 'EUR') INTO cur
  FROM (SELECT 1) x
  LEFT JOIN public.hotel_revenue_settings hrs ON hrs.hotel_id = _hotel_id;

  nights := GREATEST(1, _check_out - _check_in);
  total := ROUND(COALESCE(_rate_per_night, 0) * nights, 2);

  INSERT INTO public.reservations (
    hotel_id, organization_slug, guest_id, room_id, room_type_requested,
    status, check_in_date, check_out_date, adults, children,
    rate_per_night, total_amount, currency, payment_status, balance_due,
    source, special_requests, internal_notes, created_by
  ) VALUES (
    _hotel_id, org, _guest_id, _room_id, NULLIF(TRIM(COALESCE(_room_type_requested, '')), ''),
    _status::reservation_status, _check_in, _check_out, _adults, _children,
    COALESCE(_rate_per_night, 0), total, cur, 'unpaid', total,
    _source, NULLIF(TRIM(COALESCE(_special_requests, '')), ''), NULLIF(TRIM(COALESCE(_internal_notes, '')), ''), _uid
  ) RETURNING id, reservation_number INTO new_id, new_number;

  IF _room_id IS NOT NULL THEN
    INSERT INTO public.reservation_room_assignments (reservation_id, room_id, check_in_date, check_out_date, status)
    VALUES (new_id, _room_id, _check_in, _check_out, 'assigned');
  END IF;

  INSERT INTO public.reservation_events (reservation_id, hotel_id, organization_slug, event_type, metadata, created_by)
  VALUES (new_id, _hotel_id, org, 'created',
          jsonb_build_object('source', _source, 'status', _status, 'room_id', _room_id), _uid);

  RETURN jsonb_build_object('ok', true, 'id', new_id, 'reservation_number', new_number);
END;
$$;
REVOKE ALL ON FUNCTION public.pms_create_reservation(text, uuid, date, date, integer, integer, uuid, text, numeric, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pms_create_reservation(text, uuid, date, date, integer, integer, uuid, text, numeric, text, text, text, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.pms_update_reservation(
  _reservation_id uuid,
  _check_in date DEFAULT NULL,
  _check_out date DEFAULT NULL,
  _adults integer DEFAULT NULL,
  _children integer DEFAULT NULL,
  _room_id uuid DEFAULT NULL,
  _clear_room boolean DEFAULT false,
  _rate_per_night numeric DEFAULT NULL,
  _source text DEFAULT NULL,
  _room_type_requested text DEFAULT NULL,
  _special_requests text DEFAULT NULL,
  _internal_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  r public.reservations%ROWTYPE;
  is_pms boolean;
  eff_in date;
  eff_out date;
  eff_room uuid;
  changes jsonb := '{}'::jsonb;
BEGIN
  SELECT * INTO r FROM public.reservations WHERE id = _reservation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RESERVATION_NOT_FOUND'; END IF;
  IF _uid IS NOT NULL AND NOT public.can_access_pms_hotel(_uid, r.hotel_id, r.organization_slug) THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;
  IF r.status NOT IN ('pending','confirmed','checked_in') THEN RAISE EXCEPTION 'INVALID_STATUS'; END IF;

  is_pms := (r.source = 'previo');

  eff_in := COALESCE(CASE WHEN is_pms THEN NULL ELSE _check_in END, r.check_in_date);
  eff_out := COALESCE(CASE WHEN is_pms THEN NULL ELSE _check_out END, r.check_out_date);
  IF eff_out <= eff_in THEN RAISE EXCEPTION 'INVALID_DATES'; END IF;

  IF _clear_room THEN
    eff_room := NULL;
  ELSE
    eff_room := COALESCE(_room_id, r.room_id);
  END IF;

  IF eff_room IS NOT NULL AND (eff_room IS DISTINCT FROM r.room_id OR eff_in <> r.check_in_date OR eff_out <> r.check_out_date) THEN
    IF r.hotel_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.rooms rm
      WHERE rm.id = eff_room AND rm.hotel IN (SELECT public.pms_hotel_room_keys(r.hotel_id))
    ) THEN
      RAISE EXCEPTION 'ROOM_WRONG_HOTEL';
    END IF;
    IF public.pms_room_has_conflict(eff_room, eff_in, eff_out, r.id) THEN
      RAISE EXCEPTION 'ROOM_CONFLICT';
    END IF;
  END IF;

  IF r.status = 'checked_in' AND eff_room IS DISTINCT FROM r.room_id THEN
    RAISE EXCEPTION 'ROOM_LOCKED_WHILE_CHECKED_IN';
  END IF;

  UPDATE public.reservations SET
    check_in_date = eff_in,
    check_out_date = eff_out,
    adults = CASE WHEN is_pms THEN adults ELSE COALESCE(_adults, adults) END,
    children = CASE WHEN is_pms THEN children ELSE COALESCE(_children, children) END,
    room_id = eff_room,
    rate_per_night = CASE WHEN is_pms THEN rate_per_night ELSE COALESCE(_rate_per_night, rate_per_night) END,
    source = CASE WHEN is_pms THEN source ELSE COALESCE(NULLIF(TRIM(COALESCE(_source, '')), ''), source) END,
    room_type_requested = CASE WHEN is_pms THEN room_type_requested ELSE COALESCE(NULLIF(TRIM(COALESCE(_room_type_requested, '')), ''), room_type_requested) END,
    special_requests = COALESCE(_special_requests, special_requests),
    internal_notes = COALESCE(_internal_notes, internal_notes)
  WHERE id = r.id;

  PERFORM public.pms_recalc_reservation_financials(r.id);

  UPDATE public.reservation_room_assignments SET status = 'cancelled'
  WHERE reservation_id = r.id AND status IN ('assigned','active')
    AND (eff_room IS NULL OR room_id <> eff_room);

  IF eff_room IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.reservation_room_assignments WHERE reservation_id = r.id AND room_id = eff_room) THEN
      UPDATE public.reservation_room_assignments
      SET status = CASE WHEN r.status = 'checked_in' THEN 'active' ELSE 'assigned' END,
          check_in_date = eff_in, check_out_date = eff_out
      WHERE reservation_id = r.id AND room_id = eff_room;
    ELSE
      INSERT INTO public.reservation_room_assignments (reservation_id, room_id, check_in_date, check_out_date, status)
      VALUES (r.id, eff_room, eff_in, eff_out, CASE WHEN r.status = 'checked_in' THEN 'active' ELSE 'assigned' END);
    END IF;
  END IF;

  changes := jsonb_build_object(
    'pms_managed', is_pms,
    'check_in', eff_in, 'check_out', eff_out,
    'room_id', eff_room
  );
  INSERT INTO public.reservation_events (reservation_id, hotel_id, organization_slug, event_type, metadata, created_by)
  VALUES (r.id, r.hotel_id, r.organization_slug, 'edited', changes, _uid);

  RETURN jsonb_build_object('ok', true, 'reservation_id', r.id, 'pms_managed', is_pms);
END;
$$;
REVOKE ALL ON FUNCTION public.pms_update_reservation(uuid, date, date, integer, integer, uuid, boolean, numeric, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pms_update_reservation(uuid, date, date, integer, integer, uuid, boolean, numeric, text, text, text, text) TO authenticated, service_role;