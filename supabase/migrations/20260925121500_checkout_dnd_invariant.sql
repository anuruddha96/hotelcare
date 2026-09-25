-- DND is a same-day stayover/daily-cleaning state.
-- Checkout cleaning must never carry or accept DND, regardless of property.
-- Historical snapshots and dnd_photos are intentionally preserved.

CREATE OR REPLACE FUNCTION public.hc_forbid_checkout_room_dnd()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF NEW.is_checkout_room IS TRUE THEN
    NEW.is_dnd := false;
    NEW.dnd_marked_at := NULL;
    NEW.dnd_marked_by := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS zzzzzzzzzzzzzz_hc_forbid_checkout_room_dnd ON public.rooms;
CREATE TRIGGER zzzzzzzzzzzzzz_hc_forbid_checkout_room_dnd
BEFORE INSERT OR UPDATE ON public.rooms
FOR EACH ROW
WHEN (NEW.is_checkout_room IS TRUE)
EXECUTE FUNCTION public.hc_forbid_checkout_room_dnd();

CREATE OR REPLACE FUNCTION public.hc_forbid_checkout_assignment_dnd()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  budapest_today date := (timezone('Europe/Budapest', now()))::date;
BEGIN
  IF NEW.assignment_date = budapest_today
     AND NEW.assignment_type::text = 'checkout_cleaning' THEN
    NEW.is_dnd := false;
    NEW.dnd_marked_at := NULL;
    NEW.dnd_marked_by := NULL;
    NEW.dnd_attempt_count := 0;
    NEW.dnd_first_attempt_at := NULL;
    NEW.dnd_retry_unlocked_at := NULL;

    -- A room that changes from stayover to checkout (for example an early
    -- departure) must leave the DND retry queue and return to normal checkout
    -- work without changing the selected housekeeper.
    IF NEW.status::text = 'dnd_pending_retry' THEN
      NEW.status := 'assigned';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS zzzzzzzzzzzzzz_hc_forbid_checkout_assignment_dnd ON public.room_assignments;
CREATE TRIGGER zzzzzzzzzzzzzz_hc_forbid_checkout_assignment_dnd
BEFORE INSERT OR UPDATE ON public.room_assignments
FOR EACH ROW
EXECUTE FUNCTION public.hc_forbid_checkout_assignment_dnd();

-- Repair only the live/current operational state. Historical DND evidence stays
-- in housekeeping_room_snapshots and dnd_photos.
UPDATE public.rooms
SET is_dnd = false,
    dnd_marked_at = NULL,
    dnd_marked_by = NULL,
    updated_at = now()
WHERE is_checkout_room IS TRUE
  AND is_dnd IS TRUE;

UPDATE public.room_assignments
SET is_dnd = false,
    dnd_marked_at = NULL,
    dnd_marked_by = NULL,
    dnd_attempt_count = 0,
    dnd_first_attempt_at = NULL,
    dnd_retry_unlocked_at = NULL,
    status = CASE
      WHEN status::text = 'dnd_pending_retry' THEN 'assigned'::public.assignment_status
      ELSE status
    END,
    updated_at = now()
WHERE assignment_date = (timezone('Europe/Budapest', now()))::date
  AND assignment_type::text = 'checkout_cleaning'
  AND (
    is_dnd IS TRUE
    OR status::text = 'dnd_pending_retry'
    OR COALESCE(dnd_attempt_count, 0) > 0
    OR dnd_marked_at IS NOT NULL
    OR dnd_first_attempt_at IS NOT NULL
    OR dnd_retry_unlocked_at IS NOT NULL
  );
