-- Fix the delete_user_profile function to handle RLS properly
CREATE OR REPLACE FUNCTION public.delete_user_profile(p_user_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  result json;
  current_user_role public.user_role;
BEGIN
  -- Get the current user's role
  SELECT role INTO current_user_role FROM public.profiles WHERE id = auth.uid();
  
  -- Only allow admins to delete users
  IF current_user_role != 'admin' THEN
    RAISE EXCEPTION 'Only admins can delete users';
  END IF;
  
  -- Check if user exists
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'User not found';
  END IF;
  
  -- First, update any foreign key references to avoid constraint violations
  UPDATE public.rooms SET last_cleaned_by = NULL WHERE last_cleaned_by = p_user_id;
  UPDATE public.tickets SET assigned_to = NULL WHERE assigned_to = p_user_id;
  UPDATE public.tickets SET created_by = NULL WHERE created_by = p_user_id;
  UPDATE public.tickets SET closed_by = NULL WHERE closed_by = p_user_id;
  
  -- Delete related records that depend on the profile
  DELETE FROM public.room_assignments WHERE assigned_to = p_user_id;
  DELETE FROM public.room_assignments WHERE assigned_by = p_user_id;
  DELETE FROM public.housekeeping_performance WHERE housekeeper_id = p_user_id;
  DELETE FROM public.ticket_creation_config WHERE user_id = p_user_id;
  DELETE FROM public.housekeeping_notes WHERE created_by = p_user_id;
  DELETE FROM public.housekeeping_notes WHERE resolved_by = p_user_id;
  DELETE FROM public.comments WHERE user_id = p_user_id;
  DELETE FROM public.staff_attendance WHERE user_id = p_user_id;
  DELETE FROM public.notification_preferences WHERE user_id = p_user_id;
  DELETE FROM public.break_requests WHERE user_id = p_user_id;
  DELETE FROM public.break_requests WHERE requested_by = p_user_id;
  DELETE FROM public.break_requests WHERE approved_by = p_user_id;
  
  -- Finally delete the profile
  DELETE FROM public.profiles WHERE id = p_user_id;
  
  -- Verify deletion was successful
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'Failed to delete user profile';
  END IF;
  
  -- Return success result
  result := json_build_object(
    'success', true,
    'message', 'User deleted successfully'
  );
  
  RETURN result;
EXCEPTION
  WHEN OTHERS THEN
    -- Return error result
    result := json_build_object(
      'success', false,
      'error', SQLERRM
    );
    RETURN result;
END;
$function$;