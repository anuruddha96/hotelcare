-- HotelCare incident 2026-10-08: restore authenticated, audited PMS events.
-- An application refresh writes pms_change_events from the signed-in client, but
-- only SELECT/UPDATE RLS policies existed, so all such INSERTs failed (42501).
--
-- Do not grant cross-organisation writes or anonymous inserts. Require an
-- existing room whose property and organisation match the event's hotel,
-- and require an approved manager/front-office role scoped to that property.
-- Support both legacy display hotel names and canonical hotel keys.
-- Automated server-side service_role writes remain unchanged.
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
    JOIN public.organizations AS o
      ON o.id = hc.organization_id
    WHERE r.id = pms_change_events.room_id
      AND r.organization_slug = o.slug
      AND o.slug = (SELECT public.get_user_organization_slug((SELECT auth.uid())))
      AND (
        (SELECT public.get_user_role((SELECT auth.uid()))::text)
          IN ('admin', 'top_management')
        OR (
          (SELECT public.get_user_role((SELECT auth.uid()))::text)
            IN ('manager', 'housekeeping_manager', 'front_office')
          AND hc.hotel_id = ANY (
            (SELECT public.user_assigned_hotel_keys((SELECT auth.uid())))::text[]
          )
        )
      )
  )
);
