
ALTER TABLE public.revenue_booking_nights
  ADD COLUMN IF NOT EXISTS source_currency text,
  ADD COLUMN IF NOT EXISTS original_nightly_price numeric,
  ADD COLUMN IF NOT EXISTS original_total_price numeric;

ALTER TABLE public.revenue_cancelled_nights
  ADD COLUMN IF NOT EXISTS source_currency text,
  ADD COLUMN IF NOT EXISTS original_nightly_price numeric,
  ADD COLUMN IF NOT EXISTS original_total_price numeric;
