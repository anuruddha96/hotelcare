-- Fix division by zero in housekeeping performance tracking when jobs complete in under a minute
CREATE OR REPLACE FUNCTION public.track_housekeeping_performance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  actual_minutes_numeric numeric;
  efficiency numeric;
  effective_completed_at timestamptz;
BEGIN
  -- Only process when assignment moves from in_progress to completed
  IF NEW.status = 'completed' AND OLD.status = 'in_progress' AND NEW.started_at IS NOT NULL THEN
    -- Use NEW.completed_at if present; otherwise, use now()
    effective_completed_at := COALESCE(NEW.completed_at, now());

    -- Calculate actual duration in minutes, clamped to at least 1 minute to avoid division by zero
    actual_minutes_numeric := CEIL(EXTRACT(EPOCH FROM (effective_completed_at - NEW.started_at)) / 60.0);
    IF actual_minutes_numeric IS NULL OR actual_minutes_numeric < 1 THEN
      actual_minutes_numeric := 1;
    END IF;

    -- Calculate efficiency score (estimated/actual * 100, capped at 200%)
    IF NEW.estimated_duration IS NOT NULL AND NEW.estimated_duration > 0 THEN
      efficiency := LEAST((NEW.estimated_duration::numeric / actual_minutes_numeric) * 100, 200);
    ELSE
      efficiency := 100; -- Default efficiency if no estimate
    END IF;

    -- Insert performance record
    INSERT INTO public.housekeeping_performance (
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
      effective_completed_at,
      actual_minutes_numeric::int,
      NEW.estimated_duration,
      efficiency,
      NEW.assignment_date
    );
  END IF;

  RETURN NEW;
END;
$$;