-- Add new user roles to the enum
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'marketing';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'control_finance';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'hr';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'front_office';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'top_management';

-- Add hotel field and other missing fields to tickets table
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS hotel TEXT;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS sla_breach_reason TEXT;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS attachment_urls TEXT[];
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS sub_category TEXT;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS sub_sub_category TEXT;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS sla_due_date TIMESTAMP WITH TIME ZONE;

-- Create ticket_categories table for structured category management
CREATE TABLE IF NOT EXISTS public.ticket_categories (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  department user_role NOT NULL,
  category_key TEXT NOT NULL,
  category_name TEXT NOT NULL,
  sub_category_key TEXT,
  sub_category_name TEXT,
  sub_sub_category_key TEXT,
  sub_sub_category_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(department, category_key, sub_category_key, sub_sub_category_key)
);

-- Enable RLS on ticket_categories
ALTER TABLE public.ticket_categories ENABLE ROW LEVEL SECURITY;

-- Insert category data for all departments
INSERT INTO public.ticket_categories (department, category_key, category_name, sub_category_key, sub_category_name, sub_sub_category_key, sub_sub_category_name) VALUES
-- Maintenance categories
('maintenance', 'paint-request', 'Paint Request', 'interior-paint', 'Interior Paint', 'wall-paint', 'Wall Paint'),
('maintenance', 'paint-request', 'Paint Request', 'interior-paint', 'Interior Paint', 'ceiling-paint', 'Ceiling Paint'),
('maintenance', 'paint-request', 'Paint Request', 'interior-paint', 'Interior Paint', 'trim-paint', 'Trim Paint'),
('maintenance', 'paint-request', 'Paint Request', 'exterior-paint', 'Exterior Paint', 'facade-paint', 'Facade Paint'),
('maintenance', 'paint-request', 'Paint Request', 'exterior-paint', 'Exterior Paint', 'balcony-paint', 'Balcony Paint'),
('maintenance', 'room-issues', 'Room Issues', 'room-equipment', 'Room Equipment', 'tv-issues', 'TV Issues'),
('maintenance', 'room-issues', 'Room Issues', 'room-equipment', 'Room Equipment', 'ac-issues', 'A/C Issues'),
('maintenance', 'room-issues', 'Room Issues', 'room-equipment', 'Room Equipment', 'lighting', 'Lighting Issues'),
('maintenance', 'room-issues', 'Room Issues', 'room-equipment', 'Room Equipment', 'furniture', 'Furniture Issues'),
('maintenance', 'room-issues', 'Room Issues', 'bathroom-issues', 'Bathroom Issues', 'plumbing', 'Plumbing'),
('maintenance', 'room-issues', 'Room Issues', 'bathroom-issues', 'Bathroom Issues', 'fixtures', 'Fixtures'),
('maintenance', 'room-issues', 'Room Issues', 'bathroom-issues', 'Bathroom Issues', 'ventilation', 'Ventilation'),
('maintenance', 'room-issues', 'Room Issues', 'fire-alarm', 'Fire Alarm', 'detector-issues', 'Detector Issues'),
('maintenance', 'room-issues', 'Room Issues', 'fire-alarm', 'Fire Alarm', 'false-alarms', 'False Alarms'),
('maintenance', 'gym-issues', 'Gym Issues', 'equipment', 'Equipment', 'cardio', 'Cardio Equipment'),
('maintenance', 'gym-issues', 'Gym Issues', 'equipment', 'Equipment', 'weights', 'Weight Equipment'),
('maintenance', 'restaurant-issues', 'Restaurant Issues', 'kitchen', 'Kitchen Equipment', 'appliances', 'Appliances'),
('maintenance', 'restaurant-issues', 'Restaurant Issues', 'kitchen', 'Kitchen Equipment', 'hvac', 'HVAC'),

-- Housekeeping categories
('housekeeping', 'cleaning-supplies', 'Cleaning Supplies', 'chemicals', 'Chemicals', 'sanitizers', 'Sanitizers'),
('housekeeping', 'cleaning-supplies', 'Cleaning Supplies', 'chemicals', 'Chemicals', 'detergents', 'Detergents'),
('housekeeping', 'linen-laundry', 'Linen & Laundry', 'bed-linen', 'Bed Linen', 'sheets', 'Sheets'),
('housekeeping', 'linen-laundry', 'Linen & Laundry', 'bed-linen', 'Bed Linen', 'pillows', 'Pillows'),
('housekeeping', 'room-service', 'Room Service', 'amenities', 'Amenities', 'toiletries', 'Toiletries'),
('housekeeping', 'room-service', 'Room Service', 'amenities', 'Amenities', 'minibar', 'Minibar'),

