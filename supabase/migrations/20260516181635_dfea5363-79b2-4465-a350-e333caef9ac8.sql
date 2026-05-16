-- One-time cleanup: clear stale is_checkout_room flags on rooms that have
-- no actual departure in today's PMS data. Only keeps rooms 201, 203, 301
-- which are the real Previo checkouts for the previo-test hotel today.
UPDATE public.rooms
SET is_checkout_room = false,
    checkout_time = NULL,
    updated_at = now()
WHERE hotel = 'previo-test'
  AND is_checkout_room = true
  AND room_number NOT IN ('201', '203', '301');
