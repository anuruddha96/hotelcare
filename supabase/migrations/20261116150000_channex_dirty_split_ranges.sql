-- Channex live test: moving a reservation must publish availability for the
-- OLD nights and the NEW nights only — never the untouched days in between.
-- The dirty trigger previously marked one union range (LEAST(check_in) ..
-- GREATEST(check_out)-1); a booking moved a week later therefore republished
-- the whole span. Now each affected stay window gets its own dirty row,
-- scoped to its own room type (a move between room types publishes the old
-- window for the old type and the new window for the new type, instead of
-- falling back to all types).

CREATE OR REPLACE FUNCTION public.channex_mark_availability_dirty()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_hotel text := COALESCE(NEW.hotel_id, OLD.hotel_id);
  v_today date := (now() AT TIME ZONE 'Europe/Budapest')::date;
  v_type_new uuid;
  v_type_old uuid;
  v_new_from date;
  v_new_to date;
  v_old_from date;
  v_old_to date;
  v_old_written boolean := false;
BEGIN
  IF v_hotel IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.channex_connections c WHERE c.hotel_id = v_hotel AND c.mode <> 'off'
  ) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.check_in_date IS NOT DISTINCT FROM OLD.check_in_date
     AND NEW.check_out_date IS NOT DISTINCT FROM OLD.check_out_date
     AND NEW.room_id IS NOT DISTINCT FROM OLD.room_id
     AND NEW.room_type_requested IS NOT DISTINCT FROM OLD.room_type_requested THEN
    RETURN NEW;
  END IF;

  -- Resolve room types (NULL still means "all types" as a safe fallback).
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    v_type_new := COALESCE(NEW.room_type_id,
      (SELECT rt.id FROM public.rooms ro JOIN public.room_types rt
         ON rt.hotel_id = v_hotel AND rt.name = ro.room_type
        WHERE ro.id = NEW.room_id LIMIT 1),
      (SELECT rt.id FROM public.room_types rt
        WHERE rt.hotel_id = v_hotel AND rt.name = NEW.room_type_requested LIMIT 1));
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    v_type_old := COALESCE(OLD.room_type_id,
      (SELECT rt.id FROM public.rooms ro JOIN public.room_types rt
         ON rt.hotel_id = v_hotel AND rt.name = ro.room_type
        WHERE ro.id = OLD.room_id LIMIT 1),
      (SELECT rt.id FROM public.room_types rt
        WHERE rt.hotel_id = v_hotel AND rt.name = OLD.room_type_requested LIMIT 1));
  END IF;

  -- OLD stay window (UPDATE frees/changes it, DELETE frees it).
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.check_in_date IS NOT NULL AND OLD.check_out_date IS NOT NULL THEN
    v_old_from := OLD.check_in_date;
    v_old_to := OLD.check_out_date - 1;
    IF v_old_to < v_old_from THEN v_old_to := v_old_from; END IF;
    v_old_from := GREATEST(v_old_from, v_today);
    IF v_old_to >= v_old_from THEN
      INSERT INTO public.channex_availability_dirty (hotel_id, room_type_id, date_from, date_to, reason)
      VALUES (v_hotel, v_type_old, v_old_from, v_old_to, 'reservation_' || lower(TG_OP));
      v_old_written := true;
    END IF;
  END IF;

  -- NEW stay window (INSERT occupies it, UPDATE occupies/changes it).
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.check_in_date IS NOT NULL AND NEW.check_out_date IS NOT NULL THEN
    v_new_from := NEW.check_in_date;
    v_new_to := NEW.check_out_date - 1;
    IF v_new_to < v_new_from THEN v_new_to := v_new_from; END IF;
    v_new_from := GREATEST(v_new_from, v_today);
    IF v_new_to >= v_new_from
       AND NOT (v_old_written
                AND v_new_from = v_old_from AND v_new_to = v_old_to
                AND v_type_new IS NOT DISTINCT FROM v_type_old) THEN
      INSERT INTO public.channex_availability_dirty (hotel_id, room_type_id, date_from, date_to, reason)
      VALUES (v_hotel, v_type_new, v_new_from, v_new_to, 'reservation_' || lower(TG_OP));
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$;
