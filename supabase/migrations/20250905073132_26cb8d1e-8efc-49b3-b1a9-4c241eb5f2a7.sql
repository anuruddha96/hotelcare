-- Fix the search path security issue for the notification function
CREATE OR REPLACE FUNCTION notify_assignment_created() 
RETURNS TRIGGER 
LANGUAGE plpgsql 
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;