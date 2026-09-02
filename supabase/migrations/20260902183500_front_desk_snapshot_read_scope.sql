-- PMS Phase 1 reservation board
--
-- The live reservation board temporarily reads daily_overview_snapshots while
-- normalized `reservations` are being populated. Existing RLS only lets
-- admin/top_management read this table, which would leave reception/manager
-- users with an empty board.
--
-- This policy intentionally grants SELECT only to operational PMS roles and
-- only for the user's assigned hotel inside the same organization. It does not
-- grant INSERT/UPDATE/DELETE and does not broaden portfolio-wide access.

DROP POLICY IF EXISTS "Front desk can view assigned hotel daily overview snapshots"
ON public.daily_overview_snapshots;

CREATE POLICY "Front desk can view assigned hotel daily overview snapshots"
ON public.daily_overview_snapshots
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role = ANY (
        ARRAY[
          'manager'::public.user_role,
          'housekeeping_manager'::public.user_role,
          'reception'::public.user_role,
          'front_office'::public.user_role
        ]
      )
      AND p.organization_slug IS NOT DISTINCT FROM daily_overview_snapshots.organization_slug
      AND (
        p.assigned_hotel = daily_overview_snapshots.hotel_id
        OR EXISTS (
          SELECT 1
          FROM public.hotel_configurations hc
          WHERE (p.assigned_hotel = hc.hotel_id OR p.assigned_hotel = hc.hotel_name)
            AND daily_overview_snapshots.hotel_id = hc.hotel_id
        )
      )
  )
);
