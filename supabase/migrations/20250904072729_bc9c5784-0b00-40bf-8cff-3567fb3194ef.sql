-- Add checkout information to rooms table
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS checkout_time timestamp with time zone;
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS is_checkout_room boolean DEFAULT false;
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS guest_count integer DEFAULT 0;