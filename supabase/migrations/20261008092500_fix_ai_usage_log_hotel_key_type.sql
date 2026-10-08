-- HotelCare incident 2026-10-08: remove repeated SQLSTATE 22P02 errors.
-- Frontend/Edge functions consistently use stable text hotel keys such as
-- "ottofiori" and "memories-budapest". Unlike public.hotels.id, most operational
-- hotel_id values are text. AI usage logging was the anomalous UUID column.
-- This tiny table has no foreign key on hotel_id; preserve historical UUIDs as
-- their textual representation and accept future hotel keys without aborting.
ALTER TABLE public.ai_usage_log
  ALTER COLUMN hotel_id TYPE text USING hotel_id::text;

COMMENT ON COLUMN public.ai_usage_log.hotel_id IS
  'Operational HotelCare hotel key (text slug or legacy UUID string), nullable for organisation-wide AI usage.';
