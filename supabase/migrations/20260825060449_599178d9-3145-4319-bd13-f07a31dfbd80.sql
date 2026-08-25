ALTER TABLE public.hotel_revenue_settings
  ADD COLUMN IF NOT EXISTS extra_guest_supplement_eur numeric NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS keep_day_shape boolean NOT NULL DEFAULT true;