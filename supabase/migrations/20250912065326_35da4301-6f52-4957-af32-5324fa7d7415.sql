-- Add towel and linen change requirements to rooms table
ALTER TABLE public.rooms 
ADD COLUMN guest_nights_stayed integer DEFAULT 0,
ADD COLUMN towel_change_required boolean DEFAULT false,
ADD COLUMN linen_change_required boolean DEFAULT false,
ADD COLUMN last_towel_change date,
ADD COLUMN last_linen_change date;