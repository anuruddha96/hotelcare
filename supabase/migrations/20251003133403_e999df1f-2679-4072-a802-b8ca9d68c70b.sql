-- Phase 1: Make anuruddha.dharmasena@gmail.com a super admin
UPDATE public.profiles 
SET is_super_admin = true 
WHERE email = 'anuruddha.dharmasena@gmail.com';

-- Update organizations RLS policies to allow super admins
DROP POLICY IF EXISTS "Admins can manage organizations" ON public.organizations;

CREATE POLICY "Super admins can manage organizations" ON public.organizations
FOR ALL 
USING (public.is_super_admin(auth.uid()) = true)
WITH CHECK (public.is_super_admin(auth.uid()) = true);

CREATE POLICY "Admins and super admins can view organizations" ON public.organizations
FOR SELECT 
USING (
  public.get_user_role(auth.uid()) = 'admin'::public.user_role 
  OR public.is_super_admin(auth.uid()) = true
);

-- Phase 2: Fix organization slug mismatch (rd-hotels -> rdhotels)
UPDATE public.organizations 
SET slug = 'rdhotels' 
WHERE slug = 'rd-hotels';

-- Also update hotel_configurations to use consistent naming
UPDATE public.hotel_configurations
SET organization_id = (SELECT id FROM public.organizations WHERE slug = 'rdhotels')
WHERE organization_id IN (SELECT id FROM public.organizations WHERE slug = 'rdhotels');