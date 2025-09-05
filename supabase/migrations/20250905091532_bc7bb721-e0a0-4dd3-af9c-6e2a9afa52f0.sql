-- First, clear all foreign key references for Svetlana's profile before deletion
UPDATE rooms SET last_cleaned_by = NULL WHERE last_cleaned_by = '1aaa01d2-49ca-4d84-8c04-9c6ab1a8be31';
UPDATE tickets SET assigned_to = NULL WHERE assigned_to = '1aaa01d2-49ca-4d84-8c04-9c6ab1a8be31';
UPDATE tickets SET created_by = NULL WHERE created_by = '1aaa01d2-49ca-4d84-8c04-9c6ab1a8be31';  
UPDATE tickets SET closed_by = NULL WHERE closed_by = '1aaa01d2-49ca-4d84-8c04-9c6ab1a8be31';

-- Delete related records that depend on the profile
DELETE FROM room_assignments WHERE assigned_to = '1aaa01d2-49ca-4d84-8c04-9c6ab1a8be31';
DELETE FROM housekeeping_performance WHERE housekeeper_id = '1aaa01d2-49ca-4d84-8c04-9c6ab1a8be31';
DELETE FROM ticket_creation_config WHERE user_id = '1aaa01d2-49ca-4d84-8c04-9c6ab1a8be31';
DELETE FROM housekeeping_notes WHERE created_by = '1aaa01d2-49ca-4d84-8c04-9c6ab1a8be31';
DELETE FROM comments WHERE user_id = '1aaa01d2-49ca-4d84-8c04-9c6ab1a8be31';

-- Update the delete user function to handle all foreign key constraints properly
CREATE OR REPLACE FUNCTION public.delete_user_profile(p_user_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  result json;
BEGIN
  -- Only allow admins to delete users
  IF get_current_user_role() != 'admin' THEN
    RAISE EXCEPTION 'Only admins can delete users';
  END IF;
  
  -- First, update any foreign key references to avoid constraint violations
  UPDATE rooms SET last_cleaned_by = NULL WHERE last_cleaned_by = p_user_id;
  UPDATE tickets SET assigned_to = NULL WHERE assigned_to = p_user_id;
  UPDATE tickets SET created_by = NULL WHERE created_by = p_user_id;
  UPDATE tickets SET closed_by = NULL WHERE closed_by = p_user_id;
  
  -- Delete related records that depend on the profile
  DELETE FROM room_assignments WHERE assigned_to = p_user_id;
  DELETE FROM room_assignments WHERE assigned_by = p_user_id;
  DELETE FROM housekeeping_performance WHERE housekeeper_id = p_user_id;
  DELETE FROM ticket_creation_config WHERE user_id = p_user_id;
  DELETE FROM housekeeping_notes WHERE created_by = p_user_id;
  DELETE FROM housekeeping_notes WHERE resolved_by = p_user_id;
  DELETE FROM comments WHERE user_id = p_user_id;
  
  -- Finally delete the profile
  DELETE FROM public.profiles WHERE id = p_user_id;
  
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
$$;