-- Add performance tracking fields to room_assignments
ALTER TABLE public.room_assignments ADD COLUMN started_at timestamp with time zone;

-- Create performance analytics table for historical data
CREATE TABLE public.housekeeping_performance (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  assignment_id uuid NOT NULL REFERENCES public.room_assignments(id) ON DELETE CASCADE,
  housekeeper_id uuid NOT NULL,
  room_id uuid NOT NULL,
  assignment_type assignment_type NOT NULL,
  started_at timestamp with time zone NOT NULL,
  completed_at timestamp with time zone NOT NULL,
  actual_duration_minutes integer NOT NULL,
  estimated_duration_minutes integer,
  efficiency_score numeric(5,2) NOT NULL DEFAULT 100.00, -- percentage: estimated/actual * 100
  assignment_date date NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS on performance table
ALTER TABLE public.housekeeping_performance ENABLE ROW LEVEL SECURITY;

-- RLS policies for performance data
CREATE POLICY "Managers and admins can view all performance data" 
ON public.housekeeping_performance 
FOR SELECT 
USING (get_user_role(auth.uid()) = ANY (ARRAY['manager'::user_role, 'admin'::user_role]));

CREATE POLICY "Housekeepers can view their own performance" 
ON public.housekeeping_performance 
FOR SELECT 
USING (housekeeper_id = auth.uid());

-- Function to calculate performance metrics
CREATE OR REPLACE FUNCTION public.get_housekeeper_performance_stats(
  target_housekeeper_id uuid DEFAULT NULL,
  days_back integer DEFAULT 30
)
RETURNS json
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT json_build_object(
    'avg_duration_minutes', COALESCE(AVG(actual_duration_minutes), 0),
    'avg_efficiency_score', COALESCE(AVG(efficiency_score), 100),
    'total_completed', COUNT(*),
    'best_time_minutes', COALESCE(MIN(actual_duration_minutes), 0),
    'total_rooms_today', (
      SELECT COUNT(*) FROM housekeeping_performance 
      WHERE housekeeper_id = COALESCE(target_housekeeper_id, housekeeper_id)
      AND assignment_date = CURRENT_DATE
    )
  )
  FROM housekeeping_performance 
  WHERE (target_housekeeper_id IS NULL OR housekeeper_id = target_housekeeper_id)
  AND assignment_date >= CURRENT_DATE - INTERVAL '1 day' * days_back;
$$;

-- Function to get performance leaderboard
CREATE OR REPLACE FUNCTION public.get_housekeeping_leaderboard(
  days_back integer DEFAULT 7
)
RETURNS TABLE(
  housekeeper_id uuid,
  full_name text,
  avg_duration_minutes numeric,
  avg_efficiency_score numeric,
  total_completed bigint,
  rank_position bigint
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT 
    hp.housekeeper_id,
    p.full_name,
    ROUND(AVG(hp.actual_duration_minutes), 1) as avg_duration_minutes,
    ROUND(AVG(hp.efficiency_score), 1) as avg_efficiency_score,
    COUNT(*) as total_completed,
    RANK() OVER (ORDER BY AVG(hp.efficiency_score) DESC, AVG(hp.actual_duration_minutes) ASC) as rank_position
  FROM housekeeping_performance hp
  JOIN profiles p ON hp.housekeeper_id = p.id
  WHERE hp.assignment_date >= CURRENT_DATE - INTERVAL '1 day' * days_back
  AND p.role = 'housekeeping'
  GROUP BY hp.housekeeper_id, p.full_name
  HAVING COUNT(*) >= 1
  ORDER BY rank_position;
$$;

-- Trigger to automatically create performance records
CREATE OR REPLACE FUNCTION public.track_housekeeping_performance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  actual_minutes integer;
  efficiency numeric;
BEGIN
  -- Only process when assignment moves from in_progress to completed
  IF NEW.status = 'completed' AND OLD.status = 'in_progress' AND NEW.started_at IS NOT NULL THEN
    -- Calculate actual duration in minutes
    actual_minutes := EXTRACT(EPOCH FROM (NEW.completed_at - NEW.started_at)) / 60;
    
    -- Calculate efficiency score (estimated/actual * 100, capped at 200%)
    IF NEW.estimated_duration IS NOT NULL AND NEW.estimated_duration > 0 THEN
      efficiency := LEAST((NEW.estimated_duration::numeric / actual_minutes * 100), 200);
    ELSE
      efficiency := 100; -- Default efficiency if no estimate
    END IF;
    
    -- Insert performance record
    INSERT INTO housekeeping_performance (
      assignment_id,
      housekeeper_id,
      room_id,
      assignment_type,
      started_at,
      completed_at,
      actual_duration_minutes,
      estimated_duration_minutes,
      efficiency_score,
      assignment_date
    ) VALUES (
      NEW.id,
      NEW.assigned_to,
      NEW.room_id,
      NEW.assignment_type,
      NEW.started_at,
      NEW.completed_at,
      actual_minutes,
      NEW.estimated_duration,
      efficiency,
      NEW.assignment_date
    );
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger for performance tracking
CREATE TRIGGER track_performance_on_completion
  AFTER UPDATE ON public.room_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.track_housekeeping_performance();

-- Add updated_at trigger for performance table
CREATE TRIGGER update_housekeeping_performance_updated_at
  BEFORE UPDATE ON public.housekeeping_performance
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();