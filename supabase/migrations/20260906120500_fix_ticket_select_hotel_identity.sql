-- The Create Ticket flow performs INSERT ... RETURNING via Supabase `.select()`.
-- PostgreSQL therefore also evaluates the tickets SELECT RLS policy against the
-- newly inserted row. Hotel-scoped managers were still blocked there when the
-- profile stored a slug (for example `memories-budapest`) and the ticket stored
-- the display name (`Hotel Memories Budapest`).
--
-- Normalize both hotel identifiers before comparing them, for both `hotel_only`
-- and `assigned_and_created` access scopes.

DROP POLICY IF EXISTS "Users can view tickets based on access config" ON public.tickets;

CREATE POLICY "Users can view tickets based on access config"
ON public.tickets
FOR SELECT
TO public
USING (
  public.is_super_admin(auth.uid())
  OR (
    organization_slug = public.get_user_organization_slug(auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.get_user_access_config(public.get_user_role(auth.uid())) AS config(
        department,
        access_scope,
        can_manage_all
      )
      WHERE
        config.can_manage_all = true
        OR (
          (
            config.department = 'all'
            OR config.department = tickets.department
            OR (config.department = 'front_office' AND tickets.department = 'reception')
          )
          AND (
            config.access_scope = 'all_hotels'
            OR (
              config.access_scope = 'hotel_only'
              AND public.get_hotel_name_from_id((
                SELECT p.assigned_hotel
                FROM public.profiles p
                WHERE p.id = auth.uid()
              )) = public.get_hotel_name_from_id(tickets.hotel)
            )
            OR (
              config.access_scope = 'assigned_and_created'
              AND (
                tickets.assigned_to = auth.uid()
                OR tickets.created_by = auth.uid()
                OR (
                  public.get_hotel_name_from_id((
                    SELECT p.assigned_hotel
                    FROM public.profiles p
                    WHERE p.id = auth.uid()
                  )) = public.get_hotel_name_from_id(tickets.hotel)
                  AND config.department = tickets.department
                )
              )
            )
          )
        )
    )
  )
);

COMMENT ON POLICY "Users can view tickets based on access config" ON public.tickets IS
  'Ticket visibility follows role access config and compares hotel scope using normalized hotel identifiers so slug/display-name differences do not block valid access or INSERT RETURNING.';
