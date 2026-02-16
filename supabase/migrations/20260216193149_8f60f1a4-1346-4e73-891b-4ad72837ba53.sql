
-- Add wing, room_category, and elevator_proximity columns to rooms table
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS wing text;
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS room_category text;
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS elevator_proximity integer;

-- Seed wing and elevator proximity data for Hotel Memories Budapest
-- Ground Floor (F0)
-- Wing A: 002-010 (near elevator)
UPDATE public.rooms SET wing = 'A', elevator_proximity = 1 
WHERE hotel = 'Hotel Memories Budapest' AND room_number IN ('002','004','006','008','010');

-- Wing B: 032-036 (near elevator)
UPDATE public.rooms SET wing = 'B', elevator_proximity = 1 
WHERE hotel = 'Hotel Memories Budapest' AND room_number IN ('032','034','036');

-- Wing C: 038-044
UPDATE public.rooms SET wing = 'C', elevator_proximity = 2 
WHERE hotel = 'Hotel Memories Budapest' AND room_number IN ('038','040','042','044');

-- 1st Floor (F1)
-- Wing D (Synagogue view): odd numbers 101-127
UPDATE public.rooms SET wing = 'D', elevator_proximity = 2 
WHERE hotel = 'Hotel Memories Budapest' AND room_number IN ('101','103','105','107','109','115','117','119','121','123','125','127');

-- Wing E (Courtyard inner): 102-114
UPDATE public.rooms SET wing = 'E', elevator_proximity = 1 
WHERE hotel = 'Hotel Memories Budapest' AND room_number IN ('102','104','106','108','110','111','112','113','114');

-- Wing F (Courtyard): 130-136
UPDATE public.rooms SET wing = 'F', elevator_proximity = 2 
WHERE hotel = 'Hotel Memories Budapest' AND room_number IN ('130','132','134','136');

-- Wing G (Courtyard): 138-144
UPDATE public.rooms SET wing = 'G', elevator_proximity = 3 
WHERE hotel = 'Hotel Memories Budapest' AND room_number IN ('138','140','142','144');

-- Wing H (Street view): odd numbers 131-147
UPDATE public.rooms SET wing = 'H', elevator_proximity = 2 
WHERE hotel = 'Hotel Memories Budapest' AND room_number IN ('131','133','135','137','139','141','143','145','147');

-- 2nd Floor (F2)
-- Wing I: 202-210
UPDATE public.rooms SET wing = 'I', elevator_proximity = 1 
WHERE hotel = 'Hotel Memories Budapest' AND room_number IN ('202','204','206','208','210');

-- Wing J (Synagogue): odd numbers 201-217
UPDATE public.rooms SET wing = 'J', elevator_proximity = 2 
WHERE hotel = 'Hotel Memories Budapest' AND room_number IN ('201','203','205','207','209','211','213','215','217');

-- Wing K (Courtyard): 212-216
UPDATE public.rooms SET wing = 'K', elevator_proximity = 2 
WHERE hotel = 'Hotel Memories Budapest' AND room_number IN ('212','214','216');

-- 3rd Floor (F3)
-- Wing L: 302-308
UPDATE public.rooms SET wing = 'L', elevator_proximity = 1 
WHERE hotel = 'Hotel Memories Budapest' AND room_number IN ('302','304','306','308');
