-- Create a safer deletion function that reassigns NOT NULL references
CREATE OR REPLACE FUNCTION public.delete_user_profile_v2(
  p_user_id uuid,
  p_reassign_to uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  result json;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id is required';
  END IF;

  -- Ensure we have a valid reassignment target for NOT NULL columns (tickets.created_by)
  IF p_reassign_to IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_reassign_to) THEN
    -- Try to use any other admin as fallback
    SELECT id INTO p_reassign_to FROM public.profiles WHERE role = 'admin'::public.user_role AND id <> p_user_id LIMIT 1;
    IF p_reassign_to IS NULL THEN
      RAISE EXCEPTION 'No valid reassignment target found for created_by';
    END IF;
  END IF;

  -- Clear or reassign FKs before deleting the profile to avoid constraint violations
  UPDATE public.rooms SET last_cleaned_by = NULL WHERE last_cleaned_by = p_user_id;

  UPDATE public.tickets SET assigned_to = NULL WHERE assigned_to = p_user_id;
  UPDATE public.tickets SET created_by = p_reassign_to WHERE created_by = p_user_id; -- NOT NULL column
  UPDATE public.tickets SET closed_by = NULL WHERE closed_by = p_user_id;

  UPDATE public.room_minibar_usage SET recorded_by = NULL WHERE recorded_by = p_user_id;

  -- Delete dependent rows
  DELETE FROM public.room_assignments WHERE assigned_to = p_user_id;
  DELETE FROM public.room_assignments WHERE assigned_by = p_user_id;
  DELETE FROM public.housekeeping_performance WHERE housekeeper_id = p_user_id;
  DELETE FROM public.ticket_creation_config WHERE user_id = p_user_id;
  DELETE FROM public.housekeeping_notes WHERE created_by = p_user_id;
  DELETE FROM public.housekeeping_notes WHERE resolved_by = p_user_id;
  DELETE FROM public.comments WHERE user_id = p_user_id;
  DELETE FROM public.staff_attendance WHERE user_id = p_user_id;
  DELETE FROM public.notification_preferences WHERE user_id = p_user_id;
  DELETE FROM public.break_requests WHERE user_id = p_user_id OR requested_by = p_user_id OR approved_by = p_user_id;

  -- Finally delete the profile
  DELETE FROM public.profiles WHERE id = p_user_id;

  -- Verify
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'Failed to delete user profile';
  END IF;

  result := json_build_object('success', true, 'message', 'User deleted successfully');
  RETURN result;
EXCEPTION
  WHEN OTHERS THEN
    result := json_build_object('success', false, 'error', SQLERRM);
    RETURN result;
END;
$$;