-- Update attendance access control to properly implement hotel-based filtering
-- Admins/HR see all, Managers see only their hotel's staff

-- First, update the attendance records function to properly filter by hotel
CREATE OR REPLACE FUNCTION public.get_attendance_records_hotel_filtered(
  target_user_id uuid DEFAULT NULL::uuid, 
  start_date date DEFAULT (CURRENT_DATE - '30 days'::interval), 
  end_date date DEFAULT CURRENT_DATE
)
RETURNS TABLE(
  id uuid, 
  user_id uuid, 
  check_in_time timestamp with time zone, 
  check_out_time timestamp with time zone, 
  check_in_location jsonb, 
  check_out_location jsonb, 
  work_date date, 
  total_hours numeric, 
  break_duration integer, 
  status text, 
  notes text, 
  full_name text, 
  role text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  current_user_role text;
  current_user_hotel text;
BEGIN
  -- Get current user's role and hotel
  SELECT public.get_user_role(auth.uid())::text INTO current_user_role;
  SELECT assigned_hotel INTO current_user_hotel FROM public.profiles WHERE id = auth.uid();
  
  -- Admin, HR, and top management can see all records
  IF current_user_role IN ('admin', 'hr', 'top_management') THEN
    RETURN QUERY
    SELECT 
      sa.id,
      sa.user_id,
      sa.check_in_time,
      sa.check_out_time,
      sa.check_in_location,
      sa.check_out_location,
      sa.work_date,
      sa.total_hours,
      sa.break_duration,
      sa.status,
      sa.notes,
      p.full_name,
      p.role::text
    FROM public.staff_attendance sa
    JOIN public.profiles p ON sa.user_id = p.id
    WHERE (target_user_id IS NULL OR sa.user_id = target_user_id)
      AND sa.work_date BETWEEN start_date AND end_date
    ORDER BY sa.work_date DESC, sa.check_in_time DESC;
    RETURN;
  END IF;
  
  -- Managers and housekeeping managers can only see their hotel's staff
  IF current_user_role IN ('manager', 'housekeeping_manager') AND current_user_hotel IS NOT NULL THEN
    RETURN QUERY
    SELECT 
      sa.id,
      sa.user_id,
      sa.check_in_time,
      sa.check_out_time,
      sa.check_in_location,
      sa.check_out_location,
      sa.work_date,
      sa.total_hours,
      sa.break_duration,
      sa.status,
      sa.notes,
      p.full_name,
      p.role::text
    FROM public.staff_attendance sa
    JOIN public.profiles p ON sa.user_id = p.id
    WHERE (target_user_id IS NULL OR sa.user_id = target_user_id)
      AND sa.work_date BETWEEN start_date AND end_date
      AND (p.assigned_hotel = current_user_hotel OR sa.user_id = auth.uid())
      -- Include housekeeping and supervisors only for managers
      AND (current_user_role = 'manager' OR p.role IN ('housekeeping', 'reception', 'maintenance'))
    ORDER BY sa.work_date DESC, sa.check_in_time DESC;
    RETURN;
  END IF;
  
  -- Regular users can only see their own records
  RETURN QUERY
  SELECT 
    sa.id,
    sa.user_id,
    sa.check_in_time,
    sa.check_out_time,
    sa.check_in_location,
    sa.check_out_location,
    sa.work_date,
    sa.total_hours,
    sa.break_duration,
    sa.status,
    sa.notes,
    p.full_name,
    p.role::text
  FROM public.staff_attendance sa
  JOIN public.profiles p ON sa.user_id = p.id
  WHERE sa.user_id = auth.uid()
    AND sa.work_date BETWEEN start_date AND end_date
  ORDER BY sa.work_date DESC, sa.check_in_time DESC;
END;
$$;

-- Update attendance summary function with same hotel-based filtering
CREATE OR REPLACE FUNCTION public.get_attendance_summary_secure(
  target_user_id uuid DEFAULT NULL::uuid, 
  start_date date DEFAULT (CURRENT_DATE - '30 days'::interval), 
  end_date date DEFAULT CURRENT_DATE
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  current_user_role text;
  current_user_hotel text;
  summary_data json;
BEGIN
  -- Get current user's role and hotel
  SELECT public.get_user_role(auth.uid())::text INTO current_user_role;
  SELECT assigned_hotel INTO current_user_hotel FROM public.profiles WHERE id = auth.uid();
  
  -- Admin, HR, and top management can see all records
  IF current_user_role IN ('admin', 'hr', 'top_management') THEN
    SELECT json_build_object(
      'total_days', COALESCE(COUNT(DISTINCT sa.work_date), 0),
      'total_hours', COALESCE(SUM(sa.total_hours), 0),
      'avg_hours_per_day', COALESCE(
        CASE 
          WHEN COUNT(DISTINCT sa.work_date) > 0 
          THEN SUM(sa.total_hours) / COUNT(DISTINCT sa.work_date)
          ELSE 0 
        END, 0
      ),
      'punctual_days', COALESCE(COUNT(*) FILTER (WHERE sa.check_in_time::time <= '09:00:00'), 0),
      'late_arrivals', COALESCE(COUNT(*) FILTER (WHERE sa.check_in_time::time > '09:00:00'), 0),
      'early_departures', COALESCE(COUNT(*) FILTER (WHERE sa.check_out_time::time < '17:00:00' AND sa.check_out_time IS NOT NULL), 0)
    ) INTO summary_data
    FROM public.staff_attendance sa
    WHERE (target_user_id IS NULL OR sa.user_id = target_user_id)
      AND sa.work_date BETWEEN start_date AND end_date;
    RETURN summary_data;
  END IF;
  
  -- Managers can only see their hotel's staff
  IF current_user_role IN ('manager', 'housekeeping_manager') AND current_user_hotel IS NOT NULL THEN
    SELECT json_build_object(
      'total_days', COALESCE(COUNT(DISTINCT sa.work_date), 0),
      'total_hours', COALESCE(SUM(sa.total_hours), 0),
      'avg_hours_per_day', COALESCE(
        CASE 
          WHEN COUNT(DISTINCT sa.work_date) > 0 
          THEN SUM(sa.total_hours) / COUNT(DISTINCT sa.work_date)
          ELSE 0 
        END, 0
      ),
      'punctual_days', COALESCE(COUNT(*) FILTER (WHERE sa.check_in_time::time <= '09:00:00'), 0),
      'late_arrivals', COALESCE(COUNT(*) FILTER (WHERE sa.check_in_time::time > '09:00:00'), 0),
      'early_departures', COALESCE(COUNT(*) FILTER (WHERE sa.check_out_time::time < '17:00:00' AND sa.check_out_time IS NOT NULL), 0)
    ) INTO summary_data
    FROM public.staff_attendance sa
    JOIN public.profiles p ON sa.user_id = p.id
    WHERE (target_user_id IS NULL OR sa.user_id = target_user_id)
      AND sa.work_date BETWEEN start_date AND end_date
      AND (p.assigned_hotel = current_user_hotel OR sa.user_id = auth.uid());
    RETURN summary_data;
  END IF;
  
  -- Regular users can only see their own records
  SELECT json_build_object(
    'total_days', COALESCE(COUNT(DISTINCT sa.work_date), 0),
    'total_hours', COALESCE(SUM(sa.total_hours), 0),
    'avg_hours_per_day', COALESCE(
      CASE 
        WHEN COUNT(DISTINCT sa.work_date) > 0 
        THEN SUM(sa.total_hours) / COUNT(DISTINCT sa.work_date)
        ELSE 0 
      END, 0
    ),
    'punctual_days', COALESCE(COUNT(*) FILTER (WHERE sa.check_in_time::time <= '09:00:00'), 0),
    'late_arrivals', COALESCE(COUNT(*) FILTER (WHERE sa.check_in_time::time > '09:00:00'), 0),
    'early_departures', COALESCE(COUNT(*) FILTER (WHERE sa.check_out_time::time < '17:00:00' AND sa.check_out_time IS NOT NULL), 0)
  ) INTO summary_data
  FROM public.staff_attendance sa
  WHERE sa.user_id = auth.uid()
    AND sa.work_date BETWEEN start_date AND end_date;
    
  RETURN summary_data;
END;
$$;

-- Create hotel configuration table for multi-tenancy support
CREATE TABLE IF NOT EXISTS public.hotel_configurations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  hotel_id text NOT NULL UNIQUE, -- matches the hotel field in rooms/profiles
  hotel_name text NOT NULL,
  organization_id uuid NULL, -- for future multi-tenant support
  settings jsonb DEFAULT '{}'::jsonb,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Insert current hotels into the configuration table
INSERT INTO public.hotel_configurations (hotel_id, hotel_name, settings) 
VALUES 
  ('memories-budapest', 'Hotel Memories Budapest', '{"pms_settings": {"auto_assign": true}}'),
  ('mika-downtown', 'Hotel Mika Downtown', '{"pms_settings": {"auto_assign": true}}'),
  ('ottofiori', 'Hotel Ottofiori', '{"pms_settings": {"auto_assign": true}}'),
  ('gozsdu-court', 'Gozsdu Court Budapest', '{"pms_settings": {"auto_assign": true}}')
ON CONFLICT (hotel_id) DO NOTHING;

-- Create organization table for future multi-tenancy
CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL UNIQUE, -- for URL routing
  settings jsonb DEFAULT '{}'::jsonb,
  subscription_tier text DEFAULT 'basic',
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Insert default organization
INSERT INTO public.organizations (name, slug, settings, subscription_tier) 
VALUES ('RD Hotels Group', 'rd-hotels', '{"features": ["multi_hotel", "advanced_reporting"]}', 'enterprise')
ON CONFLICT (slug) DO NOTHING;

-- Update hotel configurations with organization reference
UPDATE public.hotel_configurations 
SET organization_id = (SELECT id FROM public.organizations WHERE slug = 'rd-hotels')
WHERE organization_id IS NULL;

-- Add RLS policies for hotel configurations
ALTER TABLE public.hotel_configurations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage hotel configurations" ON public.hotel_configurations
FOR ALL USING (get_user_role(auth.uid()) = 'admin'::user_role);

CREATE POLICY "Managers can view their hotel configuration" ON public.hotel_configurations
FOR SELECT USING (
  get_user_role(auth.uid()) IN ('manager', 'housekeeping_manager') AND
  hotel_id = (SELECT assigned_hotel FROM public.profiles WHERE id = auth.uid())
);

-- Add RLS policies for organizations
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage organizations" ON public.organizations
FOR ALL USING (get_user_role(auth.uid()) = 'admin'::user_role);

-- Function to get employees filtered by hotel for managers
CREATE OR REPLACE FUNCTION public.get_employees_by_hotel()
RETURNS TABLE(
  id uuid,
  full_name text,
  role user_role,
  assigned_hotel text,
  email text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  current_user_role text;
  current_user_hotel text;
BEGIN
  -- Get current user's role and hotel
  SELECT public.get_user_role(auth.uid())::text INTO current_user_role;
  SELECT assigned_hotel INTO current_user_hotel FROM public.profiles WHERE id = auth.uid();
  
  -- Admin, HR, and top management can see all employees
  IF current_user_role IN ('admin', 'hr', 'top_management') THEN
    RETURN QUERY
    SELECT p.id, p.full_name, p.role, p.assigned_hotel, p.email
    FROM public.profiles p
    WHERE p.role != 'admin'
    ORDER BY p.full_name;
    RETURN;
  END IF;
  
  -- Managers can only see employees from their hotel
  IF current_user_role IN ('manager', 'housekeeping_manager') AND current_user_hotel IS NOT NULL THEN
    RETURN QUERY
    SELECT p.id, p.full_name, p.role, p.assigned_hotel, p.email
    FROM public.profiles p
    WHERE p.assigned_hotel = current_user_hotel
      AND p.role IN ('housekeeping', 'reception', 'maintenance', 'marketing', 'control_finance', 'front_office')
    ORDER BY p.full_name;
    RETURN;
  END IF;
  
  -- Regular users cannot see other employees
  RETURN;
END;
$$;