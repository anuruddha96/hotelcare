DROP POLICY IF EXISTS "own threads" ON public.assistant_threads;
CREATE POLICY "own scoped threads"
ON public.assistant_threads
FOR ALL
TO authenticated
USING (
  user_id = auth.uid()
  AND organization_slug IS NOT DISTINCT FROM public.pi_user_org()
  AND hotel_id IS NOT DISTINCT FROM public.pi_user_hotel()
)
WITH CHECK (
  user_id = auth.uid()
  AND organization_slug IS NOT DISTINCT FROM public.pi_user_org()
  AND hotel_id IS NOT DISTINCT FROM public.pi_user_hotel()
);

DROP POLICY IF EXISTS "own messages" ON public.assistant_messages;
REVOKE INSERT, UPDATE, DELETE ON public.assistant_messages FROM authenticated;
GRANT SELECT ON public.assistant_messages TO authenticated;
CREATE POLICY "read messages from own scoped threads"
ON public.assistant_messages
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.assistant_threads t
    WHERE t.id = assistant_messages.thread_id
      AND t.user_id = auth.uid()
      AND t.organization_slug IS NOT DISTINCT FROM public.pi_user_org()
      AND t.hotel_id IS NOT DISTINCT FROM public.pi_user_hotel()
  )
);

DROP POLICY IF EXISTS "requester reads own" ON public.assistant_access_requests;
DROP POLICY IF EXISTS "requester creates own" ON public.assistant_access_requests;
DROP POLICY IF EXISTS "approvers read org" ON public.assistant_access_requests;
DROP POLICY IF EXISTS "approvers decide org" ON public.assistant_access_requests;

CREATE POLICY "requester reads own scoped requests"
ON public.assistant_access_requests
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  AND organization_slug IS NOT DISTINCT FROM public.pi_user_org()
  AND hotel_id IS NOT DISTINCT FROM public.pi_user_hotel()
);

CREATE POLICY "requester creates own scoped requests"
ON public.assistant_access_requests
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND organization_slug IS NOT DISTINCT FROM public.pi_user_org()
  AND hotel_id IS NOT DISTINCT FROM public.pi_user_hotel()
  AND requested_scope IN ('revenue', 'housekeeping', 'maintenance', 'reception')
  AND status = 'pending'
  AND decided_by IS NULL
  AND decided_at IS NULL
  AND expires_at IS NULL
);

CREATE POLICY "same hotel approvers read requests"
ON public.assistant_access_requests
FOR SELECT
TO authenticated
USING (
  organization_slug IS NOT DISTINCT FROM public.pi_user_org()
  AND hotel_id IS NOT DISTINCT FROM public.pi_user_hotel()
  AND (
    public.pi_user_role()::text IN ('admin', 'top_management', 'top_management_manager', 'manager')
    OR (public.pi_user_role()::text = 'supervisor' AND requested_scope = 'housekeeping')
  )
);

CREATE POLICY "same hotel approvers decide requests"
ON public.assistant_access_requests
FOR UPDATE
TO authenticated
USING (
  organization_slug IS NOT DISTINCT FROM public.pi_user_org()
  AND hotel_id IS NOT DISTINCT FROM public.pi_user_hotel()
  AND status = 'pending'
  AND (
    public.pi_user_role()::text IN ('admin', 'top_management', 'top_management_manager', 'manager')
    OR (public.pi_user_role()::text = 'supervisor' AND requested_scope = 'housekeeping')
  )
)
WITH CHECK (
  organization_slug IS NOT DISTINCT FROM public.pi_user_org()
  AND hotel_id IS NOT DISTINCT FROM public.pi_user_hotel()
  AND user_id <> auth.uid()
  AND status IN ('approved', 'declined')
  AND decided_by = auth.uid()
  AND decided_at IS NOT NULL
  AND (
    public.pi_user_role()::text IN ('admin', 'top_management', 'top_management_manager', 'manager')
    OR (public.pi_user_role()::text = 'supervisor' AND requested_scope = 'housekeeping')
  )
);