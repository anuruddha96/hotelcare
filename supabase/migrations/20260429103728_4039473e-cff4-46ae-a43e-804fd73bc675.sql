-- Trigger: ensure all 5 mandatory photo categories are present before a daily cleaning can be completed
CREATE OR REPLACE FUNCTION public.enforce_daily_cleaning_photos()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  required_cats TEXT[] := ARRAY['trash_bin','bathroom','bed','minibar','tea_coffee_table'];
  cat TEXT;
  found BOOLEAN;
  photo TEXT;
  filename TEXT;
BEGIN
  -- Only enforce when transitioning to completed for a daily_cleaning, and not DND / no_service
  IF NEW.status = 'completed'
     AND NEW.assignment_type = 'daily_cleaning'
     AND COALESCE(NEW.is_dnd, false) = false
     AND (NEW.notes IS NULL OR NEW.notes NOT LIKE '%[NO_SERVICE]%')
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status)
  THEN
    IF NEW.completion_photos IS NULL OR array_length(NEW.completion_photos, 1) IS NULL THEN
      RAISE EXCEPTION 'Cannot complete daily cleaning: all 5 required photos missing (trash_bin, bathroom, bed, minibar, tea_coffee_table)'
        USING ERRCODE = 'check_violation';
    END IF;

    FOREACH cat IN ARRAY required_cats LOOP
      found := false;
      FOREACH photo IN ARRAY NEW.completion_photos LOOP
        -- filename portion after last '/'
        filename := split_part(photo, '/', array_length(string_to_array(photo, '/'), 1));
        IF filename LIKE cat || '\_%' ESCAPE '\' OR filename LIKE cat || '_%' THEN
          found := true;
          EXIT;
        END IF;
      END LOOP;

      IF NOT found THEN
        RAISE EXCEPTION 'Cannot complete daily cleaning: missing required photo for category "%"', cat
          USING ERRCODE = 'check_violation';
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_daily_cleaning_photos ON public.room_assignments;
CREATE TRIGGER trg_enforce_daily_cleaning_photos
  BEFORE INSERT OR UPDATE ON public.room_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_daily_cleaning_photos();