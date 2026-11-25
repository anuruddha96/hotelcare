-- Preserve the upstream booking timestamp separately from the time HotelCare received it.
-- A null first_seen_at means no staff device has opened or acknowledged the booking.
ALTER TABLE public.restaurant_reservations
  ADD COLUMN IF NOT EXISTS booked_at timestamptz,
  ADD COLUMN IF NOT EXISTS first_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS first_seen_by uuid;

-- Do not turn months of existing imported bookings into a flood of NEW alerts.
UPDATE public.restaurant_reservations
SET first_seen_at = created_at
WHERE first_seen_at IS NULL AND created_at < now();

CREATE INDEX IF NOT EXISTS idx_restaurant_reservations_unseen
ON public.restaurant_reservations (hotel_id, service_date)
WHERE first_seen_at IS NULL;

COMMENT ON COLUMN public.restaurant_reservations.booked_at
IS 'Original time the guest made the booking, if provided by the source; do not confuse with created_at (HotelCare receipt).';
COMMENT ON COLUMN public.restaurant_reservations.first_seen_at
IS 'First time any BB staff device explicitly opened this reservation; shared across devices.';
