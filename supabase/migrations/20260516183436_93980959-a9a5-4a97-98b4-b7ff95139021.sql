CREATE OR REPLACE FUNCTION public.handle_room_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  -- Only auto-release checkout assignments when the room is a TRUE checkout
  -- room (is_checkout_room = true). This flag is set only by the Previo
  -- checkout poll when a guest has actually departed today, or by a
  -- supervisor manually. A mere clean -> dirty status change (e.g. PMS
  -- mirroring "Untidy" mid-stay) must NOT release the assignment.
  IF OLD.status = 'clean' AND NEW.status = 'dirty' AND NEW.is_checkout_room = true THEN
    UPDATE public.room_assignments
    SET ready_to_clean = true, updated_at = now()
    WHERE room_id = NEW.id
      AND assignment_type = 'checkout_cleaning'
      AND status IN ('assigned', 'in_progress')
      AND assignment_date = CURRENT_DATE
      AND ready_to_clean = false;
  END IF;

  RETURN NEW;
END;
$function$;

-- Re-block any checkout assignments that were prematurely released today
-- for rooms that aren't actually flagged as checkout rooms.
UPDATE public.room_assignments ra
SET ready_to_clean = false, updated_at = now()
FROM public.rooms r
WHERE ra.room_id = r.id
  AND ra.assignment_type = 'checkout_cleaning'
  AND ra.assignment_date = CURRENT_DATE
  AND ra.status IN ('assigned', 'in_progress')
  AND ra.ready_to_clean = true
  AND COALESCE(r.is_checkout_room, false) = false;