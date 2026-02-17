
-- Allow reception to view rooms in their organization
CREATE POLICY "Reception can view rooms in their organization"
ON public.rooms FOR SELECT
USING (
  get_user_role(auth.uid()) = 'reception'::user_role
  AND organization_slug = get_user_organization_slug(auth.uid())
);

-- Allow reception to view profiles in their organization
CREATE POLICY "Reception can view profiles in organization"
ON public.profiles FOR SELECT
USING (
  get_user_role(auth.uid()) = 'reception'::user_role
  AND organization_slug = get_user_organization_slug(auth.uid())
);
