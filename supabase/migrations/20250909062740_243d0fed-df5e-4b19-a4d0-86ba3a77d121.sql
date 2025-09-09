-- Create attendance table for staff check-in/check-out tracking
CREATE TABLE public.staff_attendance (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  check_in_time TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  check_out_time TIMESTAMP WITH TIME ZONE NULL,
  check_in_location JSONB NULL, -- stores {latitude, longitude, address}
  check_out_location JSONB NULL,
  work_date DATE NOT NULL DEFAULT CURRENT_DATE,
  total_hours DECIMAL(5,2) NULL, -- calculated field for hours worked
  break_duration INTEGER DEFAULT 0, -- break duration in minutes
  status TEXT NOT NULL DEFAULT 'checked_in' CHECK (status IN ('checked_in', 'on_break', 'checked_out')),
  notes TEXT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create indexes for better performance
CREATE INDEX idx_staff_attendance_user_date ON public.staff_attendance(user_id, work_date);
CREATE INDEX idx_staff_attendance_date ON public.staff_attendance(work_date);
CREATE INDEX idx_staff_attendance_status ON public.staff_attendance(status);

-- Enable RLS
ALTER TABLE public.staff_attendance ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own attendance" 
ON public.staff_attendance 
FOR SELECT 
USING (user_id = auth.uid());

CREATE POLICY "Users can insert their own attendance" 
ON public.staff_attendance 
FOR INSERT 
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own attendance" 
ON public.staff_attendance 
FOR UPDATE 
USING (user_id = auth.uid());

CREATE POLICY "HR and admins can view all attendance" 
ON public.staff_attendance 
FOR SELECT 
USING (get_user_role(auth.uid()) = ANY(ARRAY['admin'::user_role, 'hr'::user_role, 'manager'::user_role]));

-- Trigger to calculate total hours when checking out
CREATE OR REPLACE FUNCTION public.calculate_work_hours()
RETURNS TRIGGER AS $$
BEGIN
  -- Calculate total hours when check_out_time is set
  IF NEW.check_out_time IS NOT NULL AND OLD.check_out_time IS NULL THEN
    NEW.total_hours = EXTRACT(EPOCH FROM (NEW.check_out_time - NEW.check_in_time)) / 3600.0 - (NEW.break_duration / 60.0);
    NEW.status = 'checked_out';
  END IF;
  
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER calculate_work_hours_trigger
  BEFORE UPDATE ON public.staff_attendance
  FOR EACH ROW
  EXECUTE FUNCTION public.calculate_work_hours();

-- Function to get attendance summary
CREATE OR REPLACE FUNCTION public.get_attendance_summary(
  target_user_id UUID DEFAULT NULL,
  start_date DATE DEFAULT CURRENT_DATE - INTERVAL '30 days',
  end_date DATE DEFAULT CURRENT_DATE
)
RETURNS JSON
LANGUAGE SQL
STABLE SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT json_build_object(
    'total_days', COUNT(DISTINCT work_date),
    'total_hours', COALESCE(SUM(total_hours), 0),
    'avg_hours_per_day', COALESCE(AVG(total_hours), 0),
    'punctual_days', COUNT(*) FILTER (WHERE check_in_time::time <= '09:00:00'),
    'late_arrivals', COUNT(*) FILTER (WHERE check_in_time::time > '09:00:00'),
    'early_departures', COUNT(*) FILTER (WHERE check_out_time::time < '17:00:00' AND check_out_time IS NOT NULL)
  )
  FROM staff_attendance
  WHERE (target_user_id IS NULL OR user_id = target_user_id)
  AND work_date BETWEEN start_date AND end_date
  AND check_out_time IS NOT NULL;
$$;