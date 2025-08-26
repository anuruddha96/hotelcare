-- Add new manager roles to user_role enum
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'housekeeping_manager';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'maintenance_manager';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'marketing_manager';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'reception_manager';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'back_office_manager';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'control_manager';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'finance_manager';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'top_management_manager';

-- Add department field to tickets
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS department text;

-- Add last_login field to profiles for auto-assignment logic
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_login timestamp with time zone DEFAULT now();

-- Create function to update last login
CREATE OR REPLACE FUNCTION public.update_last_login()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  UPDATE public.profiles 
  SET last_login = now() 
  WHERE id = NEW.id;
  RETURN NEW;
END;
$function$;

-- Create trigger to update last login when user signs in
DROP TRIGGER IF EXISTS on_auth_user_login ON auth.users;
CREATE TRIGGER on_auth_user_login
  AFTER UPDATE ON auth.users
  FOR EACH ROW 
  WHEN (OLD.last_sign_in_at IS DISTINCT FROM NEW.last_sign_in_at)
  EXECUTE FUNCTION public.update_last_login();