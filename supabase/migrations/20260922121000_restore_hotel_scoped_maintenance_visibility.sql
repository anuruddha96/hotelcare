-- Restore canonical maintenance visibility after the two views began using the
-- same tenant/hotel-scoped ticket query. Existing manager access is unchanged.
-- The top_management_manager role has no department_access_config rows in the
-- live project: ticket RLS silently returns zero despite six real Memories rows.
INSERT INTO public.department_access_config (role, department, access_scope, can_manage_all)
VALUES ('top_management_manager'::public.user_role, 'maintenance', 'hotel_only', false)
ON CONFLICT (role, department) DO NOTHING;

-- The previous signed-photo authorization compared the raw assigned hotel slug
-- to the ticket's display name; this denied photos even to managers allowed to
-- read the issue. Normalize BOTH aliases and require the same organization.
-- Preserve current department/access-scope semantics for every other role.
CREATE OR REPLACE FUNCTION public.user_can_view_ticket(ticket_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.tickets t
    JOIN public.profiles p ON p.id = auth.uid()
    WHERE t.id = ticket_id
      AND t.organization_slug = p.organization_slug
      AND EXISTS (
        SELECT 1
        FROM public.get_user_access_config(p.role) cfg
        WHERE cfg.can_manage_all = true
           OR (
             (cfg.department = 'all'
               OR cfg.department = t.department
               OR (cfg.department = 'front_office' AND t.department = 'reception'))
             AND (
               cfg.access_scope = 'all_hotels'
               OR (cfg.access_scope = 'hotel_only'
                 AND p.assigned_hotel IS NOT NULL
                 AND public.get_hotel_name_from_id(p.assigned_hotel) = public.get_hotel_name_from_id(t.hotel))
               OR (cfg.access_scope = 'assigned_and_created'
                 AND (
                   t.assigned_to = p.id OR t.created_by = p.id
                   OR (p.assigned_hotel IS NOT NULL
                     AND public.get_hotel_name_from_id(p.assigned_hotel) = public.get_hotel_name_from_id(t.hotel)
                     AND cfg.department = t.department)
                 ))
             )
           )
      )
  );
$function$;
