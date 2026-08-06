UPDATE public.revenue_booking_nights SET room_key = COALESCE(room_key, obj_id, obk_id, 'room') WHERE room_key IS NULL;
UPDATE public.revenue_cancelled_nights SET room_key = COALESCE(room_key, obj_id, obk_id, 'room') WHERE room_key IS NULL;

ALTER TABLE public.revenue_booking_nights ALTER COLUMN room_key SET DEFAULT 'room';
ALTER TABLE public.revenue_booking_nights ALTER COLUMN room_key SET NOT NULL;
ALTER TABLE public.revenue_cancelled_nights ALTER COLUMN room_key SET DEFAULT 'room';
ALTER TABLE public.revenue_cancelled_nights ALTER COLUMN room_key SET NOT NULL;

DROP INDEX IF EXISTS public.revenue_booking_nights_unique_room_night;
DROP INDEX IF EXISTS public.revenue_cancelled_nights_unique_room_night;

ALTER TABLE public.revenue_booking_nights
  ADD CONSTRAINT revenue_booking_nights_room_night_key UNIQUE (hotel_id, res_id, room_key, stay_date);
ALTER TABLE public.revenue_cancelled_nights
  ADD CONSTRAINT revenue_cancelled_nights_room_night_key UNIQUE (hotel_id, res_id, room_key, stay_date);