-- A closed/expired shared-room watch is historical evidence, not an active
-- inventory lock. Permit a NEW booking-protection cycle on the same date and
-- room-type pair after a fresh, authoritative Previo reservation/availability check.
--
-- The Edge Function already verifies physical capacity, live reservations,
-- other independent categories, and any active/needs-review watch before INSERT.
-- Preserve historical rows (including their original baselines and triggers)
-- rather than clearing/reopening them: that would hide an actual prior booking.
--
-- A partial unique index additionally prevents two simultaneous protection
-- watches for different pairs on the same property/date (defence in depth).
ALTER TABLE public.room_sale_overnight_watches
  DROP CONSTRAINT IF EXISTS room_sale_overnight_watches_hotel_id_stay_date_first_obk_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS room_sale_overnight_one_live_per_hotel_date
  ON public.room_sale_overnight_watches (hotel_id, stay_date)
  WHERE status IN ('active', 'triggered', 'needs_review');

COMMENT ON INDEX public.room_sale_overnight_one_live_per_hotel_date IS
  'Only one live or review-pending shared inventory protection watch per hotel/date; closed and expired cycles remain in the audit history and can be followed by a new separately baselined cycle.';
