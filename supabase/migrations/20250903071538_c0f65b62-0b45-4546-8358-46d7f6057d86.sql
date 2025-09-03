-- Create enum for assignment types
CREATE TYPE assignment_type AS ENUM ('daily_cleaning', 'checkout_cleaning', 'maintenance', 'deep_cleaning');

-- Create enum for assignment status
CREATE TYPE assignment_status AS ENUM ('assigned', 'in_progress', 'completed', 'cancelled');

-- Create room assignments table
CREATE TABLE public.room_assignments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id UUID NOT NULL,
  assigned_to UUID NOT NULL,
  assigned_by UUID NOT NULL,
  assignment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  assignment_type assignment_type NOT NULL DEFAULT 'daily_cleaning',
  status assignment_status NOT NULL DEFAULT 'assigned',
  priority INTEGER NOT NULL DEFAULT 1, -- 1=low, 2=medium, 3=high
  estimated_duration INTEGER, -- in minutes
  notes TEXT,
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create housekeeping notes table for detailed room notes
CREATE TABLE public.housekeeping_notes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id UUID NOT NULL,
  assignment_id UUID,
  note_type TEXT NOT NULL DEFAULT 'general', -- 'general', 'maintenance', 'guest_request', 'damage'
  content TEXT NOT NULL,
  created_by UUID NOT NULL,
  is_resolved BOOLEAN NOT NULL DEFAULT false,
  resolved_by UUID,
  resolved_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.room_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.housekeeping_notes ENABLE ROW LEVEL SECURITY;

-- RLS policies for room_assignments
CREATE POLICY "Housekeeping staff can view their assignments" 
ON public.room_assignments 
FOR SELECT 
USING (
  assigned_to = auth.uid() OR 
  get_user_role(auth.uid()) IN ('manager', 'admin', 'housekeeping') OR
  assigned_by = auth.uid()
);

CREATE POLICY "Managers and admins can create assignments" 
ON public.room_assignments 
FOR INSERT 
WITH CHECK (
  get_user_role(auth.uid()) IN ('manager', 'admin') AND
  assigned_by = auth.uid()
);

CREATE POLICY "Assigned staff and managers can update assignments" 
ON public.room_assignments 
FOR UPDATE 
USING (
  assigned_to = auth.uid() OR 
  get_user_role(auth.uid()) IN ('manager', 'admin') OR
  assigned_by = auth.uid()
);

CREATE POLICY "Managers and admins can delete assignments" 
ON public.room_assignments 
FOR DELETE 
USING (get_user_role(auth.uid()) IN ('manager', 'admin'));

-- RLS policies for housekeeping_notes
CREATE POLICY "Housekeeping staff can view notes for their hotels" 
ON public.housekeeping_notes 
FOR SELECT 
USING (
  get_user_role(auth.uid()) IN ('housekeeping', 'manager', 'admin') OR
  created_by = auth.uid()
);

CREATE POLICY "Housekeeping staff can create notes" 
ON public.housekeeping_notes 
FOR INSERT 
WITH CHECK (
  get_user_role(auth.uid()) IN ('housekeeping', 'manager', 'admin') AND
  created_by = auth.uid()
);

CREATE POLICY "Staff can update their own notes and managers can update any" 
ON public.housekeeping_notes 
FOR UPDATE 
USING (
  created_by = auth.uid() OR 
  get_user_role(auth.uid()) IN ('manager', 'admin')
);

-- Triggers for updated_at
CREATE TRIGGER update_room_assignments_updated_at
  BEFORE UPDATE ON public.room_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_housekeeping_notes_updated_at
  BEFORE UPDATE ON public.housekeeping_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Function to auto-update room status when assignment is completed
CREATE OR REPLACE FUNCTION public.update_room_status_on_assignment_completion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- When assignment is marked as completed, update room status
  IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
    -- Set completed_at timestamp
    NEW.completed_at = now();
    
    -- Update room status based on assignment type
    IF NEW.assignment_type IN ('daily_cleaning', 'checkout_cleaning', 'deep_cleaning') THEN
      UPDATE public.rooms 
      SET 
        status = 'clean',
        last_cleaned_at = now(),
        last_cleaned_by = NEW.assigned_to,
        updated_at = now()
      WHERE id = NEW.room_id;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Trigger for room status updates
CREATE TRIGGER update_room_on_assignment_completion
  BEFORE UPDATE ON public.room_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.update_room_status_on_assignment_completion();

-- Function to get housekeeping summary for a user
CREATE OR REPLACE FUNCTION public.get_housekeeping_summary(user_id UUID, target_date DATE DEFAULT CURRENT_DATE)
RETURNS JSON
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT json_build_object(
    'total_assigned', (
      SELECT COUNT(*) FROM room_assignments 
      WHERE assigned_to = user_id 
      AND assignment_date = target_date
    ),
    'completed', (
      SELECT COUNT(*) FROM room_assignments 
      WHERE assigned_to = user_id 
      AND assignment_date = target_date 
      AND status = 'completed'
    ),
    'in_progress', (
      SELECT COUNT(*) FROM room_assignments 
      WHERE assigned_to = user_id 
      AND assignment_date = target_date 
      AND status = 'in_progress'
    ),
    'pending', (
      SELECT COUNT(*) FROM room_assignments 
      WHERE assigned_to = user_id 
      AND assignment_date = target_date 
      AND status = 'assigned'
    )
  );
$$;