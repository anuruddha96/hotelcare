-- NTAK Phase 6: nullable explicit booking reporting values. Apply after Phase 3.
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS ntak_guaranteed boolean,
  ADD COLUMN IF NOT EXISTS ntak_market_segment text CHECK (ntak_market_segment IN ('SZABADIDOS_EGYENI','SZABADIDOS_CSOPORTOS','UZLETI_EGYENI','UZLETI_CSOPORTOS','ISMERETLEN')),
  ADD COLUMN IF NOT EXISTS ntak_sales_channel text CHECK (ntak_sales_channel IN ('DIREKT_ONLINE','DIREKT_HAGYOMANYOS','KOZVETITO_ONLINE','KOZVETITO_HAGYOMANYOS')),
  ADD COLUMN IF NOT EXISTS booker_country text CHECK (booker_country IN ('AF','AX','AL','DZ','UM','US','AS','VI','AD','AO','AI','AQ','AG','AR','AW','AU','AT','AZ','BS','BH','BD','BB','BE','BZ','BJ','BM','BT','GW','BO','BA','BW','BV','BR','IO','VG','BN','BG','BF','BI','CL','CY','KM','CK','CR','CW','TD','CZ','DK','ZA','GS','SS','KR','DM','DO','DJ','EC','GQ','AE','GB','EG','CI','SV','ER','MP','KP','EE','ET','FK','BY','FO','FJ','FI','TF','GF','FR','PF','PH','GA','GM','GH','GI','GR','GD','GL','GE','GP','GU','GT','GG','GN','GY','HT','HM','NL','HN','HK','HR','IN','ID','IQ','IR','IE','IS','IL','JM','JP','YE','JE','JO','KY','KH','CM','CA','CX','BQ','QA','KZ','TL','KE','CN','KG','KI','CC','CO','CD','CG','XK','CF','CU','KW','LA','PL','LS','LV','LB','LR','LY','LI','LT','LU','MK','MG','HU','MO','MY','MW','MV','ML','MT','IM','MA','MH','MQ','MR','MU','YT','MX','MM','FM','MD','MC','MN','ME','MS','MZ','NA','NR','DE','NP','NI','NE','NG','NU','NF','NO','EH','IT','OM','RU','AM','PK','PW','PS','PA','PG','PY','PE','PN','PT','PR','RE','RO','RW','BL','KN','LC','MF','PM','VC','SB','SM','ST','SC','SL','SX','ES','SJ','LK','SR','CH','SE','WS','SA','SN','SH','RS','SG','SY','SK','SI','SO','SD','SZ','TJ','TW','TZ','TH','TG','TK','TO','TR','TT','TN','TC','TV','TM','UG','NC','NZ','UA','UY','UZ','VU','VA','VE','VN','WF','ZM','ZW','CV','EGYEBKULFOLDI')),
  ADD COLUMN IF NOT EXISTS expected_guests integer CHECK (expected_guests BETWEEN 1 AND 99);

