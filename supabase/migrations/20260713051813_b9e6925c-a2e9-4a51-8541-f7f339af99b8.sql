-- Reset stale is_checkout_room flags: any room currently flagged as checkout
-- but whose PMS metadata does not indicate departure today/tomorrow or a
-- confirmed checkout, and which has no manual override, is cleared. The next
-- PMS Refresh will set the correct value authoritatively.
UPDATE public.rooms
SET is_checkout_room = false
WHERE is_checkout_room = true
  AND COALESCE((pms_metadata->>'manual_checkout')::boolean, false) = false
  AND COALESCE((pms_metadata->>'scheduledDepartureToday')::boolean, false) = false
  AND COALESCE((pms_metadata->>'scheduledDepartureTomorrow')::boolean, false) = false
  AND COALESCE((pms_metadata->>'checkedOutToday')::boolean, false) = false;