-- Add supervisor approval status to room assignments
ALTER TABLE public.room_assignments ADD COLUMN supervisor_approved BOOLEAN DEFAULT FALSE;
ALTER TABLE public.room_assignments ADD COLUMN supervisor_approved_by UUID REFERENCES public.profiles(id);
ALTER TABLE public.room_assignments ADD COLUMN supervisor_approved_at TIMESTAMP WITH TIME ZONE;

-- Remove automatic room status update trigger to prevent auto-approval
DROP TRIGGER IF EXISTS update_room_on_assignment_completion ON public.room_assignments;

-- Update the trigger function to not automatically update room status
CREATE OR REPLACE FUNCTION public.update_room_status_on_assignment_completion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- When assignment is marked as completed, set completed_at timestamp but don't update room status
  IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
    NEW.completed_at = now();
  END IF;
  
  -- Only update room status when supervisor approves
  IF NEW.supervisor_approved = true AND OLD.supervisor_approved = false THEN
    UPDATE public.rooms 
    SET 
      status = 'clean',
      last_cleaned_at = now(),
      last_cleaned_by = NEW.assigned_to,
      updated_at = now()
    WHERE id = NEW.room_id;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Re-create the trigger
CREATE TRIGGER update_room_on_assignment_completion
  BEFORE UPDATE ON public.room_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.update_room_status_on_assignment_completion();