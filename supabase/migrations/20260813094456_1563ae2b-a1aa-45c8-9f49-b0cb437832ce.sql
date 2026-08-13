ALTER TABLE public.hotel_revenue_settings
  ADD COLUMN IF NOT EXISTS target_adr numeric,
  ADD COLUMN IF NOT EXISTS target_room_nights numeric,
  ADD COLUMN IF NOT EXISTS target_booking_value numeric,
  ADD COLUMN IF NOT EXISTS promo_budget numeric;