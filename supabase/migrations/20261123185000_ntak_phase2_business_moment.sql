-- NTAK validation Phase 2: business moment, strictly opt-in historical recording.
-- Review and apply manually. No data migration, seed, or production deployment.
ALTER TABLE public.ntak_settings
  ADD COLUMN IF NOT EXISTS allow_backdating boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS backdating_min_date date;

-- Caller identity comes from auth.uid(), never an argument or user metadata.
-- Matches the server's MANAGE_ROLES plus its existing rdhotels/anu_000 exception.
CREATE OR REPLACE FUNCTION public.pms_assert_business_moment(
  _hotel_id text, _org_slug text, _moment timestamptz
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor uuid := auth.uid();
  pr public.profiles%ROWTYPE;
  cfg public.ntak_settings%ROWTYPE;
  business_day date;
BEGIN
  IF _moment IS NULL THEN RETURN; END IF;
  IF actor IS NULL THEN RAISE EXCEPTION 'BACKDATING_REQUIRES_MANAGER'; END IF;
  SELECT * INTO pr FROM public.profiles WHERE id = actor;
  IF NOT FOUND OR NOT (
    COALESCE(pr.is_super_admin, false)
    OR pr.role::text IN ('admin','top_management','top_management_manager','manager')
    OR (pr.organization_slug = 'rdhotels' AND lower(btrim(COALESCE(pr.nickname,''))) = 'anu_000')
  ) THEN RAISE EXCEPTION 'BACKDATING_REQUIRES_MANAGER'; END IF;
  IF NOT public.can_access_pms_hotel(actor, _hotel_id, _org_slug) THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;
  SELECT * INTO cfg FROM public.ntak_settings WHERE hotel_id = _hotel_id;
  IF NOT FOUND OR NOT cfg.allow_backdating THEN
    RAISE EXCEPTION 'BACKDATING_DISABLED';
  END IF;
  business_day := (_moment AT TIME ZONE 'Europe/Budapest')::date;
  IF cfg.first_closure_date IS NOT NULL AND business_day < cfg.first_closure_date THEN
    RAISE EXCEPTION 'BUSINESS_DAY_BEFORE_FIRST_CLOSURE: %', cfg.first_closure_date;
  END IF;
  IF cfg.backdating_min_date IS NOT NULL AND business_day < cfg.backdating_min_date THEN
    RAISE EXCEPTION 'BUSINESS_DAY_BEFORE_MINIMUM: %', cfg.backdating_min_date;
  END IF;
  IF _moment > clock_timestamp() + interval '5 minutes' THEN
    RAISE EXCEPTION 'BUSINESS_MOMENT_CANNOT_BE_FUTURE';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.pms_assert_business_moment(text,text,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pms_assert_business_moment(text,text,timestamptz) TO service_role;

-- Intended to be called INSIDE the lifecycle RPC: set_config(..., true)
-- is transaction-local and does not persist across PostgREST requests.
CREATE OR REPLACE FUNCTION public.pms_set_business_moment(_moment timestamptz)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor uuid := auth.uid();
  pr public.profiles%ROWTYPE;
  business_day date;
BEGIN
  IF _moment IS NULL THEN
    PERFORM set_config('hotelcare.business_moment', '', true);
    RETURN;
  END IF;
  IF actor IS NULL THEN RAISE EXCEPTION 'BACKDATING_REQUIRES_MANAGER'; END IF;
  SELECT * INTO pr FROM public.profiles WHERE id = actor;
  IF NOT FOUND OR NOT (
    COALESCE(pr.is_super_admin, false)
    OR pr.role::text IN ('admin','top_management','top_management_manager','manager')
    OR (pr.organization_slug = 'rdhotels' AND lower(btrim(COALESCE(pr.nickname,''))) = 'anu_000')
  ) THEN RAISE EXCEPTION 'BACKDATING_REQUIRES_MANAGER'; END IF;
  business_day := (_moment AT TIME ZONE 'Europe/Budapest')::date;
  IF _moment > clock_timestamp() + interval '5 minutes' OR NOT EXISTS (
    SELECT 1 FROM public.ntak_settings cfg
    WHERE cfg.allow_backdating
      AND public.user_can_access_hotel(actor, cfg.hotel_id)
      AND (cfg.first_closure_date IS NULL OR business_day >= cfg.first_closure_date)
      AND (cfg.backdating_min_date IS NULL OR business_day >= cfg.backdating_min_date)
  ) THEN RAISE EXCEPTION 'BUSINESS_MOMENT_NOT_ALLOWED'; END IF;
  PERFORM set_config('hotelcare.business_moment', _moment::text, true);
END;
$$;
REVOKE ALL ON FUNCTION public.pms_set_business_moment(timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pms_set_business_moment(timestamptz) TO authenticated;


-- Day-use (arrival = departure) occupies the room for that one business day.
-- Expand a same-day query to [day, day+1) AND recognize existing day-use
-- reservations/assignments; otherwise ordinary [arrival,departure) behavior
-- would miss conflicts with same-day arrivals and FOGL_03.
CREATE OR REPLACE FUNCTION public.pms_room_has_conflict(
  _room_id uuid, _from date, _to date, _exclude_reservation uuid DEFAULT NULL
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.reservations r
    WHERE r.room_id = _room_id
      AND r.status IN ('pending','confirmed','checked_in')
      AND (_exclude_reservation IS NULL OR r.id <> _exclude_reservation)
      AND r.check_in_date < CASE WHEN _to = _from THEN _from + 1 ELSE _to END
      AND (r.check_out_date > _from
        OR (r.check_in_date = r.check_out_date AND r.check_in_date >= _from))
  ) OR EXISTS (
    SELECT 1 FROM public.reservation_room_assignments rra
    JOIN public.reservations r2 ON r2.id = rra.reservation_id
    WHERE rra.room_id = _room_id
      AND rra.status IN ('assigned','active')
      AND (_exclude_reservation IS NULL OR rra.reservation_id <> _exclude_reservation)
      AND r2.status IN ('pending','confirmed','checked_in')
      AND rra.check_in_date < CASE WHEN _to = _from THEN _from + 1 ELSE _to END
      AND (rra.check_out_date > _from
        OR (rra.check_in_date = rra.check_out_date AND rra.check_in_date >= _from))
  );
$$;

-- The reception room picker must also accept a same-day range. Reject only
-- reversed ranges, never a legitimate day-use stay.
CREATE OR REPLACE FUNCTION public.pms_available_rooms(
  _hotel_id text, _from date, _to date, _exclude_reservation uuid DEFAULT NULL
) RETURNS TABLE(
  room_id uuid, room_number text, room_type text, room_status text,
  capacity integer, has_conflict boolean
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.can_access_pms_hotel(auth.uid(), _hotel_id, NULL) THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;
  IF _from IS NULL OR _to IS NULL OR _to < _from THEN
    RAISE EXCEPTION 'INVALID_DATES';
  END IF;
  RETURN QUERY
  SELECT rm.id, rm.room_number, rm.room_type, rm.status,
    COALESCE(rm.room_capacity,2),
    public.pms_room_has_conflict(rm.id,_from,_to,_exclude_reservation)
  FROM public.rooms rm
  WHERE rm.hotel IN (SELECT public.pms_hotel_room_keys(_hotel_id))
  ORDER BY rm.room_number;
END;
$$;

-- The old entrypoints remain unchanged; the new entrypoints delegate to
-- them for ordinary, non-backdated check-ins and check-outs.
CREATE OR REPLACE FUNCTION public.pms_check_in(
  _reservation_id uuid, _moment timestamptz DEFAULT NULL,
  _guest_ids uuid[] DEFAULT NULL, _room_id uuid DEFAULT NULL, _override boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.reservations%ROWTYPE;
  rm public.rooms%ROWTYPE;
  actor uuid := auth.uid();
  day date;
  day_use boolean;
BEGIN
  SELECT * INTO r FROM public.reservations WHERE id = _reservation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RESERVATION_NOT_FOUND'; END IF;
  IF actor IS NULL OR NOT public.can_access_pms_hotel(actor,r.hotel_id,r.organization_slug) THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
  IF _guest_ids IS NOT NULL AND EXISTS (
    SELECT 1 FROM unnest(_guest_ids) AS gid
    WHERE NOT EXISTS (
      SELECT 1 FROM public.reservation_guests rg
      WHERE rg.reservation_id = r.id AND rg.guest_id = gid
    )
  ) THEN RAISE EXCEPTION 'GUEST_NOT_ON_RESERVATION'; END IF;
  PERFORM public.pms_assert_business_moment(r.hotel_id,r.organization_slug,_moment);
  PERFORM public.pms_set_business_moment(_moment);
  day_use := r.check_in_date = r.check_out_date;
  IF _moment IS NULL AND NOT day_use THEN
    RETURN public.pms_check_in_reservation(r.id,COALESCE(_room_id,r.room_id),_override);
  END IF;
  day := (COALESCE(_moment,clock_timestamp()) AT TIME ZONE 'Europe/Budapest')::date;
  IF r.status NOT IN ('pending','confirmed') THEN RAISE EXCEPTION 'INVALID_STATUS'; END IF;
  IF (day_use AND day <> r.check_in_date)
     OR (NOT day_use AND (day < r.check_in_date - 1 OR day >= r.check_out_date)) THEN
    RAISE EXCEPTION 'BUSINESS_DAY_OUTSIDE_STAY';
  END IF;
  SELECT * INTO rm FROM public.rooms WHERE id = COALESCE(_room_id,r.room_id) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ROOM_NOT_FOUND'; END IF;
  IF rm.hotel NOT IN (SELECT public.pms_hotel_room_keys(r.hotel_id)) THEN RAISE EXCEPTION 'ROOM_WRONG_HOTEL'; END IF;
  IF _moment IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.ntak_settings
    WHERE hotel_id=r.hotel_id AND enabled AND unit_scope='profiled_only'
  ) AND NOT EXISTS (
    SELECT 1 FROM public.ntak_unit_profiles
    WHERE hotel_id=r.hotel_id AND room_id=rm.id AND active
  ) THEN
    RAISE EXCEPTION 'ROOM_NOT_IN_NTAK_VALIDATION_SCOPE';
  END IF;
  IF day = (now() AT TIME ZONE 'Europe/Budapest')::date AND lower(COALESCE(rm.status,'')) <> 'clean' AND NOT _override THEN
    RAISE EXCEPTION 'ROOM_NOT_CLEAN';
  END IF;
  IF public.pms_room_has_conflict(rm.id,GREATEST(r.check_in_date,day),
    CASE WHEN day_use THEN day + 1 ELSE r.check_out_date END,r.id) THEN
    RAISE EXCEPTION 'ROOM_CONFLICT';
  END IF;
  IF COALESCE(rm.room_capacity,0) > 0 AND COALESCE(r.adults,0)+COALESCE(r.children,0)>rm.room_capacity AND NOT _override THEN
    RAISE EXCEPTION 'CAPACITY_EXCEEDED';
  END IF;
  UPDATE public.reservations SET status='checked_in',room_id=rm.id,actual_check_in=COALESCE(_moment,clock_timestamp()) WHERE id=r.id;
  UPDATE public.reservation_room_assignments SET status='cancelled'
    WHERE reservation_id=r.id AND room_id<>rm.id AND status IN ('assigned','active');
  IF EXISTS(SELECT 1 FROM public.reservation_room_assignments WHERE reservation_id=r.id AND room_id=rm.id) THEN
    UPDATE public.reservation_room_assignments SET status='active',
      check_in_date=GREATEST(r.check_in_date,day),
      check_out_date=CASE WHEN day_use THEN day + 1 ELSE r.check_out_date END
      WHERE reservation_id=r.id AND room_id=rm.id;
  ELSE
    INSERT INTO public.reservation_room_assignments(reservation_id,room_id,check_in_date,check_out_date,status)
    VALUES(r.id,rm.id,GREATEST(r.check_in_date,day),CASE WHEN day_use THEN day + 1 ELSE r.check_out_date END,'active');
  END IF;
  IF day=(now() AT TIME ZONE 'Europe/Budapest')::date THEN
    UPDATE public.rooms SET guest_count=r.adults+r.children,is_checkout_room=false,checkout_time=NULL,updated_at=now() WHERE id=rm.id;
  END IF;
  INSERT INTO public.reservation_events(reservation_id,hotel_id,organization_slug,event_type,metadata,created_by)
  VALUES(r.id,r.hotel_id,r.organization_slug,'check_in',
    jsonb_build_object('room_id',rm.id,'business_moment',COALESCE(_moment,clock_timestamp()),'historical',_moment IS NOT NULL),actor);
  RETURN jsonb_build_object('ok',true,'reservation_id',r.id,'room_number',rm.room_number,'occurred_at',_moment);
END;
$$;

CREATE OR REPLACE FUNCTION public.pms_check_out(
  _reservation_id uuid, _moment timestamptz DEFAULT NULL,
  _guest_ids uuid[] DEFAULT NULL, _acknowledge_balance boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.reservations%ROWTYPE;
  actor uuid := auth.uid();
  day date;
  bal numeric;
BEGIN
  SELECT * INTO r FROM public.reservations WHERE id=_reservation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RESERVATION_NOT_FOUND'; END IF;
  IF actor IS NULL OR NOT public.can_access_pms_hotel(actor,r.hotel_id,r.organization_slug) THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
  IF _guest_ids IS NOT NULL AND EXISTS(
    SELECT 1 FROM unnest(_guest_ids) AS gid WHERE NOT EXISTS(
      SELECT 1 FROM public.reservation_guests rg WHERE rg.reservation_id=r.id AND rg.guest_id=gid
    )
  ) THEN RAISE EXCEPTION 'GUEST_NOT_ON_RESERVATION'; END IF;
  PERFORM public.pms_assert_business_moment(r.hotel_id,r.organization_slug,_moment);
  PERFORM public.pms_set_business_moment(_moment);
  IF _moment IS NULL THEN
    RETURN public.pms_check_out_reservation(r.id,_acknowledge_balance);
  END IF;
  day := (_moment AT TIME ZONE 'Europe/Budapest')::date;
  IF r.status <> 'checked_in' THEN RAISE EXCEPTION 'INVALID_STATUS'; END IF;
  IF r.actual_check_in IS NOT NULL AND _moment < r.actual_check_in THEN RAISE EXCEPTION 'CHECK_OUT_BEFORE_CHECK_IN'; END IF;
  IF day < r.check_in_date OR day > r.check_out_date THEN RAISE EXCEPTION 'BUSINESS_DAY_OUTSIDE_STAY'; END IF;
  bal := COALESCE(r.balance_due,0);
  IF bal > 0 AND NOT _acknowledge_balance THEN RAISE EXCEPTION 'BALANCE_DUE'; END IF;
  UPDATE public.reservations SET status='checked_out',actual_check_out=_moment WHERE id=r.id;
  UPDATE public.reservation_room_assignments SET status='completed'
    WHERE reservation_id=r.id AND status IN ('assigned','active');
  IF day=(now() AT TIME ZONE 'Europe/Budapest')::date AND r.room_id IS NOT NULL THEN
    UPDATE public.rooms SET status=CASE WHEN status IN('out_of_order','maintenance') THEN status ELSE 'dirty' END,
      is_checkout_room=true,checkout_time=_moment,guest_count=0,updated_at=now() WHERE id=r.room_id;
  END IF;
  INSERT INTO public.reservation_events(reservation_id,hotel_id,organization_slug,event_type,metadata,created_by)
  VALUES(r.id,r.hotel_id,r.organization_slug,'check_out',
    jsonb_build_object('business_moment',_moment,'balance_at_checkout',bal,'balance_acknowledged',_acknowledge_balance),actor);
  RETURN jsonb_build_object('ok',true,'reservation_id',r.id,'balance_at_checkout',bal,'occurred_at',_moment);
END;
$$;

CREATE OR REPLACE FUNCTION public.pms_change_room(
  _reservation_id uuid, _to_room uuid, _moment timestamptz DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.reservations%ROWTYPE;
  rm public.rooms%ROWTYPE;
  actor uuid := auth.uid();
  day_use boolean;
  day date;
BEGIN
  SELECT * INTO r FROM public.reservations WHERE id=_reservation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RESERVATION_NOT_FOUND'; END IF;
  IF actor IS NULL OR NOT public.can_access_pms_hotel(actor,r.hotel_id,r.organization_slug) THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
  PERFORM public.pms_assert_business_moment(r.hotel_id,r.organization_slug,_moment);
  PERFORM public.pms_set_business_moment(_moment);
  day := (COALESCE(_moment,clock_timestamp()) AT TIME ZONE 'Europe/Budapest')::date;
  IF r.status <> 'checked_in' THEN RAISE EXCEPTION 'INVALID_STATUS'; END IF;
  IF r.room_id IS NULL OR r.room_id = _to_room THEN RAISE EXCEPTION 'ROOM_CHANGE_INVALID'; END IF;
  day_use := r.check_in_date = r.check_out_date;
  IF (day_use AND day <> r.check_in_date)
     OR (NOT day_use AND (day < r.check_in_date OR day >= r.check_out_date)) THEN
    RAISE EXCEPTION 'BUSINESS_DAY_OUTSIDE_STAY';
  END IF;
  IF r.actual_check_in IS NOT NULL AND COALESCE(_moment,clock_timestamp()) < r.actual_check_in THEN
    RAISE EXCEPTION 'ROOM_CHANGE_BEFORE_CHECK_IN';
  END IF;
  SELECT * INTO rm FROM public.rooms WHERE id=_to_room FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ROOM_NOT_FOUND'; END IF;
  IF rm.hotel NOT IN (SELECT public.pms_hotel_room_keys(r.hotel_id)) THEN RAISE EXCEPTION 'ROOM_WRONG_HOTEL'; END IF;
  IF _moment IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.ntak_settings
    WHERE hotel_id=r.hotel_id AND enabled AND unit_scope='profiled_only'
  ) AND NOT EXISTS (
    SELECT 1 FROM public.ntak_unit_profiles
    WHERE hotel_id=r.hotel_id AND room_id=rm.id AND active
  ) THEN
    RAISE EXCEPTION 'ROOM_NOT_IN_NTAK_VALIDATION_SCOPE';
  END IF;
  IF public.pms_room_has_conflict(_to_room,day,CASE WHEN day_use THEN day + 1 ELSE r.check_out_date END,r.id) THEN RAISE EXCEPTION 'ROOM_CONFLICT'; END IF;
  -- Do not overwrite historic stay segments. Closed assignments remain usable
  -- by NTAK roomOnDay; the new assignment begins on the change date.
  UPDATE public.reservation_room_assignments
    SET check_out_date=day,status='completed'
    WHERE reservation_id=r.id AND room_id=r.room_id
      AND check_in_date<day AND check_out_date>day AND status<>'cancelled';
  UPDATE public.reservation_room_assignments SET status='cancelled'
    WHERE reservation_id=r.id AND room_id=r.room_id AND check_in_date>=day AND status<>'cancelled';
  -- Append a fresh segment, including when the guest returns to an earlier
  -- room. Reusing/updating a prior segment would destroy historical occupancy.
  UPDATE public.reservation_room_assignments SET status='cancelled'
    WHERE reservation_id=r.id AND room_id=_to_room
      AND status IN ('assigned','active') AND check_out_date>day;
  INSERT INTO public.reservation_room_assignments(reservation_id,room_id,check_in_date,check_out_date,status)
  VALUES(r.id,_to_room,day,CASE WHEN day_use THEN day + 1 ELSE r.check_out_date END,'active');
  UPDATE public.reservations SET room_id=_to_room WHERE id=r.id;
  IF day=(now() AT TIME ZONE 'Europe/Budapest')::date THEN
    UPDATE public.rooms SET guest_count=0,updated_at=now() WHERE id=r.room_id;
    UPDATE public.rooms SET guest_count=COALESCE(r.adults,0)+COALESCE(r.children,0),updated_at=now() WHERE id=_to_room;
  END IF;
  INSERT INTO public.reservation_events(reservation_id,hotel_id,organization_slug,event_type,metadata,created_by)
  VALUES(r.id,r.hotel_id,r.organization_slug,'edited',
    jsonb_build_object('from_room',r.room_id,'to_room',_to_room,'business_moment',COALESCE(_moment,clock_timestamp())),actor);
  RETURN jsonb_build_object('ok',true,'reservation_id',r.id,'room_number',rm.room_number);
END;
$$;

CREATE OR REPLACE FUNCTION public.pms_undo_check_in(
  _reservation_id uuid, _moment timestamptz DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.reservations%ROWTYPE; actor uuid := auth.uid();
BEGIN
  SELECT * INTO r FROM public.reservations WHERE id=_reservation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RESERVATION_NOT_FOUND'; END IF;
  IF actor IS NULL OR NOT public.can_access_pms_hotel(actor,r.hotel_id,r.organization_slug) THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
  PERFORM public.pms_assert_business_moment(r.hotel_id,r.organization_slug,_moment);
  PERFORM public.pms_set_business_moment(_moment);
  IF r.status <> 'checked_in' THEN RAISE EXCEPTION 'INVALID_STATUS'; END IF;
  UPDATE public.reservations SET status='confirmed',actual_check_in=NULL WHERE id=r.id;
  UPDATE public.reservation_room_assignments SET status='assigned'
    WHERE reservation_id=r.id AND status='active';
  IF _moment IS NULL AND r.room_id IS NOT NULL THEN UPDATE public.rooms SET guest_count=0,updated_at=now() WHERE id=r.room_id; END IF;
  INSERT INTO public.reservation_events(reservation_id,hotel_id,organization_slug,event_type,metadata,created_by)
  VALUES(r.id,r.hotel_id,r.organization_slug,'edited',jsonb_build_object('undo','check_in','business_moment',_moment),actor);
  RETURN jsonb_build_object('ok',true);
END;
$$;

CREATE OR REPLACE FUNCTION public.pms_undo_check_out(
  _reservation_id uuid, _moment timestamptz DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.reservations%ROWTYPE; actor uuid := auth.uid();
BEGIN
  SELECT * INTO r FROM public.reservations WHERE id=_reservation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RESERVATION_NOT_FOUND'; END IF;
  IF actor IS NULL OR NOT public.can_access_pms_hotel(actor,r.hotel_id,r.organization_slug) THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
  PERFORM public.pms_assert_business_moment(r.hotel_id,r.organization_slug,_moment);
  PERFORM public.pms_set_business_moment(_moment);
  IF r.status <> 'checked_out' THEN RAISE EXCEPTION 'INVALID_STATUS'; END IF;
  UPDATE public.reservations SET status='checked_in',actual_check_out=NULL WHERE id=r.id;
  UPDATE public.reservation_room_assignments SET status='active'
    WHERE reservation_id=r.id AND status='completed' AND room_id=r.room_id;
  IF _moment IS NULL AND r.room_id IS NOT NULL THEN
    UPDATE public.rooms SET guest_count=COALESCE(r.adults,0)+COALESCE(r.children,0),is_checkout_room=false,checkout_time=NULL,updated_at=now() WHERE id=r.room_id;
  END IF;
  INSERT INTO public.reservation_events(reservation_id,hotel_id,organization_slug,event_type,metadata,created_by)
  VALUES(r.id,r.hotel_id,r.organization_slug,'edited',jsonb_build_object('undo','check_out','business_moment',_moment),actor);
  RETURN jsonb_build_object('ok',true);
END;
$$;

-- Dedicated dated-finance entrypoint. Writes both the existing guest folio and
-- the NTAK financial-core ledger, linked by legacy_guest_folio_id. Unmodified
-- UI paths still use pms_add_folio_item; only the new UI uses this entrypoint.
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
  IF to_regclass('public.reservation_folios') IS NOT NULL
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

-- NTAK trigger: never raise into the front desk; use the authorized
-- transaction-local moment for every queued event. Keep phase-1 scope.
CREATE OR REPLACE FUNCTION public.ntak_on_reservation_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cfg public.ntak_settings%ROWTYPE;
  old_status text;
  new_status text := NEW.status::text;
  booking_changed boolean := true;
  moment_at timestamptz;
BEGIN
  BEGIN
    SELECT * INTO cfg FROM public.ntak_settings WHERE hotel_id=NEW.hotel_id AND enabled;
    IF NOT FOUND THEN RETURN NEW; END IF;
    IF cfg.unit_scope='profiled_only' THEN
      IF NEW.room_id IS NOT NULL THEN
        IF NOT EXISTS(SELECT 1 FROM public.ntak_unit_profiles p WHERE p.hotel_id=NEW.hotel_id AND p.room_id=NEW.room_id AND p.active) THEN RETURN NEW; END IF;
      ELSIF NEW.room_type_id IS NOT NULL THEN
        IF NOT EXISTS(SELECT 1 FROM public.ntak_room_type_units t WHERE t.hotel_id=NEW.hotel_id AND t.room_type_id=NEW.room_type_id AND t.active) THEN RETURN NEW; END IF;
      ELSE RETURN NEW; END IF;
    END IF;
    moment_at := COALESCE(NULLIF(current_setting('hotelcare.business_moment',true),'')::timestamptz,clock_timestamp());
    IF TG_OP='UPDATE' THEN
      old_status := OLD.status::text;
      booking_changed := NEW.status IS DISTINCT FROM OLD.status OR NEW.check_in_date IS DISTINCT FROM OLD.check_in_date
        OR NEW.check_out_date IS DISTINCT FROM OLD.check_out_date OR NEW.room_id IS DISTINCT FROM OLD.room_id
        OR NEW.room_type_id IS DISTINCT FROM OLD.room_type_id OR NEW.adults IS DISTINCT FROM OLD.adults
        OR NEW.children IS DISTINCT FROM OLD.children OR NEW.total_amount IS DISTINCT FROM OLD.total_amount
        OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.guest_id IS DISTINCT FROM OLD.guest_id
        OR NEW.source IS DISTINCT FROM OLD.source OR NEW.ota_name IS DISTINCT FROM OLD.ota_name;
    END IF;
    IF NEW.check_out_date>=current_date AND booking_changed THEN
      INSERT INTO public.ntak_booking_queue(hotel_id,booking_no,dirty_at)
      VALUES(NEW.hotel_id,public.ntak_booking_no(NEW.channex_booking_id::text,NEW.pms_reservation_id::text,NEW.reservation_number,NEW.id),now())
      ON CONFLICT(hotel_id,booking_no) DO UPDATE SET dirty_at=now();
    END IF;
    IF cfg.first_closure_date IS NOT NULL AND (moment_at AT TIME ZONE 'Europe/Budapest')::date < cfg.first_closure_date THEN
      RAISE WARNING 'NTAK event ignored: business day before first_closure_date %',cfg.first_closure_date;
      RETURN NEW;
    END IF;
    IF TG_OP='UPDATE' THEN
      IF new_status='checked_in' AND old_status IS DISTINCT FROM 'checked_in' THEN
        INSERT INTO public.ntak_event_queue(hotel_id,organization_slug,reservation_id,kind,room_id,is_correction,occurred_at)
        VALUES(NEW.hotel_id,cfg.organization_slug,NEW.id,'erkezett',NEW.room_id,old_status='checked_out',moment_at);
      ELSIF new_status='checked_out' AND old_status='checked_in' THEN
        INSERT INTO public.ntak_event_queue(hotel_id,organization_slug,reservation_id,kind,room_id,occurred_at)
        VALUES(NEW.hotel_id,cfg.organization_slug,NEW.id,'tavozott',NEW.room_id,moment_at);
      ELSIF old_status='checked_in' AND new_status IN ('confirmed','pending','no_show','cancelled') THEN
        INSERT INTO public.ntak_event_queue(hotel_id,organization_slug,reservation_id,kind,room_id,is_correction,occurred_at)
        VALUES(NEW.hotel_id,cfg.organization_slug,NEW.id,'tavozott',COALESCE(OLD.room_id,NEW.room_id),true,moment_at);
      ELSIF new_status='checked_in' AND NEW.room_id IS DISTINCT FROM OLD.room_id AND OLD.room_id IS NOT NULL AND NEW.room_id IS NOT NULL THEN
        INSERT INTO public.ntak_event_queue(hotel_id,organization_slug,reservation_id,kind,room_id,from_room_id,occurred_at)
        VALUES(NEW.hotel_id,cfg.organization_slug,NEW.id,'lakoegysegetCserelt',NEW.room_id,OLD.room_id,moment_at);
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'ntak_on_reservation_change: %',SQLERRM;
  END;
  RETURN NEW;
END;
$$;

-- VIZA must observe the same authorized moment as NTAK and the reservation.
CREATE OR REPLACE FUNCTION public.viza_on_reservation_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cfg public.viza_settings%ROWTYPE; moment_at timestamptz;
BEGIN
  SELECT * INTO cfg FROM public.viza_settings WHERE hotel_id=NEW.hotel_id AND enabled AND adatszolgaltatasi_azonosito IS NOT NULL;
  IF NOT FOUND THEN RETURN NEW; END IF;
  moment_at := COALESCE(NULLIF(current_setting('hotelcare.business_moment',true),'')::timestamptz,clock_timestamp());
  IF OLD.status='checked_out' AND NEW.status='checked_in' THEN
    -- Reopen unsent departures. Never silently retract a departure already
    -- transmitted to VIZA; flag it for a supervised correction.
    UPDATE public.viza_guest_events SET tavozas_ideje=NULL,departure_state=NULL,updated_at=now()
      WHERE reservation_id=NEW.id AND departure_state IS DISTINCT FROM 'sent';
    UPDATE public.viza_guest_events SET last_error='Departure already sent to VIZA; manual correction required after undo',
      updated_at=now()
      WHERE reservation_id=NEW.id AND departure_state='sent';
  ELSIF OLD.status='checked_in' AND NEW.status IN ('confirmed','pending') THEN
    DELETE FROM public.viza_guest_events WHERE reservation_id=NEW.id AND arrival_state='queued';
    UPDATE public.viza_guest_events SET
      last_error='Arrival already sent to VIZA; manual correction required after undo',updated_at=now()
      WHERE reservation_id=NEW.id AND arrival_state='sent';
  ELSIF NEW.status='checked_in' AND OLD.status IS DISTINCT FROM 'checked_in' THEN
    INSERT INTO public.viza_guest_events(hotel_id,organization_slug,reservation_id,guest_id,erkezes_ideje,tavozas_varhato_datuma)
    VALUES(NEW.hotel_id,cfg.organization_slug,NEW.id,NEW.guest_id,COALESCE(NEW.actual_check_in,moment_at),NEW.check_out_date)
    ON CONFLICT (reservation_id,COALESCE(guest_id,'00000000-0000-0000-0000-000000000000'::uuid)) DO NOTHING;
  ELSIF NEW.status='checked_out' AND OLD.status IS DISTINCT FROM 'checked_out' THEN
    UPDATE public.viza_guest_events SET tavozas_ideje=COALESCE(NEW.actual_check_out,moment_at),
      departure_state=CASE WHEN arrival_state='sent' THEN 'queued' ELSE departure_state END,updated_at=now()
      WHERE reservation_id=NEW.id AND tavozas_ideje IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.pms_check_in(uuid,timestamptz,uuid[],uuid,boolean) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.pms_check_out(uuid,timestamptz,uuid[],boolean) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.pms_change_room(uuid,uuid,timestamptz) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.pms_undo_check_in(uuid,timestamptz) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.pms_undo_check_out(uuid,timestamptz) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.pms_record_business_folio_item(uuid,text,numeric,text,date,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.pms_check_in(uuid,timestamptz,uuid[],uuid,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pms_check_out(uuid,timestamptz,uuid[],boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pms_change_room(uuid,uuid,timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pms_undo_check_in(uuid,timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pms_undo_check_out(uuid,timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pms_record_business_folio_item(uuid,text,numeric,text,date,text) TO authenticated;
REVOKE ALL ON FUNCTION public.ntak_on_reservation_change() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.viza_on_reservation_status() FROM PUBLIC,anon,authenticated;


-- Enforce manager-only historical dates even for callers that bypass the UI
-- and invoke the existing financial-core functions directly. Keep imported
-- service-role sync intact (auth.uid() is NULL for trusted server jobs).
CREATE OR REPLACE FUNCTION public.pms_validate_financial_business_day()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  actor uuid := auth.uid();
  hotel text;
  org text;
  day date;
BEGIN
  IF actor IS NULL THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='folio_lines' THEN
    day := NEW.service_date;
    SELECT f.hotel_id,f.organization_slug INTO hotel,org
    FROM public.reservation_folios f WHERE f.id=NEW.folio_id;
  ELSE
    day := (NEW.received_at AT TIME ZONE 'Europe/Budapest')::date;
    hotel := NEW.hotel_id;
    org := NEW.organization_slug;
  END IF;
  IF hotel IS NULL THEN RAISE EXCEPTION 'FINANCE_HOTEL_NOT_FOUND'; END IF;
  IF NOT public.can_access_pms_hotel(actor,hotel,org) THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
  IF day > (now() AT TIME ZONE 'Europe/Budapest')::date THEN
    RAISE EXCEPTION 'BUSINESS_MOMENT_CANNOT_BE_FUTURE';
  END IF;
  IF day < (now() AT TIME ZONE 'Europe/Budapest')::date THEN
    PERFORM public.pms_assert_business_moment(
      hotel,org,(day + time '12:00') AT TIME ZONE 'Europe/Budapest');
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.pms_validate_financial_business_day() FROM PUBLIC,anon,authenticated;
-- Databases that have not deployed the earlier PMS financial-core migration
-- still support dated legacy folios; install the financial-core migration
-- before certifying NTAK financial reports. Trigger creation is conditional
-- so an existing non-finance production database can apply Phase 2 safely.
DO $finance_guard$
BEGIN
  IF to_regclass('public.folio_lines') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS pms_validate_financial_business_day ON public.folio_lines';
    EXECUTE 'CREATE TRIGGER pms_validate_financial_business_day BEFORE INSERT OR UPDATE OF service_date ON public.folio_lines FOR EACH ROW EXECUTE FUNCTION public.pms_validate_financial_business_day()';
  END IF;
  IF to_regclass('public.payments') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS pms_validate_financial_business_day ON public.payments';
    EXECUTE 'CREATE TRIGGER pms_validate_financial_business_day BEFORE INSERT OR UPDATE OF received_at ON public.payments FOR EACH ROW EXECUTE FUNCTION public.pms_validate_financial_business_day()';
  END IF;
END;
$finance_guard$;

-- These are explicit post-migration fixtures for a *test* hotel only:
-- 1) create FOGL_01/FOGL_02 reservations with 101/103 rooms and complete guests;
-- 2) grant a scoped manager and enable allow_backdating with min_date <= T02;
-- 3) call pms_check_in(... T02), pms_change_room(... T03), pms_check_out(... T04);
-- 4) inspect ntak_event_queue.occurred_at and built XML idopont;
--    verify pms_finance_* deployment before validating finance-core ledgers;
-- 5) verify first_closure_date, non-manager and disabled-flag refusals.
-- Do not run this sequence on production or with live NTAK reporting.
