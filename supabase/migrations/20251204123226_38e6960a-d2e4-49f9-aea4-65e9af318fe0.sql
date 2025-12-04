-- Add room_size_sqm and room_capacity columns to rooms table
ALTER TABLE public.rooms 
ADD COLUMN IF NOT EXISTS room_size_sqm integer,
ADD COLUMN IF NOT EXISTS room_capacity integer DEFAULT 2;

-- Update Hotel Ottofiori rooms with correct sizes and capacities
-- Floor 1
UPDATE public.rooms SET room_size_sqm = 16, room_capacity = 2 WHERE room_number = '101' AND hotel = 'Hotel Ottofiori';
UPDATE public.rooms SET room_size_sqm = 20, room_capacity = 2 WHERE room_number = '102' AND hotel = 'Hotel Ottofiori';
UPDATE public.rooms SET room_size_sqm = 20, room_capacity = 2 WHERE room_number = '103' AND hotel = 'Hotel Ottofiori';
UPDATE public.rooms SET room_size_sqm = 24, room_capacity = 3 WHERE room_number = '104' AND hotel = 'Hotel Ottofiori';
UPDATE public.rooms SET room_size_sqm = 24, room_capacity = 3 WHERE room_number = '105' AND hotel = 'Hotel Ottofiori';

-- Floor 2
UPDATE public.rooms SET room_size_sqm = 16, room_capacity = 2 WHERE room_number = '201' AND hotel = 'Hotel Ottofiori';
UPDATE public.rooms SET room_size_sqm = 20, room_capacity = 2 WHERE room_number = '202' AND hotel = 'Hotel Ottofiori';
UPDATE public.rooms SET room_size_sqm = 20, room_capacity = 2 WHERE room_number = '203' AND hotel = 'Hotel Ottofiori';
UPDATE public.rooms SET room_size_sqm = 24, room_capacity = 3 WHERE room_number = '204' AND hotel = 'Hotel Ottofiori';
UPDATE public.rooms SET room_size_sqm = 24, room_capacity = 3 WHERE room_number = '205' AND hotel = 'Hotel Ottofiori';

-- Floor 3
UPDATE public.rooms SET room_size_sqm = 16, room_capacity = 2 WHERE room_number = '301' AND hotel = 'Hotel Ottofiori';
UPDATE public.rooms SET room_size_sqm = 20, room_capacity = 2 WHERE room_number = '302' AND hotel = 'Hotel Ottofiori';
UPDATE public.rooms SET room_size_sqm = 20, room_capacity = 2 WHERE room_number = '303' AND hotel = 'Hotel Ottofiori';
UPDATE public.rooms SET room_size_sqm = 24, room_capacity = 2 WHERE room_number = '304' AND hotel = 'Hotel Ottofiori';
UPDATE public.rooms SET room_size_sqm = 24, room_capacity = 2 WHERE room_number = '305' AND hotel = 'Hotel Ottofiori';

-- Floor 4
UPDATE public.rooms SET room_size_sqm = 16, room_capacity = 2 WHERE room_number = '401' AND hotel = 'Hotel Ottofiori';
UPDATE public.rooms SET room_size_sqm = 30, room_capacity = 2 WHERE room_number = '402' AND hotel = 'Hotel Ottofiori';
UPDATE public.rooms SET room_size_sqm = 20, room_capacity = 2 WHERE room_number = '403' AND hotel = 'Hotel Ottofiori';
UPDATE public.rooms SET room_size_sqm = 22, room_capacity = 2 WHERE room_number = '404' AND hotel = 'Hotel Ottofiori';
UPDATE public.rooms SET room_size_sqm = 20, room_capacity = 2 WHERE room_number = '405' AND hotel = 'Hotel Ottofiori';
UPDATE public.rooms SET room_size_sqm = 45, room_capacity = 4 WHERE room_number = '406' AND hotel = 'Hotel Ottofiori';