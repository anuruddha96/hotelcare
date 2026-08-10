DROP POLICY IF EXISTS rev_read_room_types ON public.room_types;
CREATE POLICY rev_read_room_types ON public.room_types
FOR SELECT
USING (
  (
    get_user_role(auth.uid()) = ANY (ARRAY['admin'::user_role, 'top_management'::user_role, 'top_management_manager'::user_role])
    AND user_can_access_hotel(auth.uid(), hotel_id)
  )
  OR (
    organization_slug = get_user_organization_slug(auth.uid())
    AND get_user_role(auth.uid()) = ANY (ARRAY['manager'::user_role, 'housekeeping_manager'::user_role])
    AND user_can_access_hotel(auth.uid(), hotel_id)
  )
);

DROP POLICY IF EXISTS rev_write_room_types ON public.room_types;
CREATE POLICY rev_write_room_types ON public.room_types
FOR ALL
USING (
  get_user_role(auth.uid()) = ANY (ARRAY['admin'::user_role, 'top_management'::user_role, 'top_management_manager'::user_role])
  AND user_can_access_hotel(auth.uid(), hotel_id)
)
WITH CHECK (
  get_user_role(auth.uid()) = ANY (ARRAY['admin'::user_role, 'top_management'::user_role, 'top_management_manager'::user_role])
  AND user_can_access_hotel(auth.uid(), hotel_id)
);