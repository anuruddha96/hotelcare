-- Fix maintenance/general ticket creation for hotel-scoped managers when
-- profiles.assigned_hotel stores a canonical slug (for example
-- "memories-budapest") but the ticket form submits the display name
-- (for example "Hotel Memories Budapest").
--
-- The previous RLS policy compared the two raw values in the wrong direction:
--   assigned_hotel = hotel
--   assigned_hotel = get_hotel_name_from_id(hotel)
-- When `hotel` was already the display name, both checks failed and the INSERT
-- was rejected even though the manager had ticket-creation permission.

DROP POLICY IF EXISTS "Secure ticket creation" ON public.tickets;

CREATE POLICY "Secure ticket creation"
ON public.tickets
FOR INSERT
TO public
WITH CHECK (
  public.is_super_admin(auth.uid())
  OR (
    organization_slug = public.get_user_organization_slug(auth.uid())
    AND public.get_user_role(auth.uid()) = ANY (
      ARRAY[
        'housekeeping'::public.user_role,
        'housekeeping_manager'::public.user_role,
        'reception'::public.user_role,
        'maintenance'::public.user_role,
        'manager'::public.user_role,
        'admin'::public.user_role,
        'marketing'::public.user_role,
        'control_finance'::public.user_role,
        'hr'::public.user_role,
        'front_office'::public.user_role,
        'top_management'::public.user_role,
        'top_management_manager'::public.user_role
      ]
    )
    AND created_by = auth.uid()
    AND (
      public.get_user_role(auth.uid()) = ANY (
        ARRAY[
          'admin'::public.user_role,
          'top_management'::public.user_role,
          'top_management_manager'::public.user_role
        ]
      )
      OR public.get_hotel_name_from_id((
        SELECT p.assigned_hotel
        FROM public.profiles p
        WHERE p.id = auth.uid()
      )) = public.get_hotel_name_from_id(hotel)
    )
    AND public.has_ticket_creation_permission(auth.uid())
  )
);

COMMENT ON POLICY "Secure ticket creation" ON public.tickets IS
  'Allows permitted users to create tickets within their organization. Hotel-scoped users are matched by normalized hotel identity so slug/display-name differences do not block valid inserts.';
