-- Update RLS policies for tickets to include new roles
DROP POLICY IF EXISTS "Housekeeping and reception can create tickets" ON public.tickets;
DROP POLICY IF EXISTS "All staff can create tickets" ON public.tickets;
CREATE POLICY "All staff can create tickets" 
ON public.tickets 
FOR INSERT 
WITH CHECK (get_user_role(auth.uid()) = ANY (ARRAY[
  'housekeeping'::user_role, 
  'reception'::user_role, 
  'maintenance'::user_role,
  'manager'::user_role, 
  'admin'::user_role,
  'marketing'::user_role,
  'control_finance'::user_role,
  'hr'::user_role,
  'front_office'::user_role,
  'top_management'::user_role
]));

-- Update the maintenance/housekeeping close policy to include all roles
DROP POLICY IF EXISTS "Maint/HK can close tickets they created or assigned" ON public.tickets;
DROP POLICY IF EXISTS "Staff can close assigned or created tickets" ON public.tickets;
CREATE POLICY "Staff can close assigned or created tickets" 
ON public.tickets 
FOR UPDATE 
USING ((get_user_role(auth.uid()) = ANY (ARRAY[
  'maintenance'::user_role, 
  'housekeeping'::user_role,
  'reception'::user_role,
  'marketing'::user_role,
  'control_finance'::user_role,
  'hr'::user_role,
  'front_office'::user_role,
  'top_management'::user_role
])) AND ((assigned_to = auth.uid()) OR (created_by = auth.uid())))
WITH CHECK ((status = 'completed'::ticket_status) AND (resolution_text IS NOT NULL) AND (closed_by = auth.uid()));

-- Create function to set SLA due date based on priority
CREATE OR REPLACE FUNCTION public.set_sla_due_date()
RETURNS TRIGGER AS $$
BEGIN
  -- Set SLA due dates based on priority
  CASE NEW.priority
    WHEN 'urgent' THEN
      NEW.sla_due_date := NEW.created_at + INTERVAL '4 hours';
    WHEN 'high' THEN
      NEW.sla_due_date := NEW.created_at + INTERVAL '1 day';
    WHEN 'medium' THEN
      NEW.sla_due_date := NEW.created_at + INTERVAL '3 days';
    WHEN 'low' THEN
      NEW.sla_due_date := NEW.created_at + INTERVAL '7 days';
  END CASE;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically set SLA due date
DROP TRIGGER IF EXISTS set_sla_due_date_trigger ON public.tickets;
CREATE TRIGGER set_sla_due_date_trigger
  BEFORE INSERT ON public.tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.set_sla_due_date();