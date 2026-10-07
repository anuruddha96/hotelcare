-- Fix the remaining database CPU/time-out root causes found by the
-- 7 Oct 2026 anomaly monitor.
--
-- Root cause: several hot RLS policies evaluated profile/hotel-access
-- subqueries once PER RETURNED ROW. On rate-grid reads this turned a 1 ms
-- indexed query into ~3.5 s and on room/assignment reads caused repeated
-- statement timeouts. Precompute user access once per statement via stable
-- SECURITY DEFINER helpers and InitPlan-style scalar subqueries.

CREATE OR REPLACE FUNCTION public.user_accessible_hotel_ids(_uid uuid)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(array_agg(DISTINCT hc.hotel_id ORDER BY hc.hotel_id), ARRAY[]::text[])
  FROM public.profiles p
  JOIN public.hotel_configurations hc ON true
  LEFT JOIN public.organizations o ON o.id = hc.organization_id
  WHERE p.id = _uid
    AND (
      COALESCE(p.is_super_admin, false)
      OR (
        p.organization_slug = o.slug
        AND (
          p.role::text IN ('admin', 'top_management', 'top_management_manager')
          OR p.assigned_hotel = hc.hotel_id
          OR p.assigned_hotel = hc.hotel_name
          OR public.get_hotel_name_from_id(p.assigned_hotel) = hc.hotel_name
          OR EXISTS (
            SELECT 1
            FROM public.user_property_scopes ups
            JOIN public.venues v ON v.id = ups.venue_id
            WHERE ups.user_id = p.id
              AND ups.organization_slug = p.organization_slug
              AND v.organization_slug = p.organization_slug
              AND v.hotel_id = hc.hotel_id
          )
        )
      )
    );
$$;

