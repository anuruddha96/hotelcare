-- Create department access configuration table
CREATE TABLE public.department_access_config (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  role user_role NOT NULL,
  department TEXT NOT NULL,
  access_scope TEXT NOT NULL CHECK (access_scope IN ('hotel_only', 'all_hotels', 'assigned_and_created')),
  can_manage_all BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(role, department)
);

-- Enable RLS
ALTER TABLE public.department_access_config ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Admins can manage access config" 
ON public.department_access_config 
FOR ALL 
USING (get_user_role(auth.uid()) = 'admin'::user_role)
WITH CHECK (get_user_role(auth.uid()) = 'admin'::user_role);

CREATE POLICY "All authenticated users can view access config" 
ON public.department_access_config 
FOR SELECT 
USING (true);

-- Insert default configurations
INSERT INTO public.department_access_config (role, department, access_scope, can_manage_all) VALUES
-- Admin sees everything
('admin', 'all', 'all_hotels', true),
('top_management', 'all', 'all_hotels', true),

-- Housekeeping managers see housekeeping and maintenance for their hotel
('manager', 'housekeeping', 'hotel_only', false),
('manager', 'maintenance', 'hotel_only', false),

-- Marketing sees all marketing tickets across hotels
('manager', 'marketing', 'all_hotels', false),

-- Front office managers see reception for their hotel
('manager', 'reception', 'hotel_only', false),
('manager', 'front_office', 'hotel_only', false),

-- Regular staff see their department for their hotel + assigned/created
('housekeeping', 'housekeeping', 'assigned_and_created', false),
('maintenance', 'maintenance', 'assigned_and_created', false),
('reception', 'reception', 'assigned_and_created', false),
('front_office', 'reception', 'assigned_and_created', false),
('marketing', 'marketing', 'all_hotels', false),
('control_finance', 'finance', 'assigned_and_created', false),
('hr', 'hr', 'assigned_and_created', false);

-- Create function to get user access config
CREATE OR REPLACE FUNCTION public.get_user_access_config(user_role user_role)
RETURNS TABLE(department text, access_scope text, can_manage_all boolean)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    dac.department,
    dac.access_scope,
    dac.can_manage_all
  FROM public.department_access_config dac
  WHERE dac.role = user_role;
$$;

-- Update tickets RLS policy to use new configuration
DROP POLICY IF EXISTS "Users can view tickets for their assigned hotel or all if admin" ON public.tickets;

CREATE POLICY "Users can view tickets based on access config" 
ON public.tickets 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 
    FROM public.get_user_access_config(get_user_role(auth.uid())) config
    WHERE 
      -- Admin or top management sees all
      config.can_manage_all = true
      OR
      -- Department-specific access
      (
        config.department = 'all' 
        OR config.department = tickets.department
        OR (config.department = 'front_office' AND tickets.department = 'reception')
      )
      AND
      (
        -- All hotels access
        config.access_scope = 'all_hotels'
        OR
        -- Hotel-only access (check assigned hotel matches)
        (
          config.access_scope = 'hotel_only' 
          AND (
            SELECT assigned_hotel FROM public.profiles WHERE id = auth.uid()
          ) = tickets.hotel
        )
        OR
        -- Assigned and created access
        (
          config.access_scope = 'assigned_and_created'
          AND (
            tickets.assigned_to = auth.uid() 
            OR tickets.created_by = auth.uid()
            OR (
              (SELECT assigned_hotel FROM public.profiles WHERE id = auth.uid()) = tickets.hotel
              AND config.department = tickets.department
            )
          )
        )
      )
  )
);

-- Create trigger for updating timestamps
CREATE TRIGGER update_department_access_config_updated_at
BEFORE UPDATE ON public.department_access_config
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();