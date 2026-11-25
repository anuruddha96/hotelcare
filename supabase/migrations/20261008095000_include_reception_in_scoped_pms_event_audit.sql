-- Broaden the scoped PMS audit INSERT permission only to operational roles
-- that already perform room/RTC actions, while keeping room ownership checks.
-- Platform super admins may act across their explicitly selected tenant.
DROP POLICY IF EXISTS "Scoped hotel staff can record pms change events"
  ON public.pms_change_events;

CREATE POLICY "Scoped hotel staff can record pms change events"
ON public.pms_change_events
FOR INSERT TO authenticated
WITH CHECK (
  source IN ('pms_sync', 'manager_ui', 'reception_ui')
  AND room_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.rooms AS r
    JOIN public.hotel_configurations AS hc
      ON (hc.hotel_id = pms_change_events.hotel_id
          OR hc.hotel_name = pms_change_events.hotel_id)
      AND (r.hotel = hc.hotel_id OR r.hotel = hc.hotel_name)
    JOIN public.organizations AS o ON o.id = hc.organization_id
    WHERE r.id = pms_change_events.room_id
      AND r.organization_slug = o.slug
      AND (
        o.slug = (SELECT public.get_user_organization_slug((SELECT auth.uid())))
        OR (SELECT public.is_super_admin((SELECT auth.uid())))
      )
      AND (
        (SELECT public.get_user_role((SELECT auth.uid()))::text)
          IN ('admin', 'top_management', 'top_management_manager')
        OR (
          (SELECT public.get_user_role((SELECT auth.uid()))::text)
            IN ('manager', 'housekeeping_manager', 'front_office', 'reception', 'reception_manager')
          AND hc.hotel_id = ANY (
            (SELECT public.user_assigned_hotel_keys((SELECT auth.uid())))::text[]
          )
        )
      )
  )
);
