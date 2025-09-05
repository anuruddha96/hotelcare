-- Remove failing notification trigger that calls pg_net (schema "net")
-- Inserts already trigger client-side Edge Function invocations; this DB trigger is redundant and breaks inserts when pg_net isn't installed

-- Safely drop trigger and function
DROP TRIGGER IF EXISTS trigger_assignment_notification ON public.room_assignments;
DROP FUNCTION IF EXISTS notify_assignment_created();

-- No other changes