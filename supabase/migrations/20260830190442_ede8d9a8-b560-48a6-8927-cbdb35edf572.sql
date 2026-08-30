
-- 1. hotel_configurations: scope admin management to own organization
DROP POLICY IF EXISTS "Admins can manage hotel configurations" ON public.hotel_configurations;
CREATE POLICY "Admins manage hotel configurations in their organization"
ON public.hotel_configurations
FOR ALL
TO authenticated
USING (
  public.get_user_role(auth.uid()) = 'admin'::user_role
  AND (
    public.is_super_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.id = hotel_configurations.organization_id
        AND o.slug = public.get_user_organization_slug(auth.uid())
    )
  )
)
WITH CHECK (
  public.get_user_role(auth.uid()) = 'admin'::user_role
  AND (
    public.is_super_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.id = hotel_configurations.organization_id
        AND o.slug = public.get_user_organization_slug(auth.uid())
    )
  )
);

-- 2. hotel_floor_layouts: scope reads to the user's organization
DROP POLICY IF EXISTS "All authenticated users can view floor layouts" ON public.hotel_floor_layouts;
CREATE POLICY "Users view floor layouts for their hotels"
ON public.hotel_floor_layouts
FOR SELECT
TO authenticated
USING (public.hotel_belongs_to_user_organization(auth.uid(), hotel_name));

DROP POLICY IF EXISTS "Admins can manage floor layouts" ON public.hotel_floor_layouts;
CREATE POLICY "Admins manage floor layouts in their organization"
ON public.hotel_floor_layouts
FOR ALL
TO authenticated
USING (
  public.get_user_role(auth.uid()) = 'admin'::user_role
  AND public.hotel_belongs_to_user_organization(auth.uid(), hotel_name)
)
WITH CHECK (
  public.get_user_role(auth.uid()) = 'admin'::user_role
  AND public.hotel_belongs_to_user_organization(auth.uid(), hotel_name)
);

-- 3. pms_configurations: scope admin writes to accessible hotels
DROP POLICY IF EXISTS "Admins can insert PMS configurations" ON public.pms_configurations;
DROP POLICY IF EXISTS "Admins can update PMS configurations" ON public.pms_configurations;
DROP POLICY IF EXISTS "Admins can delete PMS configurations" ON public.pms_configurations;

CREATE POLICY "Admins insert PMS configurations for their hotels"
ON public.pms_configurations
FOR INSERT
TO authenticated
WITH CHECK (
  public.get_user_role(auth.uid()) = 'admin'::user_role
  AND public.user_can_access_hotel(auth.uid(), hotel_id)
);

CREATE POLICY "Admins update PMS configurations for their hotels"
ON public.pms_configurations
FOR UPDATE
TO authenticated
USING (
  public.get_user_role(auth.uid()) = 'admin'::user_role
  AND public.user_can_access_hotel(auth.uid(), hotel_id)
)
WITH CHECK (
  public.get_user_role(auth.uid()) = 'admin'::user_role
  AND public.user_can_access_hotel(auth.uid(), hotel_id)
);

CREATE POLICY "Admins delete PMS configurations for their hotels"
ON public.pms_configurations
FOR DELETE
TO authenticated
USING (
  public.get_user_role(auth.uid()) = 'admin'::user_role
  AND public.user_can_access_hotel(auth.uid(), hotel_id)
);

-- 4. pms_room_mappings: scope via parent pms_configurations
DROP POLICY IF EXISTS "Admins can view all PMS room mappings" ON public.pms_room_mappings;
DROP POLICY IF EXISTS "Admins can insert PMS room mappings" ON public.pms_room_mappings;
DROP POLICY IF EXISTS "Admins can update PMS room mappings" ON public.pms_room_mappings;
DROP POLICY IF EXISTS "Admins can delete PMS room mappings" ON public.pms_room_mappings;

CREATE POLICY "Admins view PMS room mappings for their hotels"
ON public.pms_room_mappings
FOR SELECT
TO authenticated
USING (
  public.get_user_role(auth.uid()) = 'admin'::user_role
  AND EXISTS (
    SELECT 1 FROM public.pms_configurations pc
    WHERE pc.id = pms_room_mappings.pms_config_id
      AND public.user_can_access_hotel(auth.uid(), pc.hotel_id)
  )
);

CREATE POLICY "Admins insert PMS room mappings for their hotels"
ON public.pms_room_mappings
FOR INSERT
TO authenticated
WITH CHECK (
  public.get_user_role(auth.uid()) = 'admin'::user_role
  AND EXISTS (
    SELECT 1 FROM public.pms_configurations pc
    WHERE pc.id = pms_room_mappings.pms_config_id
      AND public.user_can_access_hotel(auth.uid(), pc.hotel_id)
  )
);

CREATE POLICY "Admins update PMS room mappings for their hotels"
ON public.pms_room_mappings
FOR UPDATE
TO authenticated
USING (
  public.get_user_role(auth.uid()) = 'admin'::user_role
  AND EXISTS (
    SELECT 1 FROM public.pms_configurations pc
    WHERE pc.id = pms_room_mappings.pms_config_id
      AND public.user_can_access_hotel(auth.uid(), pc.hotel_id)
  )
)
WITH CHECK (
  public.get_user_role(auth.uid()) = 'admin'::user_role
  AND EXISTS (
    SELECT 1 FROM public.pms_configurations pc
    WHERE pc.id = pms_room_mappings.pms_config_id
      AND public.user_can_access_hotel(auth.uid(), pc.hotel_id)
  )
);

CREATE POLICY "Admins delete PMS room mappings for their hotels"
ON public.pms_room_mappings
FOR DELETE
TO authenticated
USING (
  public.get_user_role(auth.uid()) = 'admin'::user_role
  AND EXISTS (
    SELECT 1 FROM public.pms_configurations pc
    WHERE pc.id = pms_room_mappings.pms_config_id
      AND public.user_can_access_hotel(auth.uid(), pc.hotel_id)
  )
);

-- 5. hotel-assets storage: require the object to live in a hotel folder the user can access
DROP POLICY IF EXISTS "Authenticated users can upload hotel assets" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update hotel assets" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete hotel assets" ON storage.objects;

CREATE POLICY "Users upload hotel assets for their hotel"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'hotel-assets'
  AND public.user_can_access_hotel(auth.uid(), (storage.foldername(name))[1])
);

CREATE POLICY "Users update hotel assets for their hotel"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'hotel-assets'
  AND public.user_can_access_hotel(auth.uid(), (storage.foldername(name))[1])
)
WITH CHECK (
  bucket_id = 'hotel-assets'
  AND public.user_can_access_hotel(auth.uid(), (storage.foldername(name))[1])
);

CREATE POLICY "Users delete hotel assets for their hotel"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'hotel-assets'
  AND public.user_can_access_hotel(auth.uid(), (storage.foldername(name))[1])
);
