-- Add columns to track break periods within room assignments
ALTER TABLE public.room_assignments 
ADD COLUMN break_periods JSONB DEFAULT '[]'::jsonb,
ADD COLUMN total_break_time_minutes INTEGER DEFAULT 0;