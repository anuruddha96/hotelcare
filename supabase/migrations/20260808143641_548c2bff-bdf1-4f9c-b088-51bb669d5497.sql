
-- 1. profiles: scope manager insert/update to their own organization + block role escalation
DROP POLICY IF EXISTS profiles_update_authorized ON public.profiles;
CREATE POLICY profiles_update_authorized ON public.profiles
FOR UPDATE TO authenticated
USING (
  public.get_current_user_role() = 'admin'::user_role
  OR (
    public.get_current_user_role() = ANY (ARRAY['housekeeping_manager'::user_role,'manager'::user_role])
    AND organization_slug IS NOT DISTINCT FROM public.get_user_organization_slug(auth.uid())
  )
)
WITH CHECK (
  public.get_current_user_role() = 'admin'::user_role
  OR (
    public.get_current_user_role() = ANY (ARRAY['housekeeping_manager'::user_role,'manager'::user_role])
    AND organization_slug IS NOT DISTINCT FROM public.get_user_organization_slug(auth.uid())
    AND role <> 'admin'::user_role
  )
);

DROP POLICY IF EXISTS profiles_insert_authorized ON public.profiles;
CREATE POLICY profiles_insert_authorized ON public.profiles
FOR INSERT TO authenticated
WITH CHECK (
  public.get_current_user_role() = 'admin'::user_role
  OR (
    public.get_current_user_role() = ANY (ARRAY['housekeeping_manager'::user_role,'manager'::user_role])
    AND organization_slug IS NOT DISTINCT FROM public.get_user_organization_slug(auth.uid())
    AND role <> 'admin'::user_role
  )
);

-- 2. pms_sync_history: only signed-in users with access to that hotel may insert
DROP POLICY IF EXISTS "System can insert sync history" ON public.pms_sync_history;
CREATE POLICY "Staff can insert sync history for their hotels" ON public.pms_sync_history
FOR INSERT TO authenticated
WITH CHECK (
  hotel_id IS NULL OR public.user_can_access_hotel(auth.uid(), hotel_id)
);

-- 3. housekeeper_username_sequence: no anonymous/public write, org-scoped read
DROP POLICY IF EXISTS "Service role can manage sequence" ON public.housekeeper_username_sequence;
DROP POLICY IF EXISTS "Authenticated users can read sequence numbers" ON public.housekeeper_username_sequence;
CREATE POLICY "Managers read own org sequence" ON public.housekeeper_username_sequence
FOR SELECT TO authenticated
USING (
  organization_slug = public.get_user_organization_slug(auth.uid())
  AND public.get_current_user_role() = ANY (ARRAY['admin'::user_role,'manager'::user_role,'housekeeping_manager'::user_role])
);
REVOKE ALL ON public.housekeeper_username_sequence FROM anon;
GRANT SELECT ON public.housekeeper_username_sequence TO authenticated;
GRANT ALL ON public.housekeeper_username_sequence TO service_role;

-- 4. room_minibar_usage: organization scoping
DROP POLICY IF EXISTS "All authenticated users can view minibar usage" ON public.room_minibar_usage;
DROP POLICY IF EXISTS "All staff can record minibar usage" ON public.room_minibar_usage;
DROP POLICY IF EXISTS "All staff can update minibar usage" ON public.room_minibar_usage;

CREATE POLICY "Staff view minibar usage in own organization" ON public.room_minibar_usage
FOR SELECT TO authenticated
USING (organization_slug = public.get_user_organization_slug(auth.uid()));

CREATE POLICY "Staff record minibar usage in own organization" ON public.room_minibar_usage
FOR INSERT TO authenticated
WITH CHECK (
  organization_slug IS NULL
  OR organization_slug = public.get_user_organization_slug(auth.uid())
);

CREATE POLICY "Staff update minibar usage in own organization" ON public.room_minibar_usage
FOR UPDATE TO authenticated
USING (organization_slug = public.get_user_organization_slug(auth.uid()))
WITH CHECK (organization_slug = public.get_user_organization_slug(auth.uid()));

REVOKE ALL ON public.room_minibar_usage FROM anon;

-- 5. fix mutable search_path
ALTER FUNCTION public.normalize_hotel_name(text) SET search_path = public;

-- 6. remove anonymous execute rights on internal functions
DO $$
DECLARE
  r record;
  keep text[] := ARRAY[
    'get_email_by_nickname',
    'get_email_case_insensitive',
    'get_public_breakfast_hotels',
    'get_hotel_name_from_id',
    'get_hotel_id_from_name',
    'normalize_hotel_name'
  ];
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
  LOOP
    IF NOT (r.proname = ANY (keep)) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon, public', r.sig);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
    END IF;
  END LOOP;
END $$;

-- 7. privileged user-management functions: service_role only
DO $$
DECLARE
  r record;
  privileged text[] := ARRAY[
    'create_user_with_profile',
    'create_user_with_profile_v2',
    'create_authenticated_housekeeper',
    'delete_user_profile',
    'delete_user_profile_v2',
    'soft_delete_user_profile',
    'update_user_credentials',
    'cleanup_old_photos',
    'expire_stale_recommendations',
    'pms_apply_change'
  ];
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname = ANY (privileged)
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon, authenticated, public', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;
