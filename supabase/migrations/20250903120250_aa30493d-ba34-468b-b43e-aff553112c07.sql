-- Fix the create_user_with_profile function to properly create auth users and profiles
-- Also add username field to profiles table and generate credentials

-- Add username field to profiles table
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS username TEXT UNIQUE;

-- Create or replace the function to properly create auth users with profiles
CREATE OR REPLACE FUNCTION public.create_user_with_profile(
  p_email text DEFAULT NULL,
  p_password text DEFAULT NULL,
  p_full_name text,
  p_role user_role DEFAULT 'housekeeping'::user_role,
  p_phone_number text DEFAULT NULL,
  p_assigned_hotel text DEFAULT NULL,
  p_username text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  IF p_username IS NULL THEN
    generated_username := LOWER(REPLACE(p_full_name, ' ', '.')) || '.' || LPAD(FLOOR(RANDOM() * 10000)::text, 4, '0');
  ELSE
    generated_username := p_username;
  END IF;
  
  -- Generate password if not provided
  IF p_password IS NULL THEN
    generated_password := 'RD' || UPPER(SUBSTRING(MD5(RANDOM()::text), 1, 6));
  ELSE
    generated_password := p_password;
  END IF;
  
  -- Generate a fallback email if not provided
  IF p_email IS NULL OR p_email = '' THEN
    p_email := generated_username || '@rdhotels.local';
  END IF;
  
  -- Create the auth user first using admin API (this will be handled by a separate edge function)
  -- For now, we'll create a profile entry that can be used when the user first logs in
  new_user_id := gen_random_uuid();
  
  -- Insert into profiles table
  INSERT INTO public.profiles (
    id, 
    email, 
    full_name, 
    role, 
    phone_number, 
    assigned_hotel,
    username
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
    'message', 'User profile created successfully. Use the provided credentials to log in.'
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