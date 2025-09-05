-- Update rooms SELECT policy to allow slug/full-name equivalence
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
  (
    get_user_role(auth.uid()) = ANY (ARRAY['admin'::user_role, 'top_management'::user_role])
  ) OR (
    (SELECT assigned_hotel FROM public.profiles WHERE id = auth.uid()) = hotel
  ) OR (
    (SELECT assigned_hotel FROM public.profiles WHERE id = auth.uid()) = public.get_hotel_name_from_id(hotel)
  )
);