REVOKE ALL ON FUNCTION public.user_accessible_hotel_ids(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_accessible_hotel_ids(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.user_assigned_hotel_keys(_uid uuid)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(array_agg(DISTINCT key ORDER BY key), ARRAY[]::text[])
  FROM public.profiles p
  CROSS JOIN LATERAL public.pms_hotel_room_keys(p.assigned_hotel) AS keys(key)
  WHERE p.id = _uid
    AND p.assigned_hotel IS NOT NULL
    AND key IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.user_assigned_hotel_keys(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_assigned_hotel_keys(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.user_assigned_room_ids(_uid uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(array_agg(DISTINCT ra.room_id), ARRAY[]::uuid[])
  FROM public.room_assignments ra
  WHERE ra.assigned_to = _uid
    AND ra.room_id IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.user_assigned_room_ids(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_assigned_room_ids(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.user_same_hotel_housekeeper_ids(_uid uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH me AS (
    SELECT assigned_hotel
    FROM public.profiles
    WHERE id = _uid
  )
  SELECT COALESCE(array_agg(DISTINCT p.id), ARRAY[]::uuid[])
  FROM public.profiles p
  JOIN me ON me.assigned_hotel IS NOT NULL
         AND p.assigned_hotel = me.assigned_hotel
  WHERE p.role::text = 'housekeeping';
$$;

REVOKE ALL ON FUNCTION public.user_same_hotel_housekeeper_ids(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_same_hotel_housekeeper_ids(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.user_slnt_visible_venue_ids(_uid uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(array_agg(DISTINCT ups.venue_id), ARRAY[]::uuid[])
  FROM public.user_property_scopes ups
  WHERE ups.user_id = _uid
    AND ups.venue_id IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.user_slnt_visible_venue_ids(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_slnt_visible_venue_ids(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rdhotels_active_room_ids(_uid uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH me AS (
    SELECT assigned_hotel, COALESCE(is_super_admin, false) AS is_super_admin
    FROM public.profiles
    WHERE id = _uid
  )
  SELECT COALESCE(array_agg(r.id), ARRAY[]::uuid[])
  FROM public.rooms r
  CROSS JOIN me
  WHERE me.is_super_admin
     OR (
       me.assigned_hotel IS NOT NULL
       AND r.hotel = ANY(public.user_assigned_hotel_keys(_uid))
     );
$$;

REVOKE ALL ON FUNCTION public.rdhotels_active_room_ids(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rdhotels_active_room_ids(uuid) TO authenticated, service_role;

-- Revenue availability: the previous policy executed both user_can_access_hotel()
-- and a profiles subquery for every result row. The latter itself passed through
-- profiles RLS, producing ~450k shared-buffer hits for a 1,000-row result.
DROP POLICY IF EXISTS revenue_room_type_availability_select
  ON public.revenue_room_type_availability;

CREATE POLICY revenue_room_type_availability_select
ON public.revenue_room_type_availability
FOR SELECT
TO authenticated
USING (
  (SELECT auth.uid()) IS NOT NULL
  AND hotel_id = ANY ((SELECT public.user_accessible_hotel_ids((SELECT auth.uid())))::text[])
  AND (
    (SELECT public.is_super_admin((SELECT auth.uid())))
    OR organization_slug = (
      SELECT public.get_user_organization_slug((SELECT auth.uid()))
    )
  )
);

-- Same hotel-access hot path appears on PMS history and revenue action reads.
DROP POLICY IF EXISTS "Users view sync history for accessible hotels"
  ON public.pms_sync_history;
CREATE POLICY "Users view sync history for accessible hotels"
ON public.pms_sync_history
FOR SELECT
TO authenticated
USING (
  hotel_id IS NOT NULL
  AND hotel_id = ANY ((SELECT public.user_accessible_hotel_ids((SELECT auth.uid())))::text[])
);

DROP POLICY IF EXISTS "Revenue users view accessible pickup actions"
  ON public.revenue_pickup_automation_actions;
CREATE POLICY "Revenue users view accessible pickup actions"
ON public.revenue_pickup_automation_actions
FOR SELECT
TO authenticated
USING (
  (SELECT public.is_revenue_user((SELECT auth.uid())))
  AND hotel_id = ANY ((SELECT public.user_accessible_hotel_ids((SELECT auth.uid())))::text[])
);

DROP POLICY IF EXISTS "Revenue users update accessible pickup actions"
  ON public.revenue_pickup_automation_actions;
CREATE POLICY "Revenue users update accessible pickup actions"
ON public.revenue_pickup_automation_actions
FOR UPDATE
TO authenticated
USING (
  (SELECT public.is_revenue_user((SELECT auth.uid())))
  AND hotel_id = ANY ((SELECT public.user_accessible_hotel_ids((SELECT auth.uid())))::text[])
)
WITH CHECK (
  (SELECT public.is_revenue_user((SELECT auth.uid())))
  AND hotel_id = ANY ((SELECT public.user_accessible_hotel_ids((SELECT auth.uid())))::text[])
);

DROP POLICY IF EXISTS "Revenue users delete accessible pickup actions"
  ON public.revenue_pickup_automation_actions;
CREATE POLICY "Revenue users delete accessible pickup actions"
ON public.revenue_pickup_automation_actions
FOR DELETE
TO authenticated
USING (
  (SELECT public.is_revenue_user((SELECT auth.uid())))
  AND hotel_id = ANY ((SELECT public.user_accessible_hotel_ids((SELECT auth.uid())))::text[])
);

-- Pickup history had two stable user-profile checks per row.
DROP POLICY IF EXISTS revenue_users_view_pickup ON public.pickup_snapshots;
CREATE POLICY revenue_users_view_pickup
ON public.pickup_snapshots
FOR SELECT
TO authenticated
USING (
  (SELECT public.is_revenue_user((SELECT auth.uid())))
  AND organization_slug = (
    SELECT public.get_user_organization_slug((SELECT auth.uid()))
  )
);

-- Consolidate the three permissive room SELECT policies. The old policies
-- repeatedly queried profiles and, for assigned-room fallback, room_assignments
-- under RLS. This preserves their union of permissions while resolving user
-- context once per statement.
DROP POLICY IF EXISTS "Reception can view rooms in their organization" ON public.rooms;
DROP POLICY IF EXISTS "Secure room viewing" ON public.rooms;
DROP POLICY IF EXISTS "Users can view rooms based on role and assignment" ON public.rooms;

CREATE POLICY "Rooms visible to authorized staff"
ON public.rooms
FOR SELECT
TO authenticated
USING (
  (SELECT public.is_super_admin((SELECT auth.uid())))
  OR (
    organization_slug = (
      SELECT public.get_user_organization_slug((SELECT auth.uid()))
    )
    AND (
      (SELECT public.get_user_role((SELECT auth.uid()))::text)
        IN ('admin', 'top_management', 'top_management_manager', 'reception', 'housekeeping')
      OR hotel = ANY ((SELECT public.user_assigned_hotel_keys((SELECT auth.uid())))::text[])
      OR id = ANY ((SELECT public.user_assigned_room_ids((SELECT auth.uid())))::uuid[])
    )
  )
);

-- Preserve the existing restrictive SLNT venue boundary, but stop executing
-- role/profile/scope lookups once per room.
DROP POLICY IF EXISTS rooms_slnt_venue_scope ON public.rooms;
CREATE POLICY rooms_slnt_venue_scope
ON public.rooms
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (
  COALESCE(organization_slug, '') <> 'slnt'
  OR (SELECT public.is_super_admin((SELECT auth.uid())))
  OR (SELECT public.get_user_role((SELECT auth.uid()))::text)
       IN ('admin', 'top_management', 'top_management_manager', 'manager', 'housekeeping_manager')
  OR venue_id = ANY ((SELECT public.user_slnt_visible_venue_ids((SELECT auth.uid())))::uuid[])
);

-- Consolidate room-assignment SELECT permissions so the caller profile is not
-- re-read for each assignment row.
DROP POLICY IF EXISTS "Housekeepers can view assignment status in same hotel for race"
  ON public.room_assignments;
DROP POLICY IF EXISTS "Housekeeping staff can view their assignments"
  ON public.room_assignments;
DROP POLICY IF EXISTS tm_hk_select_room_assignments
  ON public.room_assignments;

CREATE POLICY "Room assignments visible to authorized staff"
ON public.room_assignments
FOR SELECT
TO authenticated
USING (
  (SELECT public.is_super_admin((SELECT auth.uid())))
  OR (
    organization_slug = (
      SELECT public.get_user_organization_slug((SELECT auth.uid()))
    )
    AND (
      assigned_to = (SELECT auth.uid())
      OR assigned_by = (SELECT auth.uid())
      OR (SELECT public.get_user_role((SELECT auth.uid()))::text)
           IN ('housekeeping_manager', 'manager', 'admin', 'top_management',
               'top_management_manager', 'reception', 'front_office')
      OR (
        (SELECT public.get_user_role((SELECT auth.uid()))::text) = 'housekeeping'
        AND assigned_to = ANY ((SELECT public.user_same_hotel_housekeeper_ids((SELECT auth.uid())))::uuid[])
      )
    )
  )
);

-- Keep the tenant boundary exactly as before, but make user context InitPlans.
DROP POLICY IF EXISTS "Room assignments universally restricted to caller organization"
  ON public.room_assignments;
CREATE POLICY "Room assignments universally restricted to caller organization"
ON public.room_assignments
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (
  (SELECT public.is_super_admin((SELECT auth.uid())))
  OR organization_slug = (
    SELECT public.get_user_organization_slug((SELECT auth.uid()))
  )
)
WITH CHECK (
  (SELECT public.is_super_admin((SELECT auth.uid())))
  OR organization_slug = (
    SELECT public.get_user_organization_slug((SELECT auth.uid()))
  )
);

-- RD Hotels property scoping was previously a SECURITY DEFINER function call
-- per assignment row, and that function queried rooms again. Resolve the active
-- room set once per statement instead.
DROP POLICY IF EXISTS rdhotels_room_assignments_active_hotel_select
  ON public.room_assignments;
CREATE POLICY rdhotels_room_assignments_active_hotel_select
ON public.room_assignments
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (
  COALESCE((
    SELECT public.get_user_organization_slug((SELECT auth.uid()))
  ), '') <> 'rdhotels'
  OR (
    (SELECT public.get_user_role((SELECT auth.uid()))::text)
      IN ('admin', 'top_management', 'top_management_manager')
    AND organization_slug = (
      SELECT public.get_user_organization_slug((SELECT auth.uid()))
    )
  )
  OR room_id = ANY ((SELECT public.rdhotels_active_room_ids((SELECT auth.uid())))::uuid[])
);

DROP POLICY IF EXISTS rdhotels_room_assignments_active_hotel_update
  ON public.room_assignments;
CREATE POLICY rdhotels_room_assignments_active_hotel_update
ON public.room_assignments
AS RESTRICTIVE
FOR UPDATE
TO authenticated
USING (
  COALESCE((
    SELECT public.get_user_organization_slug((SELECT auth.uid()))
  ), '') <> 'rdhotels'
  OR room_id = ANY ((SELECT public.rdhotels_active_room_ids((SELECT auth.uid())))::uuid[])
)
WITH CHECK (
  COALESCE((
    SELECT public.get_user_organization_slug((SELECT auth.uid()))
  ), '') <> 'rdhotels'
  OR room_id = ANY ((SELECT public.rdhotels_active_room_ids((SELECT auth.uid())))::uuid[])
);

-- Cover the remaining hot reads. The date/org/room assignment index added in
-- the prior hotfix remains; these indexes address assignment ownership and the
-- newest pickup-history path.
CREATE INDEX IF NOT EXISTS idx_room_assignments_assigned_to_room
  ON public.room_assignments (assigned_to, room_id)
  WHERE assigned_to IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pickup_snapshots_hotel_time_date_cover
  ON public.pickup_snapshots (hotel_id, captured_at DESC, stay_date)
  INCLUDE (bookings_current, bookings_last_year, delta);

CREATE INDEX IF NOT EXISTS idx_pms_sync_history_type_changed
  ON public.pms_sync_history (sync_type, changed_at DESC);

ANALYZE public.rooms;
ANALYZE public.room_assignments;
ANALYZE public.revenue_room_type_availability;
ANALYZE public.pickup_snapshots;
ANALYZE public.pms_sync_history;
ANALYZE public.revenue_pickup_automation_actions;
