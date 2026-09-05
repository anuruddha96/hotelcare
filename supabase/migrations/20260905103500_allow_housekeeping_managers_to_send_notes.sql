-- Keep DB permissions aligned with the app's manager-power roles.
DROP POLICY IF EXISTS "Operational housekeeping managers can create notes" ON public.housekeeping_notes;
CREATE POLICY "Operational housekeeping managers can create notes"
ON public.housekeeping_notes
FOR INSERT
TO authenticated
WITH CHECK (
  public.get_user_role(auth.uid()) = 'housekeeping_manager'::public.user_role
  AND created_by = auth.uid()
  AND (
    organization_slug IS NULL
    OR organization_slug = public.get_user_organization_slug(auth.uid())
  )
);
