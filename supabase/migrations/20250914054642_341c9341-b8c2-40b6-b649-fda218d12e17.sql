-- Fix attendance RLS to allow all authorized roles to see all records
DROP POLICY IF EXISTS "Enhanced admin and HR access to attendance" ON public.staff_attendance;

CREATE POLICY "Enhanced admin and HR access to attendance"
ON public.staff_attendance
FOR SELECT
TO authenticated
USING (
  (user_id = auth.uid()) OR 
  (get_user_role(auth.uid()) = ANY (ARRAY['admin'::user_role, 'hr'::user_role, 'manager'::user_role, 'housekeeping_manager'::user_role, 'top_management'::user_role]))
);

-- Fix DND room status update trigger
CREATE OR REPLACE FUNCTION public.update_dnd_room_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- When assignment is marked as completed and it's for a DND room, clear DND status
  IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
    UPDATE public.rooms 
    SET 
      is_dnd = false,
      dnd_marked_at = NULL,
      dnd_marked_by = NULL,
      updated_at = now()
    WHERE id = NEW.room_id AND is_dnd = true;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger for DND status updates
DROP TRIGGER IF EXISTS update_dnd_status_on_completion ON public.room_assignments;
CREATE TRIGGER update_dnd_status_on_completion
  AFTER UPDATE ON public.room_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.update_dnd_room_status();

-- Fix the towel/linen change notifications by creating function to check requirements
CREATE OR REPLACE FUNCTION public.check_towel_linen_requirements()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  guest_checkout_date date;
  days_since_towel_change integer;
  days_since_linen_change integer;
BEGIN
  -- When room assignment is completed, check towel/linen requirements
  IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
    
    -- Get guest checkout date if it's a checkout room
    SELECT checkout_time::date INTO guest_checkout_date
    FROM public.rooms 
    WHERE id = NEW.room_id AND is_checkout_room = true;
    
    -- Calculate days since last changes
    SELECT 
      COALESCE(CURRENT_DATE - last_towel_change, 999),
      COALESCE(CURRENT_DATE - last_linen_change, 999)
    INTO days_since_towel_change, days_since_linen_change
    FROM public.rooms 
    WHERE id = NEW.room_id;
    
    -- Update requirements based on stay duration or time since last change
    UPDATE public.rooms 
    SET 
      towel_change_required = CASE 
        WHEN guest_checkout_date IS NOT NULL THEN true  -- Always for checkout rooms
        WHEN days_since_towel_change >= 2 THEN true     -- Every 2 days for occupied rooms
        ELSE towel_change_required 
      END,
      linen_change_required = CASE 
        WHEN guest_checkout_date IS NOT NULL THEN true  -- Always for checkout rooms  
        WHEN days_since_linen_change >= 5 THEN true     -- Every 5 days for occupied rooms
        ELSE linen_change_required 
      END,
      updated_at = now()
    WHERE id = NEW.room_id;
    
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger for towel/linen requirements
DROP TRIGGER IF EXISTS check_towel_linen_on_completion ON public.room_assignments;
CREATE TRIGGER check_towel_linen_on_completion
  AFTER UPDATE ON public.room_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.check_towel_linen_requirements();