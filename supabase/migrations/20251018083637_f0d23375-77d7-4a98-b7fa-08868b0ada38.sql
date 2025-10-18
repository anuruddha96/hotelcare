-- Add logo_scale_auth column to hotel_configurations table
ALTER TABLE public.hotel_configurations 
ADD COLUMN IF NOT EXISTS logo_scale_auth numeric DEFAULT 9;