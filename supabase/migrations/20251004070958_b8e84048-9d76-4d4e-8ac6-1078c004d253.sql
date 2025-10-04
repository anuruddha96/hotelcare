-- Update the housekeeping summary function to only count checkout rooms that are ready to clean
CREATE OR REPLACE FUNCTION public.get_housekeeping_summary(user_id uuid, target_date date DEFAULT CURRENT_DATE)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT json_build_object(
    'total_assigned', (
      SELECT COUNT(*) FROM public.room_assignments 
      WHERE assigned_to = user_id 
      AND assignment_date = target_date
      AND (
        assignment_type != 'checkout_cleaning' OR 
        (assignment_type = 'checkout_cleaning' AND ready_to_clean = true)
      )
    ),
    'completed', (
      SELECT COUNT(*) FROM public.room_assignments 
      WHERE assigned_to = user_id 
      AND assignment_date = target_date 
      AND status = 'completed'
      AND (
        assignment_type != 'checkout_cleaning' OR 
        (assignment_type = 'checkout_cleaning' AND ready_to_clean = true)
      )
    ),
    'in_progress', (
      SELECT COUNT(*) FROM public.room_assignments 
      WHERE assigned_to = user_id 
      AND assignment_date = target_date 
      AND status = 'in_progress'
      AND (
        assignment_type != 'checkout_cleaning' OR 
        (assignment_type = 'checkout_cleaning' AND ready_to_clean = true)
      )
    ),
    'pending', (
      SELECT COUNT(*) FROM public.room_assignments 
      WHERE assigned_to = user_id 
      AND assignment_date = target_date 
      AND status = 'assigned'
      AND (
        assignment_type != 'checkout_cleaning' OR 
        (assignment_type = 'checkout_cleaning' AND ready_to_clean = true)
      )
    )
  );
$function$;