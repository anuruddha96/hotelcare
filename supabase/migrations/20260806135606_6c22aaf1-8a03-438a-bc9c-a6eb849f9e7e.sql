ALTER TABLE public.revenue_booking_nights ADD COLUMN IF NOT EXISTS room_key text NOT NULL DEFAULT '';
ALTER TABLE public.revenue_booking_nights DROP CONSTRAINT IF EXISTS revenue_booking_nights_hotel_id_res_id_stay_date_key;
CREATE UNIQUE INDEX IF NOT EXISTS revenue_booking_nights_unique_room_night
  ON public.revenue_booking_nights (hotel_id, res_id, room_key, stay_date);

ALTER TABLE public.revenue_cancelled_nights
  ADD COLUMN IF NOT EXISTS room_key text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS obj_id text,
  ADD COLUMN IF NOT EXISTS status_id integer,
  ADD COLUMN IF NOT EXISTS created_at_pms timestamp with time zone,
  ADD COLUMN IF NOT EXISTS guests integer,
  ADD COLUMN IF NOT EXISTS total_price_eur numeric,
  ADD COLUMN IF NOT EXISTS stay_from date,
  ADD COLUMN IF NOT EXISTS stay_to date,
  ADD COLUMN IF NOT EXISTS source_name text;