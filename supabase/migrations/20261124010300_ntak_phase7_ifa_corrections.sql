-- Phase 7: dirty accepted closures immediately when source data changes.
-- Keep the NTAK guest identifier stable; corrections amend the same guest.
-- No authority send is initiated by any trigger.
CREATE OR REPLACE FUNCTION public.ntak_phase7_dirty_day(_hotel text, _day date)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.ntak_daily_closures
  SET needs_correction = true,
      correction_detected_at = COALESCE(correction_detected_at, now()),
      updated_at = now()
  WHERE hotel_id = _hotel AND closed_day = _day AND accepted_once
    AND NOT needs_correction;
$$;
REVOKE ALL ON FUNCTION public.ntak_phase7_dirty_day(text,date) FROM PUBLIC, anon, authenticated;

-- Guest edits target snapshots which actually included this guest's stable ID.
-- The reservation-specific status override additionally restricts the stay dates.
CREATE OR REPLACE FUNCTION public.ntak_phase7_dirty_guest(_guest uuid, _reservation uuid DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.ntak_daily_closures c
  SET needs_correction = true,
      correction_detected_at = COALESCE(c.correction_detected_at, now()),
      updated_at = now()
  FROM public.ntak_guest_ids g
  WHERE g.guest_id = _guest AND g.hotel_id = c.hotel_id
    AND c.accepted_once AND NOT c.needs_correction
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(c.snapshot->'closure'->'nights','[]'::jsonb)) n
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(n->'guests','[]'::jsonb)) v
      WHERE v->>'vendegId' = g.vendeg_id
    )
    AND (_reservation IS NULL OR EXISTS (
      SELECT 1 FROM public.reservations r WHERE r.id = _reservation
      AND r.hotel_id = c.hotel_id
      AND c.closed_day BETWEEN
        LEAST(r.check_in_date, (r.actual_check_in AT TIME ZONE 'Europe/Budapest')::date)
        AND GREATEST(r.check_out_date, (r.actual_check_out AT TIME ZONE 'Europe/Budapest')::date)
    ));
$$;
REVOKE ALL ON FUNCTION public.ntak_phase7_dirty_guest(uuid,uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ntak_phase7_guest_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_TABLE_NAME = 'guests' THEN
    IF ROW(OLD.date_of_birth, OLD.postal_code, OLD.nationality, OLD.country)
       IS DISTINCT FROM ROW(NEW.date_of_birth, NEW.postal_code, NEW.nationality, NEW.country) THEN
      PERFORM public.ntak_phase7_dirty_guest(NEW.id);
    END IF;
  ELSE
    IF OLD.ifa_status IS DISTINCT FROM NEW.ifa_status THEN
      PERFORM public.ntak_phase7_dirty_guest(NEW.guest_id, NEW.reservation_id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.ntak_phase7_guest_change() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER ntak_phase7_guest_change
AFTER UPDATE OF date_of_birth, postal_code, nationality, country ON public.guests
FOR EACH ROW EXECUTE FUNCTION public.ntak_phase7_guest_change();
CREATE TRIGGER ntak_phase7_ifa_change
AFTER UPDATE OF ifa_status ON public.reservation_guests
FOR EACH ROW EXECUTE FUNCTION public.ntak_phase7_guest_change();

-- Charge postings are keyed by service_date. Payments received before arrival
-- are reported on the arrival business day, as in the NTAK ledger builder.
CREATE OR REPLACE FUNCTION public.ntak_phase7_dirty_finance(_table text, _row jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _hotel text; _day date; _arrival date;
BEGIN
  IF _row IS NULL THEN RETURN; END IF;
  IF _table = 'folio_lines' THEN
    SELECT hotel_id INTO _hotel FROM public.reservation_folios WHERE id = (_row->>'folio_id')::uuid;
    _day := (_row->>'service_date')::date;
  ELSIF _table = 'payments' THEN
    _hotel := _row->>'hotel_id';
    _day := ((_row->>'received_at')::timestamptz AT TIME ZONE 'Europe/Budapest')::date;
    SELECT COALESCE((actual_check_in AT TIME ZONE 'Europe/Budapest')::date, check_in_date)
    INTO _arrival FROM public.reservations WHERE id = (_row->>'reservation_id')::uuid AND hotel_id = _hotel;
    IF _day IS NOT NULL AND _arrival IS NOT NULL THEN _day := GREATEST(_day, _arrival); END IF;
  END IF;
  IF _hotel IS NOT NULL AND _day IS NOT NULL THEN
    PERFORM public.ntak_phase7_dirty_day(_hotel, _day);
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.ntak_phase7_dirty_finance(text,jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ntak_phase7_finance_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF TG_TABLE_NAME = 'folio_lines' THEN
      IF ROW(OLD.folio_id,OLD.service_date,OLD.room_id,OLD.gross_total,OLD.vat_rate,OLD.currency,OLD.status,OLD.source_type,OLD.service_catalog_item_id)
         IS NOT DISTINCT FROM ROW(NEW.folio_id,NEW.service_date,NEW.room_id,NEW.gross_total,NEW.vat_rate,NEW.currency,NEW.status,NEW.source_type,NEW.service_catalog_item_id)
      THEN RETURN NEW; END IF;
    ELSE
      IF ROW(OLD.reservation_id,OLD.hotel_id,OLD.amount,OLD.currency,OLD.method,OLD.status,OLD.received_at)
         IS NOT DISTINCT FROM ROW(NEW.reservation_id,NEW.hotel_id,NEW.amount,NEW.currency,NEW.method,NEW.status,NEW.received_at)
      THEN RETURN NEW; END IF;
    END IF;
  END IF;
  IF TG_OP <> 'INSERT' THEN PERFORM public.ntak_phase7_dirty_finance(TG_TABLE_NAME, to_jsonb(OLD)); END IF;
  IF TG_OP <> 'DELETE' THEN PERFORM public.ntak_phase7_dirty_finance(TG_TABLE_NAME, to_jsonb(NEW)); END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.ntak_phase7_finance_change() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER ntak_phase7_folio_change
AFTER INSERT OR UPDATE OR DELETE ON public.folio_lines
FOR EACH ROW EXECUTE FUNCTION public.ntak_phase7_finance_change();
CREATE TRIGGER ntak_phase7_payment_change
AFTER INSERT OR UPDATE OR DELETE ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.ntak_phase7_finance_change();

-- This narrowly scoped RPC avoids granting direct guest lifecycle writes.
CREATE OR REPLACE FUNCTION public.pms_set_guest_ifa_status(_reservation_id uuid,_guest_id uuid,_status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.reservations%ROWTYPE;
BEGIN
 SELECT * INTO r FROM public.reservations WHERE id=_reservation_id FOR UPDATE;
 IF NOT FOUND OR auth.uid() IS NULL OR NOT public.can_access_pms_hotel(auth.uid(),r.hotel_id,r.organization_slug) THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 IF NOT public.pms_ntak_guest_scope(r.id,r.room_id) THEN RAISE EXCEPTION 'NTAK_NOT_ENABLED'; END IF;
 -- TODO: only add manual exemption codes when verified against the official v9 annex.
 IF _status IS NOT NULL AND _status <> 'KOTELES' THEN RAISE EXCEPTION 'IFA_EXEMPTION_UNVERIFIED'; END IF;
 UPDATE public.reservation_guests SET ifa_status=_status WHERE reservation_id=_reservation_id AND guest_id=_guest_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'GUEST_NOT_FOUND'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.pms_set_guest_ifa_status(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pms_set_guest_ifa_status(uuid,uuid,text) TO authenticated;
