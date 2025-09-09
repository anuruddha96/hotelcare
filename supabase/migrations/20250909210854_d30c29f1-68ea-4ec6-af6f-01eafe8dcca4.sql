-- Fix remaining functions with mutable search paths
-- These are mostly trigger functions that need secure search paths

CREATE OR REPLACE FUNCTION public.set_and_validate_ticket_completion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.status = 'completed' THEN
    IF NEW.closed_at IS NULL THEN
      NEW.closed_at := now();
    END IF;
    IF NEW.closed_by IS NULL THEN
      NEW.closed_by := auth.uid();
    END IF;
    IF NEW.resolution_text IS NULL OR length(trim(NEW.resolution_text)) = 0 THEN
      RAISE EXCEPTION 'Resolution text is required when closing a ticket';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_last_login()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  UPDATE public.profiles 
  SET last_login = now() 
  WHERE id = NEW.id;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.calculate_work_hours()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  -- Calculate total hours when check_out_time is set
  IF NEW.check_out_time IS NOT NULL AND OLD.check_out_time IS NULL THEN
    NEW.total_hours = EXTRACT(EPOCH FROM (NEW.check_out_time - NEW.check_in_time)) / 3600.0 - (NEW.break_duration / 60.0);
    NEW.status = 'checked_out';
  END IF;
  
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_room_status_on_assignment_completion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  -- When assignment is marked as completed, set completed_at timestamp but don't update room status
  IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
    NEW.completed_at = now();
  END IF;
  
  -- Only update room status when supervisor approves
  IF NEW.supervisor_approved = true AND OLD.supervisor_approved = false THEN
    UPDATE public.rooms 
    SET 
      status = 'clean',
      last_cleaned_at = now(),
      last_cleaned_by = NEW.assigned_to,
      updated_at = now()
    WHERE id = NEW.room_id;
  END IF;
  
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.validate_ticket_closure()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.set_sla_due_date()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.track_housekeeping_performance()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.sync_user_login_data()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  -- When a user logs in, update their last_login time
  -- This trigger is already handled by update_last_login trigger
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_ticket_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.ticket_number IS NULL OR NEW.ticket_number = '' THEN
    NEW.ticket_number := public.generate_ticket_number();
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''), -- Handle potential null email
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'New User'),
    'housekeeping'
  );
  RETURN NEW;
END;
$function$;