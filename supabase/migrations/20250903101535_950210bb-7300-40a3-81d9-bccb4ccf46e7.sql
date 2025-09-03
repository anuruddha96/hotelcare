-- Add phone_number field to profiles table
ALTER TABLE public.profiles ADD COLUMN phone_number text;

-- Make email field optional in profiles table (it's already nullable but let's ensure it)
-- Update the trigger function to handle optional email during profile creation
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
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
$$;