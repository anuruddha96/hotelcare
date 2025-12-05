-- Add RLS policy for managers to view their own organization
-- This allows managers to see organization data needed for hotel dropdowns

CREATE POLICY "Users can view their own organization"
ON public.organizations
FOR SELECT
TO authenticated
USING (
  slug = get_user_organization_slug(auth.uid())
);