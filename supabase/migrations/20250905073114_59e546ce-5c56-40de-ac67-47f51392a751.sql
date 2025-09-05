-- Fix assignment visibility for managers and add email notification trigger
-- Update RLS policy to allow managers to see their assigned rooms
DROP POLICY IF EXISTS "Housekeeping staff can view their assignments" ON public.room_assignments;

CREATE POLICY "Housekeeping staff can view their assignments" 
ON public.room_assignments 
FOR SELECT 
USING (
  (assigned_to = auth.uid()) OR 
  (get_user_role(auth.uid()) = ANY (ARRAY['housekeeping_manager'::user_role, 'manager'::user_role, 'admin'::user_role, 'housekeeping'::user_role])) OR 
  (assigned_by = auth.uid())
);

-- Create trigger for email notifications when room assignments are created
CREATE OR REPLACE FUNCTION notify_assignment_created() 
RETURNS TRIGGER AS $$
BEGIN
  -- Only send notification for newly created assignments
  IF TG_OP = 'INSERT' THEN
    -- Call edge function to send email notification
    PERFORM net.http_post(
      url := current_setting('app.supabase_url') || '/functions/v1/send-work-assignment-notification',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.service_role_key')
      ),
      body := jsonb_build_object(
        'staff_id', NEW.assigned_to,
        'assignment_type', 'room_assignment',
        'assignment_details', jsonb_build_object(
          'id', NEW.id,
          'room_number', (SELECT room_number FROM rooms WHERE id = NEW.room_id),
          'assignment_type', NEW.assignment_type
        ),
        'hotel_name', (SELECT hotel FROM rooms WHERE id = NEW.room_id)
      )
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for assignment notifications
DROP TRIGGER IF EXISTS trigger_assignment_notification ON public.room_assignments;
CREATE TRIGGER trigger_assignment_notification
  AFTER INSERT ON public.room_assignments
  FOR EACH ROW
  EXECUTE FUNCTION notify_assignment_created();