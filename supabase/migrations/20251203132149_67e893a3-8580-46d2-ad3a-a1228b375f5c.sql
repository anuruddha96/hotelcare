-- Add request_reason and pending_rooms_info columns to early_signout_requests
ALTER TABLE public.early_signout_requests 
ADD COLUMN IF NOT EXISTS request_reason text,
ADD COLUMN IF NOT EXISTS pending_rooms_info jsonb DEFAULT '[]'::jsonb;