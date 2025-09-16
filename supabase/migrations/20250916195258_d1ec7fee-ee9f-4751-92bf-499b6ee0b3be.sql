-- Add function to automatically clear DND status when room assignment is updated next day
CREATE OR REPLACE FUNCTION public.clear_dnd_on_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  -- Clear DND status when room assignment status changes and it's the next day or later
  IF NEW.status != OLD.status AND NEW.room_id IS NOT NULL THEN
    -- Check if there's a DND room that should be cleared
    UPDATE public.rooms 
    SET 
      is_dnd = false,
      dnd_marked_at = NULL,
      dnd_marked_by = NULL,
      updated_at = now()
    WHERE id = NEW.room_id 
      AND is_dnd = true 
      AND DATE(dnd_marked_at) < CURRENT_DATE;
  END IF;
  
  RETURN NEW;
END;
$function$;

-- Create trigger for clearing DND status
DROP TRIGGER IF EXISTS clear_dnd_on_assignment_update ON public.room_assignments;
CREATE TRIGGER clear_dnd_on_assignment_update
  BEFORE UPDATE ON public.room_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.clear_dnd_on_status_change();

-- Create function to update room assignment type (for managers/admins to change daily to checkout)
CREATE OR REPLACE FUNCTION public.update_assignment_type(
  assignment_id uuid,
  new_assignment_type assignment_type
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  user_role public.user_role;
  result json;
BEGIN
  -- Get current user role
  SELECT role INTO user_role FROM public.profiles WHERE id = auth.uid();
  
  -- Only allow managers and admins
  IF user_role NOT IN ('admin', 'manager', 'housekeeping_manager') THEN
    RAISE EXCEPTION 'Only managers and admins can update assignment types';
  END IF;
  
  -- Update the assignment type
  UPDATE public.room_assignments 
  SET 
    assignment_type = new_assignment_type,
    updated_at = now()
  WHERE id = assignment_id;
  
  -- Return success
  result := json_build_object(
    'success', true,
    'message', 'Assignment type updated successfully'
  );
  
  RETURN result;
EXCEPTION
  WHEN OTHERS THEN
    result := json_build_object(
      'success', false,
      'error', SQLERRM
    );
    RETURN result;
END;
$function$;

-- Fix hotel filtering by ensuring hotel field mapping works correctly
-- Update the get_hotel_name_from_id function to handle both directions
CREATE OR REPLACE FUNCTION public.get_hotel_id_from_name(hotel_name text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO ''
AS $function$
  SELECT CASE 
    WHEN hotel_name = 'Hotel Memories Budapest' THEN 'memories-budapest'
    WHEN hotel_name = 'Hotel Mika Downtown' THEN 'mika-downtown'
    WHEN hotel_name = 'Hotel Ottofiori' THEN 'ottofiori'
    WHEN hotel_name = 'Gozsdu Court Budapest' THEN 'gozsdu-court'
    ELSE hotel_name
  END;
$function$;