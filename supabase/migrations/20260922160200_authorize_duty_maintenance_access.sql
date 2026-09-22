-- #346. The browser's selected hotel is presentation state, NOT authority.
-- Existing department permissions still apply. A validated active duty session
-- can only substitute the assigned hotel, never the user's role/department.
CREATE OR REPLACE FUNCTION public.has_active_property_duty(
  _organization_slug text, _ticket_hotel text
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.organizations o ON o.slug = p.organization_slug AND o.is_active = true
    JOIN public.property_duty_sessions s ON s.user_id = p.id
      AND s.organization_id = o.id AND s.ended_at IS NULL AND s.expires_at > now()
    JOIN public.property_duty_grants g ON g.user_id = p.id
      AND g.organization_id = o.id AND g.hotel_configuration_id = s.hotel_configuration_id
      AND g.revoked_at IS NULL
    JOIN public.hotel_configurations h ON h.id = s.hotel_configuration_id
      AND h.organization_id = o.id AND h.is_active = true
    WHERE p.id = auth.uid() AND p.deleted_at IS NULL
      AND p.organization_slug = _organization_slug
      AND p.role::text IN ('maintenance','maintenance_manager','reception','reception_manager',
        'front_office','manager','admin','top_management','top_management_manager')
      AND public.maintenance_hotel_matches(h.hotel_id, _ticket_hotel, o.slug)
  );
$fn$;
REVOKE ALL ON FUNCTION public.has_active_property_duty(text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_active_property_duty(text,text) TO authenticated;

-- An overriding permissive policy left behind from an earlier migration must
-- not bypass tenant boundaries. Restrictive policies AND with all permissive
-- ticket rules, including historical or future rules, for authenticated users.
DROP POLICY IF EXISTS property_duty_tenant_boundary ON public.tickets;
CREATE POLICY property_duty_tenant_boundary ON public.tickets
AS RESTRICTIVE FOR ALL TO authenticated
USING (
  public.is_super_admin(auth.uid())
  OR (organization_slug IS NOT NULL AND organization_slug = public.get_user_organization_slug(auth.uid()))
)
WITH CHECK (
  public.is_super_admin(auth.uid())
  OR (organization_slug IS NOT NULL AND organization_slug = public.get_user_organization_slug(auth.uid()))
);

-- Preserve the existing role-specific access config; a cross-property duty
-- extends only the hotel_only or assigned_and_created location predicate.
DROP POLICY IF EXISTS "Users can view tickets based on access config" ON public.tickets;
CREATE POLICY "Users can view tickets based on access config" ON public.tickets
FOR SELECT TO authenticated USING (
  public.is_super_admin(auth.uid())
  OR (
    organization_slug = public.get_user_organization_slug(auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.get_user_access_config(public.get_user_role(auth.uid())) AS config(
        department, access_scope, can_manage_all
      )
      WHERE config.can_manage_all = true
        OR (
          (config.department = 'all' OR config.department = tickets.department
            OR (config.department = 'front_office' AND tickets.department = 'reception'))
          AND (
            config.access_scope = 'all_hotels'
            OR (config.access_scope = 'hotel_only'
              AND (
                public.get_hotel_name_from_id(public.get_user_assigned_hotel(auth.uid())) =
                  public.get_hotel_name_from_id(tickets.hotel)
                OR public.has_active_property_duty(tickets.organization_slug, tickets.hotel)
              ))
            OR (config.access_scope = 'assigned_and_created'
              AND (
                tickets.assigned_to = auth.uid() OR tickets.created_by = auth.uid()
                OR (
                  config.department = tickets.department
                  AND (
                    public.get_hotel_name_from_id(public.get_user_assigned_hotel(auth.uid())) =
                      public.get_hotel_name_from_id(tickets.hotel)
                    OR public.has_active_property_duty(tickets.organization_slug, tickets.hotel)
                  )
                )
              ))
          )
        )
    )
  )
);

-- Private ticket-attachments signing uses this predicate. Keep both the
-- organization and the configured department permission requirement.
CREATE OR REPLACE FUNCTION public.user_can_view_ticket(ticket_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.tickets t
    JOIN public.profiles p ON p.id = auth.uid() AND p.deleted_at IS NULL
    WHERE t.id = ticket_id
      AND t.organization_slug = p.organization_slug
      AND EXISTS (
        SELECT 1 FROM public.get_user_access_config(p.role) cfg
        WHERE cfg.can_manage_all = true
          OR ((cfg.department = 'all' OR cfg.department = t.department
                OR (cfg.department = 'front_office' AND t.department = 'reception'))
            AND (
              cfg.access_scope = 'all_hotels'
              OR (cfg.access_scope = 'hotel_only'
                AND ((p.assigned_hotel IS NOT NULL AND
                  public.get_hotel_name_from_id(p.assigned_hotel) = public.get_hotel_name_from_id(t.hotel))
                  OR public.has_active_property_duty(t.organization_slug, t.hotel)))
              OR (cfg.access_scope = 'assigned_and_created'
                AND (t.assigned_to = p.id OR t.created_by = p.id
                  OR (cfg.department = t.department
                    AND ((p.assigned_hotel IS NOT NULL AND
                      public.get_hotel_name_from_id(p.assigned_hotel) = public.get_hotel_name_from_id(t.hotel))
                      OR public.has_active_property_duty(t.organization_slug, t.hotel)))))
            ))
      )
  );
$fn$;
REVOKE ALL ON FUNCTION public.user_can_view_ticket(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_can_view_ticket(uuid) TO authenticated;
