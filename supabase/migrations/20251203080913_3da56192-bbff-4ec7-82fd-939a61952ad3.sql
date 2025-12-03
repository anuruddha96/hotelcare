-- Update the delete_user_profile_v2 function to handle dnd_photos
CREATE OR REPLACE FUNCTION public.delete_user_profile_v2(p_user_id uuid, p_reassign_to uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result json;
BEGIN
  -- Delete or reassign dnd_photos (marked_by references profiles)
  DELETE FROM public.dnd_photos WHERE marked_by = p_user_id;
  
  -- Delete dirty_linen_counts for this user
  DELETE FROM public.dirty_linen_counts WHERE housekeeper_id = p_user_id;
  
  -- Delete housekeeper_ratings where user is the housekeeper or rater
  DELETE FROM public.housekeeper_ratings WHERE housekeeper_id = p_user_id OR rated_by = p_user_id;
  
  -- Delete housekeeping_performance records
  DELETE FROM public.housekeeping_performance WHERE housekeeper_id = p_user_id;
  
  -- Delete housekeeping_notes created by this user
  DELETE FROM public.housekeeping_notes WHERE created_by = p_user_id;
  
  -- Delete lost_and_found reported by this user
  DELETE FROM public.lost_and_found WHERE reported_by = p_user_id;
  
  -- Delete maintenance_issues reported by this user
  DELETE FROM public.maintenance_issues WHERE reported_by = p_user_id;
  
  -- Delete room_minibar_usage recorded by this user
  DELETE FROM public.room_minibar_usage WHERE recorded_by = p_user_id;
  
  -- Delete staff_attendance records
  DELETE FROM public.staff_attendance WHERE user_id = p_user_id;
  
  -- Delete break_requests
  DELETE FROM public.break_requests WHERE user_id = p_user_id OR requested_by = p_user_id OR approved_by = p_user_id;
  
  -- Delete early_signout_requests
  DELETE FROM public.early_signout_requests WHERE user_id = p_user_id OR approved_by = p_user_id;
  
  -- Delete notification_preferences
  DELETE FROM public.notification_preferences WHERE user_id = p_user_id;
  
  -- Delete general_tasks assigned to or by this user
  DELETE FROM public.general_tasks WHERE assigned_to = p_user_id OR assigned_by = p_user_id;
  
  -- Reassign room_assignments to the new user
  UPDATE public.room_assignments SET assigned_to = p_reassign_to WHERE assigned_to = p_user_id;
  UPDATE public.room_assignments SET assigned_by = p_reassign_to WHERE assigned_by = p_user_id;
  UPDATE public.room_assignments SET dnd_marked_by = NULL WHERE dnd_marked_by = p_user_id;
  UPDATE public.room_assignments SET supervisor_approved_by = NULL WHERE supervisor_approved_by = p_user_id;
  
  -- Reassign tickets
  UPDATE public.tickets SET assigned_to = p_reassign_to WHERE assigned_to = p_user_id;
  UPDATE public.tickets SET created_by = p_reassign_to WHERE created_by = p_user_id;
  UPDATE public.tickets SET closed_by = NULL WHERE closed_by = p_user_id;
  
  -- Reassign comments
  UPDATE public.comments SET user_id = p_reassign_to WHERE user_id = p_user_id;
  
  -- Update rooms last_cleaned_by
  UPDATE public.rooms SET last_cleaned_by = NULL WHERE last_cleaned_by = p_user_id;
  UPDATE public.rooms SET dnd_marked_by = NULL WHERE dnd_marked_by = p_user_id;
  
  -- Update pms_sync_history
  UPDATE public.pms_sync_history SET changed_by = NULL WHERE changed_by = p_user_id;
  
  -- Update pms_upload_summary
  UPDATE public.pms_upload_summary SET uploaded_by = p_reassign_to WHERE uploaded_by = p_user_id;
  
  -- Finally delete the profile
  DELETE FROM public.profiles WHERE id = p_user_id;
  
  RETURN json_build_object('success', true);
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;