-- Disposable test database only. Load ntak_fixture.sql and ntak_phase3_activation_fixture.sql first.
ALTER TABLE public.profiles ADD COLUMN nickname text;
ALTER TABLE public.reservations ADD COLUMN ntak_booking_no text;
CREATE TABLE public.ntak_booking_queue(hotel_id text NOT NULL,booking_no text NOT NULL,dirty_at timestamptz NOT NULL,PRIMARY KEY(hotel_id,booking_no));
CREATE FUNCTION public.ntak_booking_no(_override text,_channex text,_pms text,_number text,_id uuid) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT COALESCE(NULLIF(btrim(_override),''),NULLIF(_channex,''),NULLIF(_pms,''),NULLIF(_number,''),_id::text) $$;
CREATE OR REPLACE FUNCTION public.pms_set_ntak_booking_no(
  _reservation_id uuid,_booking_no text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.reservations%ROWTYPE; p public.profiles%ROWTYPE;
  actor uuid:=auth.uid(); cleaned text:=NULLIF(btrim(_booking_no),'');
BEGIN
  SELECT * INTO r FROM public.reservations WHERE id=_reservation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RESERVATION_NOT_FOUND'; END IF;
  IF actor IS NULL OR NOT public.can_access_pms_hotel(actor,r.hotel_id,r.organization_slug) THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
  SELECT * INTO p FROM public.profiles WHERE id=actor;
  IF NOT FOUND OR NOT (
    COALESCE(p.is_super_admin,false) OR
    p.role::text IN ('admin','top_management','top_management_manager','manager')
    OR (p.organization_slug='rdhotels' AND lower(btrim(COALESCE(p.nickname,'')))='anu_000')
  ) THEN RAISE EXCEPTION 'MANAGER_REQUIRED'; END IF;
  IF cleaned IS NOT NULL AND length(cleaned)>255 THEN RAISE EXCEPTION 'BOOKING_NUMBER_TOO_LONG'; END IF;
  UPDATE public.reservations SET ntak_booking_no=cleaned WHERE id=r.id;
  RETURN jsonb_build_object('ok',true,'booking_no',cleaned);
END;
$$;


-- Test doubles for the already-shipped lifecycle functions: exercise wrapper
-- argument routing and transaction rollback without importing unrelated tables.
CREATE FUNCTION public.pms_create_reservation(_hotel_id text,_guest_id uuid,_check_in date,_check_out date,_adults int,_children int,_room_id uuid,_room_type_requested text,_rate_per_night numeric,_currency text,_source text,_special_requests text,_internal_notes text,_status text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE rid uuid;
BEGIN
  IF public.can_access_pms_hotel(auth.uid(),_hotel_id,'test') IS NOT TRUE THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
  INSERT INTO reservations(hotel_id,organization_slug,guest_id,check_in_date,check_out_date,adults,children,room_id,total_amount,currency,source,status,reservation_number)
  VALUES(_hotel_id,'test',_guest_id,_check_in,_check_out,_adults,_children,_room_id,_rate_per_night,_currency,_source,_status::reservation_status,'fixture') RETURNING id INTO rid;
  RETURN jsonb_build_object('ok',true,'id',rid);
END $$;
CREATE FUNCTION public.pms_update_reservation(_reservation_id uuid,_check_in date,_check_out date,_adults int,_children int,_room_id uuid,_clear_room boolean,_rate_per_night numeric,_source text,_room_type_requested text,_special_requests text,_internal_notes text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 UPDATE reservations SET total_amount=COALESCE(_rate_per_night,total_amount),check_in_date=COALESCE(_check_in,check_in_date) WHERE id=_reservation_id;
 RETURN jsonb_build_object('ok',true);
END $$;
