-- Fix: reservation numbers stop working after 9,999 new bookings in one day.
--
-- generate_reservation_number() padded the daily counter with LPAD(seq, 4, '0').
-- PostgreSQL's lpad() TRUNCATES longer strings, so seq 10000 became '1000',
-- which already exists -> unique violation (23505) on reservation_number and
-- every new reservation fails for the rest of the day. Hit on 2026-11-13 by the
-- first full Previo imports (about 9,900 new bookings in one day).
--
-- Same format as before up to 9,999 (RES-YYYYMMDD-0001); from 10,000 the
-- counter simply grows (RES-YYYYMMDD-10000). The MAX() lookup already parses
-- any number of trailing digits.
CREATE OR REPLACE FUNCTION public.generate_reservation_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  seq_num integer;
BEGIN
  SELECT COALESCE(MAX(
    CAST(NULLIF(SUBSTRING(reservation_number FROM '[0-9]+$'), '') AS integer)
  ), 0) + 1
  INTO seq_num
  FROM reservations
  WHERE reservation_number LIKE 'RES-' || to_char(CURRENT_DATE, 'YYYYMMDD') || '-%';

  NEW.reservation_number := 'RES-' || to_char(CURRENT_DATE, 'YYYYMMDD') || '-'
    || CASE WHEN seq_num < 10000 THEN LPAD(seq_num::text, 4, '0') ELSE seq_num::text END;
  NEW.total_nights := NEW.check_out_date - NEW.check_in_date;
  RETURN NEW;
END;
$function$;
