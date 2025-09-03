-- Create a function to handle user creation with proper service role permissions
CREATE OR REPLACE FUNCTION public.create_user_with_profile(
  p_email text,
  p_password text,
  p_full_name text,
  p_role user_role DEFAULT 'housekeeping',
  p_phone_number text DEFAULT NULL,
  p_assigned_hotel text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_user_id uuid;
  result json;
BEGIN
  -- Only allow admins and housekeeping managers to create users
  IF NOT (get_current_user_role() = ANY(ARRAY['admin'::user_role, 'housekeeping_manager'::user_role])) THEN
    RAISE EXCEPTION 'Insufficient permissions to create users';
  END IF;
  
  -- Housekeeping managers can only create housekeeping staff
  IF get_current_user_role() = 'housekeeping_manager' AND p_role != 'housekeeping' THEN
    RAISE EXCEPTION 'Housekeeping managers can only create housekeeping staff';
  END IF;
  
  -- Generate a new UUID for the user
  new_user_id := gen_random_uuid();
  
  -- Insert into profiles table (the auth trigger will handle user creation)
  INSERT INTO public.profiles (
    id, 
    email, 
    full_name, 
    role, 
    phone_number, 
    assigned_hotel
  ) VALUES (
    new_user_id,
    COALESCE(p_email, ''),
    p_full_name,
    p_role,
    p_phone_number,
    CASE 
      WHEN p_assigned_hotel = 'none' OR p_assigned_hotel = '' THEN NULL 
      ELSE p_assigned_hotel 
    END
  );
  
  -- Return success result
  result := json_build_object(
    'success', true,
    'user_id', new_user_id,
    'message', 'User profile created successfully'
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

-- Create a function to delete users (admin only)
CREATE OR REPLACE FUNCTION public.delete_user_profile(p_user_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result json;
BEGIN
  -- Only allow admins to delete users
  IF get_current_user_role() != 'admin' THEN
    RAISE EXCEPTION 'Only admins can delete users';
  END IF;
  
  -- Delete from profiles (cascade will handle related data)
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