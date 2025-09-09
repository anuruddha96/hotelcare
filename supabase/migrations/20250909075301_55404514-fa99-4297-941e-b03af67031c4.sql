-- Update staff_attendance table to support break tracking
ALTER TABLE public.staff_attendance 
ADD COLUMN break_type TEXT,
ADD COLUMN break_started_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN break_ended_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN break_duration_minutes INTEGER DEFAULT 0;

-- Update existing records to have break_duration_minutes instead of break_duration (in minutes)
UPDATE public.staff_attendance 
SET break_duration_minutes = COALESCE(break_duration, 0)
WHERE break_duration_minutes IS NULL;