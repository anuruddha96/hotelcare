-- Day-use bookings ("nappali használat"): arrival and departure on the same day.
-- Check-in, check-out, room change, conflicts and the NTAK daily closing already
-- treat check_in_date = check_out_date as a day-use stay (20261123185000), but
-- creating or editing such a booking was refused with INVALID_DATES.
-- Only the date check changes (<= becomes <); the rest of both functions stays
-- exactly as deployed. A day-use booking is charged as one day (nights := 1).
DO $$
DECLARE
  d text;
BEGIN
  d := pg_get_functiondef('public.pms_create_reservation(text,uuid,date,date,integer,integer,uuid,text,numeric,text,text,text,text,text)'::regprocedure);
  IF position('_check_out <= _check_in' IN d) > 0 THEN
    EXECUTE replace(d, '_check_out <= _check_in', '_check_out < _check_in');
  END IF;

  d := pg_get_functiondef('public.pms_update_reservation(uuid,date,date,integer,integer,uuid,boolean,numeric,text,text,text,text)'::regprocedure);
  IF position('IF eff_out <= eff_in THEN' IN d) > 0 THEN
    EXECUTE replace(d, 'IF eff_out <= eff_in THEN', 'IF eff_out < eff_in THEN');
  END IF;
END
$$;
