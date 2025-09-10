-- Function to automatically mark checkout rooms as ready to clean when room status changes
CREATE OR REPLACE FUNCTION public.handle_room_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- When a room status changes from 'clean' to 'dirty' manually, 
  -- mark any assigned checkout room assignments as ready to clean
  IF OLD.status = 'clean' AND NEW.status = 'dirty' THEN
    UPDATE public.room_assignments 
    SET ready_to_clean = true, updated_at = now()
    WHERE room_id = NEW.id 
    AND assignment_type = 'checkout_cleaning'
    AND status IN ('assigned', 'in_progress')
    AND assignment_date = CURRENT_DATE
    AND ready_to_clean = false;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger to automatically update checkout assignments when room status changes
DROP TRIGGER IF EXISTS trigger_room_status_change ON public.rooms;
CREATE TRIGGER trigger_room_status_change
  AFTER UPDATE ON public.rooms
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_room_status_change();