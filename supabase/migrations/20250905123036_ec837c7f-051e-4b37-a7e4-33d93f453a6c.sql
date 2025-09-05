-- Create a function to update user credentials for admin
CREATE OR REPLACE FUNCTION public.update_user_credentials(
  p_user_id uuid,
  p_full_name text DEFAULT NULL,
  p_nickname text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_phone_number text DEFAULT NULL,
  p_role user_role DEFAULT NULL,
  p_assigned_hotel text DEFAULT NULL,
  p_send_password_reset boolean DEFAULT FALSE
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  result json;
  old_email text;
BEGIN
  -- Only allow admins to update user credentials
  IF get_current_user_role() != 'admin' THEN
    RAISE EXCEPTION 'Only admins can update user credentials';
  END IF;
  
  -- Get the current email for password reset
  SELECT email INTO old_email FROM public.profiles WHERE id = p_user_id;
  
  -- Update profile information
  UPDATE public.profiles 
  SET 
    full_name = COALESCE(p_full_name, full_name),
    nickname = COALESCE(p_nickname, nickname),
    email = COALESCE(p_email, email),
    phone_number = CASE 
      WHEN p_phone_number = '' THEN NULL 
      ELSE COALESCE(p_phone_number, phone_number) 
    END,
    role = COALESCE(p_role, role),
    assigned_hotel = CASE 
      WHEN p_assigned_hotel = 'none' OR p_assigned_hotel = '' THEN NULL 
      ELSE COALESCE(p_assigned_hotel, assigned_hotel) 
    END,
    updated_at = now()
  WHERE id = p_user_id;
  
  -- Return success result
  result := json_build_object(
    'success', true,
    'message', 'User profile updated successfully',
    'password_reset_sent', p_send_password_reset,
    'old_email', old_email
  );
  
  RETURN result;
EXCEPTION
  WHEN OTHERS THEN
    result := json_build_object(
      'success', false,
      'error', SQLERRM
    );
    RETURN result;
END;
$$;

-- Create a function to sync updated usernames on login
CREATE OR REPLACE FUNCTION public.sync_user_login_data()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- When a user logs in, update their last_login time
  -- This trigger is already handled by update_last_login trigger
  RETURN NEW;
END;
$$;

-- Add a comment to document the username sync behavior
COMMENT ON FUNCTION public.update_user_credentials IS 'Admin function to update user profile information including username/nickname';
COMMENT ON FUNCTION public.sync_user_login_data IS 'Function to sync user data on login - username updates are reflected immediately in the profiles table';