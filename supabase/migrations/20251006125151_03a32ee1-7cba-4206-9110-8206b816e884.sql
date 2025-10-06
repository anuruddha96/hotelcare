-- Create maintenance_issues table for tracking broken items
CREATE TABLE IF NOT EXISTS public.maintenance_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID REFERENCES public.rooms(id) ON DELETE CASCADE NOT NULL,
  assignment_id UUID REFERENCES public.room_assignments(id) ON DELETE SET NULL,
  reported_by UUID NOT NULL,
  issue_description TEXT NOT NULL,
  photo_urls TEXT[] DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  priority TEXT NOT NULL DEFAULT 'medium',
  resolved_at TIMESTAMP WITH TIME ZONE,
  resolved_by UUID,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  organization_slug TEXT DEFAULT 'rdhotels'
);

-- Create lost_and_found table
CREATE TABLE IF NOT EXISTS public.lost_and_found (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID REFERENCES public.rooms(id) ON DELETE CASCADE NOT NULL,
  assignment_id UUID REFERENCES public.room_assignments(id) ON DELETE SET NULL,
  reported_by UUID NOT NULL,
  item_description TEXT NOT NULL,
  photo_urls TEXT[] DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  found_date DATE NOT NULL DEFAULT CURRENT_DATE,
  claimed_at TIMESTAMP WITH TIME ZONE,
  claimed_by TEXT,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  organization_slug TEXT DEFAULT 'rdhotels'
);

-- Create general_tasks table for non-room cleaning tasks
CREATE TABLE IF NOT EXISTS public.general_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_name TEXT NOT NULL,
  task_description TEXT,
  task_type TEXT NOT NULL DEFAULT 'general_cleaning',
  assigned_to UUID NOT NULL,
  assigned_by UUID NOT NULL,
  assigned_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status TEXT NOT NULL DEFAULT 'assigned',
  priority INTEGER NOT NULL DEFAULT 1,
  estimated_duration INTEGER,
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  completion_photos TEXT[] DEFAULT '{}',
  notes TEXT,
  hotel TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  organization_slug TEXT DEFAULT 'rdhotels'
);

-- Enable RLS
ALTER TABLE public.maintenance_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lost_and_found ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.general_tasks ENABLE ROW LEVEL SECURITY;

-- RLS Policies for maintenance_issues
CREATE POLICY "Staff can create maintenance issues"
  ON public.maintenance_issues FOR INSERT
  WITH CHECK (
    reported_by = auth.uid() AND
    get_user_role(auth.uid()) IN ('housekeeping', 'housekeeping_manager', 'manager', 'admin', 'maintenance')
  );

CREATE POLICY "Staff can view maintenance issues"
  ON public.maintenance_issues FOR SELECT
  USING (
    get_user_role(auth.uid()) IN ('housekeeping', 'housekeeping_manager', 'manager', 'admin', 'maintenance', 'reception')
  );

CREATE POLICY "Managers can update maintenance issues"
  ON public.maintenance_issues FOR UPDATE
  USING (
    get_user_role(auth.uid()) IN ('housekeeping_manager', 'manager', 'admin', 'maintenance')
  );

-- RLS Policies for lost_and_found
CREATE POLICY "Staff can create lost and found items"
  ON public.lost_and_found FOR INSERT
  WITH CHECK (
    reported_by = auth.uid() AND
    get_user_role(auth.uid()) IN ('housekeeping', 'housekeeping_manager', 'manager', 'admin', 'reception')
  );

CREATE POLICY "Staff can view lost and found items"
  ON public.lost_and_found FOR SELECT
  USING (
    get_user_role(auth.uid()) IN ('housekeeping', 'housekeeping_manager', 'manager', 'admin', 'reception')
  );

CREATE POLICY "Managers can update lost and found items"
  ON public.lost_and_found FOR UPDATE
  USING (
    get_user_role(auth.uid()) IN ('housekeeping_manager', 'manager', 'admin', 'reception')
  );

-- RLS Policies for general_tasks
CREATE POLICY "Managers can create general tasks"
  ON public.general_tasks FOR INSERT
  WITH CHECK (
    assigned_by = auth.uid() AND
    get_user_role(auth.uid()) IN ('housekeeping_manager', 'manager', 'admin')
  );

CREATE POLICY "Staff can view their general tasks"
  ON public.general_tasks FOR SELECT
  USING (
    assigned_to = auth.uid() OR
    assigned_by = auth.uid() OR
    get_user_role(auth.uid()) IN ('housekeeping_manager', 'manager', 'admin')
  );

CREATE POLICY "Assigned staff and managers can update general tasks"
  ON public.general_tasks FOR UPDATE
  USING (
    assigned_to = auth.uid() OR
    get_user_role(auth.uid()) IN ('housekeeping_manager', 'manager', 'admin')
  );

CREATE POLICY "Managers can delete general tasks"
  ON public.general_tasks FOR DELETE
  USING (
    get_user_role(auth.uid()) IN ('housekeeping_manager', 'manager', 'admin')
  );

-- Create triggers for updated_at
CREATE TRIGGER update_maintenance_issues_updated_at
  BEFORE UPDATE ON public.maintenance_issues
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_lost_and_found_updated_at
  BEFORE UPDATE ON public.lost_and_found
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_general_tasks_updated_at
  BEFORE UPDATE ON public.general_tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();