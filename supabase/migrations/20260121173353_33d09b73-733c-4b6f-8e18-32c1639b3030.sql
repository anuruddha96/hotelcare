-- Add banner_permanently_hidden column to notification_preferences
ALTER TABLE public.notification_preferences 
ADD COLUMN IF NOT EXISTS banner_permanently_hidden BOOLEAN DEFAULT false;