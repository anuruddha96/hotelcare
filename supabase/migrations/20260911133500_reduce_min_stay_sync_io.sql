-- Avoid rewriting unchanged minimum-stay rules during every revenue sync.

CREATE OR REPLACE FUNCTION public.skip_noop_min_stay_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.hotel_id IS NOT DISTINCT FROM NEW.hotel_id
     AND OLD.organization_slug IS NOT DISTINCT FROM NEW.organization_slug
     AND OLD.stay_date IS NOT DISTINCT FROM NEW.stay_date
     AND OLD.min_nights IS NOT DISTINCT FROM NEW.min_nights
     AND OLD.notes IS NOT DISTINCT FROM NEW.notes
     AND OLD.updated_by IS NOT DISTINCT FROM NEW.updated_by
  THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_skip_noop_min_stay_update
ON public.min_stay_rules;
CREATE TRIGGER trg_skip_noop_min_stay_update
BEFORE UPDATE ON public.min_stay_rules
FOR EACH ROW
EXECUTE FUNCTION public.skip_noop_min_stay_update();

-- The unique constraint index already covers (hotel_id, stay_date).
DROP INDEX IF EXISTS public.idx_min_stay_hotel_date;
