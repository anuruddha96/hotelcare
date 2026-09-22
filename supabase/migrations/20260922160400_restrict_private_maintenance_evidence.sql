-- #346. Several historical storage policies checked manager role but did not
-- scope storage.object mutation to the ticket's organization/property. A
-- RESTRICTIVE policy ANDs with all existing permissive storage policies.
-- Other storage buckets are untouched; ticket-attachments stays private.
DROP POLICY IF EXISTS property_duty_private_ticket_evidence_boundary ON storage.objects;
CREATE POLICY property_duty_private_ticket_evidence_boundary
ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated
USING (
  bucket_id <> 'ticket-attachments'
  OR (
    split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND public.user_can_view_ticket(split_part(name, '/', 1)::uuid)
  )
)
WITH CHECK (
  bucket_id <> 'ticket-attachments'
  OR (
    split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND public.user_can_view_ticket(split_part(name, '/', 1)::uuid)
  )
);

-- More restrictive INSERT, UPDATE and DELETE grant checks preserve existing
-- creator/assignee behavior while removing the legacy role-only manager path.
DROP POLICY IF EXISTS "Users can upload ticket attachments for accessible tickets" ON storage.objects;
CREATE POLICY "Users can upload ticket attachments for accessible tickets"
ON storage.objects FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'ticket-attachments'
  AND split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND public.user_can_view_ticket(split_part(name, '/', 1)::uuid)
  AND EXISTS (
    SELECT 1 FROM public.tickets t
    WHERE t.id = split_part(name, '/', 1)::uuid
      AND t.organization_slug = public.get_user_organization_slug(auth.uid())
      AND (t.created_by = auth.uid() OR t.assigned_to = auth.uid()
        OR public.get_user_role(auth.uid())::text IN (
          'admin','manager','top_management','top_management_manager','maintenance_manager'))
  )
);

DROP POLICY IF EXISTS "Managers can update ticket attachments" ON storage.objects;
CREATE POLICY "Managers can update ticket attachments" ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'ticket-attachments'
  AND split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND public.user_can_view_ticket(split_part(name, '/', 1)::uuid)
  AND public.get_user_role(auth.uid())::text IN
    ('admin','manager','top_management','top_management_manager','maintenance_manager')
)
WITH CHECK (
  bucket_id = 'ticket-attachments'
  AND split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND public.user_can_view_ticket(split_part(name, '/', 1)::uuid)
);

DROP POLICY IF EXISTS "Managers can delete ticket attachments" ON storage.objects;
CREATE POLICY "Managers can delete ticket attachments" ON storage.objects
FOR DELETE TO authenticated USING (
  bucket_id = 'ticket-attachments'
  AND split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND public.user_can_view_ticket(split_part(name, '/', 1)::uuid)
  AND public.get_user_role(auth.uid())::text IN
    ('admin','manager','top_management','top_management_manager','maintenance_manager')
);
