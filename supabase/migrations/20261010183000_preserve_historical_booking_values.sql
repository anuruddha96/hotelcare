-- Protect historic reservation value when the rolling Previo live data drops old nights.
-- A reservation's earliest observed full size/value is kept once archived.
-- The scheduled importer may enrich an event with MORE recorded room-nights,
-- but it must never shrink it or revise unchanged-sized historic booking values.
CREATE OR REPLACE FUNCTION public.preserve_revenue_booking_activity_history()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.room_nights <= OLD.room_nights THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS preserve_revenue_booking_activity_history ON public.revenue_booking_activity_archive;
CREATE TRIGGER preserve_revenue_booking_activity_history
BEFORE UPDATE ON public.revenue_booking_activity_archive
FOR EACH ROW EXECUTE FUNCTION public.preserve_revenue_booking_activity_history();
