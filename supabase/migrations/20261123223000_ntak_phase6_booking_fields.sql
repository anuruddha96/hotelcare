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
