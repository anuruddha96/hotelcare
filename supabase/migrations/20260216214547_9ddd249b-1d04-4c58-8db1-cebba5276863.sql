
DROP POLICY IF EXISTS "Secure room updates" ON rooms;

CREATE POLICY "Secure room updates" ON rooms
FOR UPDATE USING (
  is_super_admin(auth.uid()) 
  OR (
    organization_slug = get_user_organization_slug(auth.uid()) 
    AND (
      get_user_role(auth.uid()) = ANY(ARRAY['admin'::user_role, 'top_management'::user_role])
      OR (SELECT profiles.assigned_hotel FROM profiles WHERE profiles.id = auth.uid()) = hotel
      OR EXISTS (
        SELECT 1 FROM hotel_configurations hc
        WHERE (
          (SELECT p.assigned_hotel FROM profiles p WHERE p.id = auth.uid()) = hc.hotel_id
          OR (SELECT p.assigned_hotel FROM profiles p WHERE p.id = auth.uid()) = hc.hotel_name
        )
        AND (rooms.hotel = hc.hotel_id OR rooms.hotel = hc.hotel_name)
      )
    )
  )
);
