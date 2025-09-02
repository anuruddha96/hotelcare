-- Add admin-only deletion policies for users and tickets

-- 1. Allow only admins to delete user profiles
CREATE POLICY "Only admins can delete profiles" 
ON public.profiles 
FOR DELETE 
USING (get_user_role(auth.uid()) = 'admin'::user_role);

-- 2. Allow only admins to delete tickets  
CREATE POLICY "Only admins can delete tickets" 
ON public.tickets 
FOR DELETE 
USING (get_user_role(auth.uid()) = 'admin'::user_role);