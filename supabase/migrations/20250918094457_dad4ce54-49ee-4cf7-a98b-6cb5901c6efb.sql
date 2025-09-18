-- First, clean up duplicate dirty linen counts keeping only the most recent entry
DELETE FROM public.dirty_linen_counts
WHERE id NOT IN (
  SELECT DISTINCT ON (housekeeper_id, room_id, linen_item_id, work_date) id
  FROM public.dirty_linen_counts
  ORDER BY housekeeper_id, room_id, linen_item_id, work_date, created_at DESC
);

-- Now add the unique constraint
ALTER TABLE public.dirty_linen_counts 
ADD CONSTRAINT dirty_linen_counts_unique 
UNIQUE (housekeeper_id, room_id, linen_item_id, work_date);

-- Create PMS upload summary table for managers/admins to view later
CREATE TABLE IF NOT EXISTS public.pms_upload_summary (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uploaded_by uuid REFERENCES public.profiles(id) NOT NULL,
  upload_date timestamp with time zone DEFAULT now(),
  processed_rooms integer DEFAULT 0,
  updated_rooms integer DEFAULT 0,
  assigned_rooms integer DEFAULT 0,
  checkout_rooms jsonb DEFAULT '[]'::jsonb,
  daily_cleaning_rooms jsonb DEFAULT '[]'::jsonb,
  errors jsonb DEFAULT '[]'::jsonb,
  hotel_filter text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Enable RLS on PMS upload summary
ALTER TABLE public.pms_upload_summary ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for PMS upload summary
CREATE POLICY "Managers and admins can view PMS upload summaries"
ON public.pms_upload_summary
FOR SELECT
USING (get_user_role(auth.uid()) = ANY (ARRAY['manager'::user_role, 'housekeeping_manager'::user_role, 'admin'::user_role]));

CREATE POLICY "Managers and admins can create PMS upload summaries"
ON public.pms_upload_summary
FOR INSERT
WITH CHECK (
  get_user_role(auth.uid()) = ANY (ARRAY['manager'::user_role, 'housekeeping_manager'::user_role, 'admin'::user_role])
  AND uploaded_by = auth.uid()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_pms_upload_summary_date ON public.pms_upload_summary(upload_date DESC);
CREATE INDEX IF NOT EXISTS idx_pms_upload_summary_user ON public.pms_upload_summary(uploaded_by);

-- Add trigger for auto-updating timestamps
CREATE TRIGGER update_pms_upload_summary_updated_at
BEFORE UPDATE ON public.pms_upload_summary
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Update hotel-filtered attendance function
CREATE OR REPLACE FUNCTION public.get_attendance_records_hotel_filtered(
  target_user_id uuid DEFAULT NULL,
  start_date date DEFAULT (CURRENT_DATE - INTERVAL '30 days'),
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
SET search_path = ''
AS $$
DECLARE
  current_user_role text;
  current_user_hotel text;
BEGIN
  -- Get current user's role and hotel
  SELECT public.get_user_role(auth.uid())::text INTO current_user_role;
  SELECT assigned_hotel INTO current_user_hotel FROM public.profiles WHERE id = auth.uid();
  
  -- Check permissions
  IF current_user_role NOT IN ('admin', 'hr', 'manager', 'housekeeping_manager', 'top_management') THEN
    -- Non-admin users can only see their own records
    IF target_user_id IS NOT NULL AND target_user_id != auth.uid() THEN
      RETURN;
    END IF;
    target_user_id := auth.uid();
  ELSIF current_user_role = 'manager' AND current_user_hotel IS NOT NULL THEN
    -- Managers can only see staff from their assigned hotel
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
    ORDER BY sa.work_date DESC, sa.check_in_time DESC;
    RETURN;
  END IF;
  
  -- Admin/HR/top_management can see all records
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
END;
$$;