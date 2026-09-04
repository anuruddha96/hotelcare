-- RD Hotels shares one organization_slug across several properties. Housekeeping
-- assignment reads/approvals must follow the user's currently assigned hotel,
-- otherwise Memories and Ottofiori managers can see/act on each other's rooms.
CREATE OR REPLACE FUNCTION public.rdhotels_assignment_in_active_hotel(_user_id uuid, _room_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH user_ctx AS (
    SELECT p.assigned_hotel, COALESCE(p.is_super_admin, false) AS is_super_admin
    FROM public.profiles p
    WHERE p.id = _user_id
  )
  SELECT COALESCE((
    SELECT CASE
      WHEN u.assigned_hotel IS NULL THEN u.is_super_admin
      ELSE EXISTS (
        SELECT 1
        FROM public.rooms r
        WHERE r.id = _room_id
          AND r.hotel IN (SELECT public.pms_hotel_room_keys(u.assigned_hotel))
      )
    END
    FROM user_ctx u
  ), false);
$$;

REVOKE ALL ON FUNCTION public.rdhotels_assignment_in_active_hotel(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rdhotels_assignment_in_active_hotel(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS rdhotels_room_assignments_active_hotel_select ON public.room_assignments;
CREATE POLICY rdhotels_room_assignments_active_hotel_select
ON public.room_assignments
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (
  COALESCE(public.get_user_organization_slug(auth.uid()), '') <> 'rdhotels'
  OR public.rdhotels_assignment_in_active_hotel(auth.uid(), room_id)
);

DROP POLICY IF EXISTS rdhotels_room_assignments_active_hotel_update ON public.room_assignments;
CREATE POLICY rdhotels_room_assignments_active_hotel_update
ON public.room_assignments
AS RESTRICTIVE
FOR UPDATE
TO authenticated
USING (
  COALESCE(public.get_user_organization_slug(auth.uid()), '') <> 'rdhotels'
  OR public.rdhotels_assignment_in_active_hotel(auth.uid(), room_id)
)
WITH CHECK (
  COALESCE(public.get_user_organization_slug(auth.uid()), '') <> 'rdhotels'
  OR public.rdhotels_assignment_in_active_hotel(auth.uid(), room_id)
);
