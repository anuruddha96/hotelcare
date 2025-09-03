-- Create a non-ambiguous v2 function for creating users with optional credential generation
-- This avoids conflicts between two existing create_user_with_profile overloads
CREATE OR REPLACE FUNCTION public.create_user_with_profile_v2(
  p_full_name text,
  p_role user_role DEFAULT 'housekeeping'::user_role,
  p_email text DEFAULT NULL::text,
  p_password text DEFAULT NULL::text,
  p_phone_number text DEFAULT NULL::text,
  p_assigned_hotel text DEFAULT NULL::text,
  p_username text DEFAULT NULL::text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_user_id uuid;
  generated_username text;
  generated_password text;
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
  
  -- Generate username if not provided
  IF p_username IS NULL OR length(trim(p_username)) = 0 THEN
    generated_username := LOWER(REPLACE(p_full_name, ' ', '.')) || '.' || LPAD(FLOOR(RANDOM() * 10000)::text, 4, '0');
  ELSE
    generated_username := p_username;
  END IF;
  
  -- Generate password if not provided
  IF p_password IS NULL OR length(trim(p_password)) = 0 THEN
    generated_password := 'RD' || UPPER(SUBSTRING(MD5(RANDOM()::text), 1, 6));
  ELSE
    generated_password := p_password;
  END IF;
  
  -- Generate a fallback email if not provided
  IF p_email IS NULL OR p_email = '' THEN
    p_email := generated_username || '@rdhotels.local';
  END IF;
  
  -- Create a UUID for the user profile (not linked to auth.users yet)
  new_user_id := gen_random_uuid();
  
  -- Insert into profiles table (this creates a "pending" user profile)
  INSERT INTO public.profiles (
    id, 
    email, 
    full_name, 
    role, 
    phone_number, 
    assigned_hotel,
    nickname
  ) VALUES (
    new_user_id,
    p_email,
    p_full_name,
    p_role,
    p_phone_number,
    CASE 
      WHEN p_assigned_hotel = 'none' OR p_assigned_hotel = '' THEN NULL 
      ELSE p_assigned_hotel 
    END,
    generated_username
  );
  
  -- Return success result with credentials
  result := json_build_object(
    'success', true,
    'user_id', new_user_id,
    'username', generated_username,
    'password', generated_password,
    'email', p_email,
    'message', 'User profile created successfully. Provide these credentials to the housekeeper for login.'
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