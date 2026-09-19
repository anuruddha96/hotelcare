-- Keep server-side photo validation consistent with src/lib/gozsduNoMinibar.ts.
-- Gozsdu Court has no minibar operations: require four daily-cleaning photos
-- there, and retain all five required photos at every other property.
CREATE OR REPLACE FUNCTION public.enforce_daily_cleaning_photos()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  required_cats text[] := ARRAY['trash_bin', 'bathroom', 'bed', 'minibar', 'tea_coffee_table'];
  cat text;
  photo text;
  filename text;
  found boolean;
  is_gozsdu boolean := false;
BEGIN
  IF NEW.status = 'completed'
     AND NEW.assignment_type = 'daily_cleaning'
     AND COALESCE(NEW.is_dnd, false) = false
     AND (NEW.notes IS NULL OR NEW.notes NOT LIKE '%[NO_SERVICE]%')
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status)
  THEN
    -- Determine the policy from the persisted room, never a client-provided flag.
    SELECT r.organization_slug = 'rdhotels'
           AND lower(trim(r.hotel)) IN ('gozsdu-court', 'gozsdu court budapest')
      INTO is_gozsdu
      FROM public.rooms AS r
     WHERE r.id = NEW.room_id;

    IF COALESCE(is_gozsdu, false) THEN
      required_cats := ARRAY['trash_bin', 'bathroom', 'bed', 'tea_coffee_table'];
    END IF;

    IF NEW.completion_photos IS NULL OR cardinality(NEW.completion_photos) = 0 THEN
      RAISE EXCEPTION 'Cannot complete daily cleaning: required photos missing (%)', array_to_string(required_cats, ', ')
        USING ERRCODE = 'check_violation';
    END IF;

    FOREACH cat IN ARRAY required_cats LOOP
      found := false;
      FOREACH photo IN ARRAY NEW.completion_photos LOOP
        filename := split_part(photo, '/', array_length(string_to_array(photo, '/'), 1));
        IF left(filename, length(cat) + 1) = cat || '_' THEN
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
$function$;
