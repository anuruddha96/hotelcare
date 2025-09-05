-- Strengthen rooms SELECT policy to allow housekeepers to read rooms assigned to them
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' AND tablename = 'rooms' AND policyname = 'Secure room viewing'
  ) THEN
    DROP POLICY "Secure room viewing" ON public.rooms;
  END IF;
END$$;

CREATE POLICY "Secure room viewing"
ON public.rooms
FOR SELECT
USING (
  -- Admins/top management can view all
  get_user_role(auth.uid()) = ANY (ARRAY['admin'::user_role, 'top_management'::user_role])
  -- Users can view rooms in their assigned hotel (supports slug/full-name)
  OR (SELECT assigned_hotel FROM public.profiles WHERE id = auth.uid()) = hotel
  OR (SELECT assigned_hotel FROM public.profiles WHERE id = auth.uid()) = public.get_hotel_name_from_id(hotel)
  -- Housekeepers can always view rooms they are assigned today (or anytime)
  OR EXISTS (
    SELECT 1 FROM public.room_assignments ra
    WHERE ra.room_id = public.rooms.id AND ra.assigned_to = auth.uid()
  )
);
