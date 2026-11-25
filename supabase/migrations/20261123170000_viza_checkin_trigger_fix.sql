-- VIZA: check-in failed for every hotel with VIZA reporting switched on.
--
-- The queueing trigger compared the reservation status with
-- COALESCE(OLD.status, ''). status is an enum, so Postgres tried to read ''
-- as a status and raised "invalid input value for enum reservation_status",
-- which rolled back the check-in (and the check-out) itself.
-- Found while preparing the VIZA validation; no live hotel had VIZA enabled yet.
--
-- IS DISTINCT FROM compares safely, including a missing old status.

CREATE OR REPLACE FUNCTION public.viza_on_reservation_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cfg public.viza_settings%ROWTYPE;
BEGIN
  SELECT * INTO cfg FROM public.viza_settings
   WHERE hotel_id = NEW.hotel_id AND enabled = true
     AND adatszolgaltatasi_azonosito IS NOT NULL;
  IF NOT FOUND THEN RETURN NEW; END IF;

  IF NEW.status = 'checked_in' AND OLD.status IS DISTINCT FROM 'checked_in' THEN
    INSERT INTO public.viza_guest_events
      (hotel_id, organization_slug, reservation_id, guest_id, erkezes_ideje, tavozas_varhato_datuma)
    VALUES
      (NEW.hotel_id, cfg.organization_slug, NEW.id, NEW.guest_id, now(), NEW.check_out_date)
    ON CONFLICT (reservation_id, COALESCE(guest_id, '00000000-0000-0000-0000-000000000000'::uuid))
    DO NOTHING;
  ELSIF NEW.status = 'checked_out' AND OLD.status IS DISTINCT FROM 'checked_out' THEN
    UPDATE public.viza_guest_events
       SET tavozas_ideje = now(),
           departure_state = CASE WHEN arrival_state = 'sent' THEN 'queued' ELSE departure_state END,
           updated_at = now()
     WHERE reservation_id = NEW.id AND tavozas_ideje IS NULL;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.viza_on_reservation_status() FROM PUBLIC, anon, authenticated;