-- Independent trigger: do not replace earlier stay-event or finance triggers.
CREATE OR REPLACE FUNCTION public.ntak_phase6_booking_dirty()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE cfg public.ntak_settings%ROWTYPE;
BEGIN
  IF ROW(NEW.ntak_guaranteed,NEW.ntak_market_segment,NEW.ntak_sales_channel,NEW.booker_country,NEW.expected_guests)
     IS NOT DISTINCT FROM ROW(OLD.ntak_guaranteed,OLD.ntak_market_segment,OLD.ntak_sales_channel,OLD.booker_country,OLD.expected_guests) THEN RETURN NEW; END IF;
  SELECT * INTO cfg FROM public.ntak_settings WHERE hotel_id=NEW.hotel_id AND enabled;
  IF NOT FOUND OR NEW.check_out_date < (clock_timestamp() AT TIME ZONE 'Europe/Budapest')::date THEN RETURN NEW; END IF;
  IF cfg.unit_scope='profiled_only' THEN
    IF NEW.room_id IS NOT NULL THEN
      IF NOT EXISTS(SELECT 1 FROM public.ntak_unit_profiles p WHERE p.hotel_id=NEW.hotel_id AND p.room_id=NEW.room_id AND p.active) THEN RETURN NEW; END IF;
    ELSIF NEW.room_type_id IS NOT NULL THEN
      IF NOT EXISTS(SELECT 1 FROM public.ntak_room_type_units t WHERE t.hotel_id=NEW.hotel_id AND t.room_type_id=NEW.room_type_id AND t.active) THEN RETURN NEW; END IF;
    ELSE RETURN NEW; END IF;
  END IF;
  INSERT INTO public.ntak_booking_queue(hotel_id,booking_no,dirty_at)
  VALUES(NEW.hotel_id,public.ntak_booking_no(NEW.ntak_booking_no,NEW.channex_booking_id::text,NEW.pms_reservation_id::text,NEW.reservation_number,NEW.id),clock_timestamp())
  ON CONFLICT(hotel_id,booking_no) DO UPDATE SET dirty_at=GREATEST(ntak_booking_queue.dirty_at,EXCLUDED.dirty_at);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.ntak_phase6_booking_dirty() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS ntak_phase6_booking_dirty ON public.reservations;
CREATE TRIGGER ntak_phase6_booking_dirty AFTER UPDATE OF ntak_guaranteed,ntak_market_segment,ntak_sales_channel,booker_country,expected_guests ON public.reservations
FOR EACH ROW EXECUTE FUNCTION public.ntak_phase6_booking_dirty();

-- Report fields are booking data, not NTAK settings. A scoped read avoids
-- granting reception access to administrative settings or unrelated hotels.
CREATE OR REPLACE FUNCTION public.pms_ntak_booking_fields(_hotel_id text, _organization_slug text, _reservation_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.reservations%ROWTYPE; p public.profiles%ROWTYPE; actor uuid:=auth.uid();
BEGIN
  IF actor IS NULL OR NOT public.can_access_pms_hotel(actor,_hotel_id,_organization_slug) THEN RETURN NULL; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.ntak_settings s WHERE s.hotel_id=_hotel_id AND s.organization_slug=_organization_slug AND s.enabled) THEN RETURN NULL; END IF;
  IF _reservation_id IS NOT NULL THEN
    SELECT * INTO r FROM public.reservations WHERE id=_reservation_id AND hotel_id=_hotel_id AND organization_slug=_organization_slug;
    IF NOT FOUND THEN RETURN NULL; END IF;
  END IF;
  SELECT * INTO p FROM public.profiles WHERE id=actor;
  RETURN jsonb_build_object('ntak_guaranteed',r.ntak_guaranteed,'ntak_market_segment',r.ntak_market_segment,
    'ntak_sales_channel',r.ntak_sales_channel,'booker_country',r.booker_country,'expected_guests',r.expected_guests,
    'ntak_booking_no',r.ntak_booking_no,'can_edit_booking_no',COALESCE(p.is_super_admin,false) OR
    p.role::text IN ('admin','top_management','top_management_manager','manager') OR
    (p.organization_slug='rdhotels' AND lower(btrim(COALESCE(p.nickname,'')))='anu_000'));
END;
$$;

