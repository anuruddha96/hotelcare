ALTER TABLE public.revenue_cancelled_nights DROP CONSTRAINT IF EXISTS revenue_cancelled_nights_hotel_id_res_id_obk_id_stay_date_key;
CREATE UNIQUE INDEX IF NOT EXISTS revenue_cancelled_nights_unique_room_night
  ON public.revenue_cancelled_nights (hotel_id, res_id, room_key, stay_date);