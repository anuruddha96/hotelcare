-- The top_management_manager role currently has no ticket access_config rows,
-- so an UPDATE policy alone cannot make a maintenance approval visible/updatable.
-- Only add read access to maintenance tickets for the manager's own Gozsdu
-- property and organization. Do not expose other properties or departments.
CREATE POLICY "Gozsdu top managers view maintenance"
ON public.tickets FOR SELECT TO authenticated
USING (
  hotel = 'gozsdu-court'
  AND organization_slug = 'rdhotels'
  AND department = 'maintenance'
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role::text = 'top_management_manager'
      AND p.organization_slug = 'rdhotels'
      AND p.assigned_hotel = 'gozsdu-court'
  )
);