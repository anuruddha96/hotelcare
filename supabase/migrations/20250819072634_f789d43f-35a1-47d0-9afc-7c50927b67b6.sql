-- Grant managers similar privileges as admins on profiles
-- and create a trigger to ensure profiles are created on signup

-- Create policies for managers on profiles
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'Managers can view all profiles'
  ) THEN
    CREATE POLICY "Managers can view all profiles"
    ON public.profiles
    FOR SELECT
    USING (get_user_role(auth.uid()) = 'manager'::user_role);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'Managers can update all profiles'
  ) THEN
    CREATE POLICY "Managers can update all profiles"
    ON public.profiles
    FOR UPDATE
    USING (get_user_role(auth.uid()) = 'manager'::user_role);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'Managers can insert profiles'
  ) THEN
    CREATE POLICY "Managers can insert profiles"
    ON public.profiles
    FOR INSERT
    WITH CHECK (get_user_role(auth.uid()) = 'manager'::user_role);
  END IF;
END $$;

-- Safely create trigger on auth.users to populate profiles via existing function
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE t.tgname = 'on_auth_user_created' AND n.nspname = 'auth'
  ) THEN
    CREATE TRIGGER on_auth_user_created
      AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
  END IF;
END $$;