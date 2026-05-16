ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS room_category text;
CREATE INDEX IF NOT EXISTS idx_rooms_hotel_category ON public.rooms(hotel, room_category);
CREATE INDEX IF NOT EXISTS idx_rooms_pms_metadata_roomid ON public.rooms ((pms_metadata->>'roomId')) WHERE pms_metadata IS NOT NULL;