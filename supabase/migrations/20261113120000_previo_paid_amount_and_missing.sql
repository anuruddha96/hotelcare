-- Reception: Previo paid amounts and bookings Previo no longer returns. Additive.
--   pms_paid_amount   paid amount Previo reports for the booking (REST account), single-room bookings only.
--   pms_missing_since set by a complete full import when Previo no longer returns a stored live booking
--                     (cancelled/deleted, or stored under an older room reference). The booking is hidden
--                     from the reception plan, never deleted, and cleared when Previo returns it again.
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS pms_paid_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS pms_missing_since timestamptz;

CREATE INDEX IF NOT EXISTS reservations_pms_missing_idx
  ON public.reservations (hotel_id)
  WHERE pms_missing_since IS NOT NULL;

COMMENT ON COLUMN public.reservations.pms_missing_since IS
  'Set when a complete Previo import no longer returns this live booking. Hidden from the reception plan; cleared automatically if Previo returns it again.';
