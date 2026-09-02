-- Keep normalized PMS reservations on hotel_configurations.hotel_id even when
-- a legacy profile/client submits the human hotel_name.
CREATE OR REPLACE FUNCTION public.pms_reservations_before_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  canonical_hotel_id text;
BEGIN
  NEW.updated_at := now();

  IF NEW.hotel_id IS NOT NULL AND TRIM(NEW.hotel_id) <> '' THEN
    SELECT hc.hotel_id
      INTO canonical_hotel_id
    FROM public.hotel_configurations hc
    WHERE hc.hotel_id = NEW.hotel_id OR hc.hotel_name = NEW.hotel_id
    ORDER BY CASE WHEN hc.hotel_id = NEW.hotel_id THEN 0 ELSE 1 END
    LIMIT 1;

    IF canonical_hotel_id IS NOT NULL THEN
      NEW.hotel_id := canonical_hotel_id;
    END IF;
  END IF;

  IF NEW.check_in_date IS NOT NULL AND NEW.check_out_date IS NOT NULL THEN
    NEW.total_nights := GREATEST(1, NEW.check_out_date - NEW.check_in_date);
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.pms_reservations_before_write() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pms_reservations_before_write() TO service_role;