CREATE OR REPLACE FUNCTION public.pms_save_ntak_booking_fields(_reservation_id uuid,_fields jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.reservations%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.reservations WHERE id=_reservation_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR NOT public.can_access_pms_hotel(auth.uid(),r.hotel_id,r.organization_slug) THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
  IF public.pms_ntak_booking_fields(r.hotel_id,r.organization_slug,r.id) IS NULL THEN RAISE EXCEPTION 'NTAK_NOT_ENABLED'; END IF;
  IF jsonb_typeof(_fields) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'INVALID_NTAK_FIELDS'; END IF;
  IF _fields ? 'ntak_booking_no' THEN
    PERFORM public.pms_set_ntak_booking_no(r.id,_fields->>'ntak_booking_no');
  END IF;
  UPDATE public.reservations SET
    ntak_guaranteed=CASE WHEN _fields ? 'ntak_guaranteed' THEN (_fields->>'ntak_guaranteed')::boolean ELSE r.ntak_guaranteed END,
    ntak_market_segment=CASE WHEN _fields ? 'ntak_market_segment' THEN _fields->>'ntak_market_segment' ELSE r.ntak_market_segment END,
    ntak_sales_channel=CASE WHEN _fields ? 'ntak_sales_channel' THEN _fields->>'ntak_sales_channel' ELSE r.ntak_sales_channel END,
    booker_country=CASE WHEN _fields ? 'booker_country' THEN _fields->>'booker_country' ELSE r.booker_country END,
    expected_guests=CASE WHEN _fields ? 'expected_guests' THEN (_fields->>'expected_guests')::integer ELSE r.expected_guests END
  WHERE id=r.id;
END;
$$;

-- Use the original lifecycle RPCs unchanged; both writes occur in one
-- transaction so invalid reporting values cannot leave a half-saved booking.
CREATE OR REPLACE FUNCTION public.pms_create_reservation_phase6(_args jsonb,_fields jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE result jsonb;
BEGIN
  result := public.pms_create_reservation(
    _hotel_id=>_args->>'_hotel_id',_guest_id=>(_args->>'_guest_id')::uuid,
    _check_in=>(_args->>'_check_in')::date,_check_out=>(_args->>'_check_out')::date,
    _adults=>(_args->>'_adults')::integer,_children=>(_args->>'_children')::integer,
    _room_id=>(_args->>'_room_id')::uuid,_room_type_requested=>_args->>'_room_type_requested',
    _rate_per_night=>(_args->>'_rate_per_night')::numeric,_currency=>_args->>'_currency',
    _source=>_args->>'_source',_special_requests=>_args->>'_special_requests',
    _internal_notes=>_args->>'_internal_notes',_status=>_args->>'_status');
  IF (result->>'ok')::boolean IS TRUE THEN
    PERFORM public.pms_save_ntak_booking_fields((result->>'id')::uuid,_fields);
  END IF;
  RETURN result;
END;
$$;
CREATE OR REPLACE FUNCTION public.pms_update_reservation_phase6(_args jsonb,_fields jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE result jsonb;
BEGIN
  result := public.pms_update_reservation(
    _reservation_id=>(_args->>'_reservation_id')::uuid,
    _check_in=>(_args->>'_check_in')::date,_check_out=>(_args->>'_check_out')::date,
    _adults=>(_args->>'_adults')::integer,_children=>(_args->>'_children')::integer,
    _room_id=>(_args->>'_room_id')::uuid,_clear_room=>(_args->>'_clear_room')::boolean,
    _rate_per_night=>(_args->>'_rate_per_night')::numeric,_source=>_args->>'_source',
    _room_type_requested=>_args->>'_room_type_requested',_special_requests=>_args->>'_special_requests',
    _internal_notes=>_args->>'_internal_notes');
  IF (result->>'ok')::boolean IS TRUE THEN
    PERFORM public.pms_save_ntak_booking_fields((_args->>'_reservation_id')::uuid,_fields);
  END IF;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.pms_ntak_booking_fields(text,text,uuid),public.pms_save_ntak_booking_fields(uuid,jsonb),public.pms_create_reservation_phase6(jsonb,jsonb),public.pms_update_reservation_phase6(jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.pms_ntak_booking_fields(text,text,uuid),public.pms_save_ntak_booking_fields(uuid,jsonb),public.pms_create_reservation_phase6(jsonb,jsonb),public.pms_update_reservation_phase6(jsonb,jsonb) TO authenticated;
