CREATE OR REPLACE FUNCTION public.hotel_belongs_to_user_organization(_uid uuid, _hotel_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.organizations o ON o.slug = p.organization_slug
    JOIN public.hotel_configurations hc ON hc.organization_id = o.id
    WHERE p.id = _uid
      AND (hc.hotel_id = _hotel_id OR hc.hotel_name = _hotel_id)
      AND COALESCE(hc.is_active, true)
  );
$$;
REVOKE ALL ON FUNCTION public.hotel_belongs_to_user_organization(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hotel_belongs_to_user_organization(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.guard_profile_tenant_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role public.user_role;
BEGIN
  IF auth.uid() IS NULL OR public.is_super_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  IF NEW.id = auth.uid() THEN
    IF NEW.role IS DISTINCT FROM OLD.role
       OR NEW.organization_slug IS DISTINCT FROM OLD.organization_slug
       OR NEW.is_super_admin IS DISTINCT FROM OLD.is_super_admin THEN
      RAISE EXCEPTION 'Protected profile fields cannot be changed' USING ERRCODE = '42501';
    END IF;

    IF NEW.assigned_hotel IS DISTINCT FROM OLD.assigned_hotel THEN
      v_caller_role := public.get_user_role(auth.uid());
      IF v_caller_role NOT IN ('admin','manager','housekeeping_manager','top_management','top_management_manager')
         OR NEW.assigned_hotel IS NULL
         OR NOT public.hotel_belongs_to_user_organization(auth.uid(), NEW.assigned_hotel) THEN
        RAISE EXCEPTION 'Property assignment is not allowed' USING ERRCODE = '42501';
      END IF;
    END IF;
  ELSIF NEW.organization_slug IS DISTINCT FROM OLD.organization_slug THEN
    RAISE EXCEPTION 'Users cannot be moved between organizations' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_own_revenue_sync(_hotel_id text, _error text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  UPDATE public.revenue_sync_state
  SET lease_started_at = NULL,
      lease_expires_at = NULL,
      lease_owner = NULL,
      last_error = left(COALESCE(_error, 'Revenue refresh request failed'), 1000),
      updated_at = now()
  WHERE hotel_id = _hotel_id AND lease_owner = auth.uid();
END;
$$;
REVOKE ALL ON FUNCTION public.release_own_revenue_sync(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_own_revenue_sync(text, text) TO authenticated;