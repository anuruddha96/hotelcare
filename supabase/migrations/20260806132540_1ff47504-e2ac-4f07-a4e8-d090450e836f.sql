ALTER TABLE public.revenue_booking_nights
  ADD COLUMN IF NOT EXISTS source_name text,
  ADD COLUMN IF NOT EXISTS total_price_eur numeric,
  ADD COLUMN IF NOT EXISTS stay_from date,
  ADD COLUMN IF NOT EXISTS stay_to date;

CREATE INDEX IF NOT EXISTS revenue_booking_nights_created_idx
  ON public.revenue_booking_nights (hotel_id, created_at_pms);