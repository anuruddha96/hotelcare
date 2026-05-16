CREATE OR REPLACE FUNCTION public.handle_room_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  -- Generic room status changes must never auto-release checkout work.
  -- Checkout assignments are released only by explicit eligible-staff action,
  -- or by the dedicated Previo checkout poll for the test hotel.
  RETURN NEW;
END;
$$;

UPDATE public.room_assignments ra
SET ready_to_clean = false,
    updated_at = now()
FROM public.rooms r
WHERE ra.room_id = r.id
  AND ra.assignment_type = 'checkout_cleaning'
  AND ra.assignment_date = CURRENT_DATE
  AND ra.status IN ('assigned', 'in_progress')
  AND ra.ready_to_clean = true
  AND (
    COALESCE(r.is_checkout_room, false) = false
    OR r.hotel <> 'previo-test'
  );