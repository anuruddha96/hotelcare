CREATE OR REPLACE FUNCTION public.clear_dnd_on_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF NEW.room_id IS NOT NULL THEN
    -- A first DND attempt is intentionally parked for a later retry. Mirror that
    -- state onto the room itself so manager/supervisor room boards still show
    -- DND after a refresh instead of falling back to the ordinary dirty colour.
    IF NEW.status = 'dnd_pending_retry'
       AND OLD.status IS DISTINCT FROM 'dnd_pending_retry' THEN
      UPDATE public.rooms
      SET
        is_dnd = true,
        dnd_marked_at = COALESCE(NEW.dnd_first_attempt_at, now()),
        dnd_marked_by = COALESCE(NEW.dnd_marked_by, NEW.assigned_to),
        updated_at = now()
      WHERE id = NEW.room_id;

    -- When the retry actually starts, the doorway DND has cleared. Remove the
    -- temporary first-attempt room flag so the board does not show stale DND
    -- while the housekeeper is cleaning.
    ELSIF OLD.status = 'dnd_pending_retry'
          AND NEW.status IN ('assigned', 'in_progress') THEN
      UPDATE public.rooms
      SET
        is_dnd = false,
        dnd_marked_at = NULL,
        dnd_marked_by = NULL,
        updated_at = now()
      WHERE id = NEW.room_id
        AND is_dnd = true;

    -- Preserve the existing cross-day cleanup behaviour for any other status
    -- transition: yesterday's DND must never leak into today's assignment.
    ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
      UPDATE public.rooms
      SET
        is_dnd = false,
        dnd_marked_at = NULL,
        dnd_marked_by = NULL,
        updated_at = now()
      WHERE id = NEW.room_id
        AND is_dnd = true
        AND DATE(dnd_marked_at) < CURRENT_DATE;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- Repair today's already-recorded first-attempt DND rooms at Hotel Memories
-- without touching unrelated room states.
UPDATE public.rooms AS r
SET
  is_dnd = true,
  dnd_marked_at = COALESCE(ra.dnd_first_attempt_at, now()),
  dnd_marked_by = COALESCE(ra.dnd_marked_by, ra.assigned_to),
  updated_at = now()
FROM public.room_assignments AS ra
WHERE ra.room_id = r.id
  AND ra.assignment_date = CURRENT_DATE
  AND ra.status = 'dnd_pending_retry'
  AND r.hotel = 'Hotel Memories Budapest'
  AND r.is_dnd IS DISTINCT FROM true;
