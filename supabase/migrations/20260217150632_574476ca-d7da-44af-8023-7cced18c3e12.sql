
-- Add QR token to rooms for guest minibar scanning
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS minibar_qr_token uuid DEFAULT gen_random_uuid() UNIQUE;

-- Backfill existing rooms with tokens
UPDATE public.rooms SET minibar_qr_token = gen_random_uuid() WHERE minibar_qr_token IS NULL;

-- Add source column to track who recorded the minibar usage
ALTER TABLE public.room_minibar_usage ADD COLUMN IF NOT EXISTS source text DEFAULT 'staff';