-- Reception categories
('reception', 'guest-requests', 'Guest Requests', 'concierge', 'Concierge', 'transportation', 'Transportation'),
('reception', 'guest-requests', 'Guest Requests', 'concierge', 'Concierge', 'reservations', 'Reservations'),
('reception', 'check-in-out', 'Check-in/Check-out', 'system-issues', 'System Issues', 'pms', 'PMS Issues'),
('reception', 'check-in-out', 'Check-in/Check-out', 'system-issues', 'System Issues', 'key-cards', 'Key Card Issues'),

-- Marketing categories
('marketing', 'promotions', 'Promotions', 'campaigns', 'Campaigns', 'digital', 'Digital Marketing'),
('marketing', 'promotions', 'Promotions', 'campaigns', 'Campaigns', 'print', 'Print Materials'),
('marketing', 'events', 'Events', 'planning', 'Event Planning', 'weddings', 'Weddings'),
('marketing', 'events', 'Events', 'planning', 'Event Planning', 'conferences', 'Conferences'),

-- Control & Finance categories
('control_finance', 'accounting', 'Accounting', 'billing', 'Billing', 'invoices', 'Invoices'),
('control_finance', 'accounting', 'Accounting', 'billing', 'Billing', 'payments', 'Payments'),
('control_finance', 'budgeting', 'Budgeting', 'forecasting', 'Forecasting', 'revenue', 'Revenue Forecast'),
('control_finance', 'budgeting', 'Budgeting', 'forecasting', 'Forecasting', 'expenses', 'Expense Planning'),

-- HR categories
('hr', 'recruitment', 'Recruitment', 'hiring', 'Hiring', 'interviews', 'Interviews'),
('hr', 'recruitment', 'Recruitment', 'hiring', 'Hiring', 'onboarding', 'Onboarding'),
('hr', 'training', 'Training', 'staff-dev', 'Staff Development', 'skills', 'Skills Training'),
('hr', 'training', 'Training', 'staff-dev', 'Staff Development', 'compliance', 'Compliance Training'),

-- Front Office categories
('front_office', 'reservations', 'Reservations', 'booking', 'Booking', 'modifications', 'Modifications'),
('front_office', 'reservations', 'Reservations', 'booking', 'Booking', 'cancellations', 'Cancellations'),
('front_office', 'guest-services', 'Guest Services', 'complaints', 'Complaints', 'service', 'Service Issues'),
('front_office', 'guest-services', 'Guest Services', 'complaints', 'Complaints', 'facilities', 'Facility Issues'),

-- Top Management categories
('top_management', 'strategic-planning', 'Strategic Planning', 'operations', 'Operations', 'efficiency', 'Efficiency Improvements'),
('top_management', 'strategic-planning', 'Strategic Planning', 'operations', 'Operations', 'quality', 'Quality Control'),
('top_management', 'compliance', 'Compliance', 'regulations', 'Regulations', 'health-safety', 'Health & Safety'),
('top_management', 'compliance', 'Compliance', 'regulations', 'Regulations', 'licensing', 'Licensing');

-- Create RLS policies for ticket_categories
CREATE POLICY "All authenticated users can view categories" 
ON public.ticket_categories 
FOR SELECT 
USING (true);

-- Update RLS policies for tickets to include new roles
DROP POLICY IF EXISTS "Housekeeping and reception can create tickets" ON public.tickets;
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

-- Update the validation function to require SLA breach reason
CREATE OR REPLACE FUNCTION public.validate_ticket_closure()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'completed' THEN
    -- Set closed_at and closed_by if not already set
    IF NEW.closed_at IS NULL THEN
      NEW.closed_at := now();
    END IF;
    IF NEW.closed_by IS NULL THEN
      NEW.closed_by := auth.uid();
    END IF;
    
    -- Require resolution text
    IF NEW.resolution_text IS NULL OR length(trim(NEW.resolution_text)) = 0 THEN
      RAISE EXCEPTION 'Resolution text is required when closing a ticket';
    END IF;
    
    -- Require SLA breach reason if closing after SLA due date
    IF NEW.sla_due_date IS NOT NULL AND now() > NEW.sla_due_date THEN
      IF NEW.sla_breach_reason IS NULL OR length(trim(NEW.sla_breach_reason)) = 0 THEN
        RAISE EXCEPTION 'SLA breach reason is required when closing tickets past their due date';
      END IF;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Update the trigger to use the new validation function
DROP TRIGGER IF EXISTS validate_ticket_completion ON public.tickets;
CREATE TRIGGER validate_ticket_completion
  BEFORE UPDATE ON public.tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_ticket_closure();