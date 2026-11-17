-- Repair compatibility with two pre-existing profile authorization triggers.
-- Both rejected a maintenance employee's approved intra-organization switch.
-- Preserve every existing protection and add ONLY the narrow, transaction
-- authenticated staff work-venue exception.
-- Checked only during the trusted staff_select_work_hotel transaction:
-- the RPC first validates the target belongs to the user's active org, then
-- writes this server-only state row, and only then updates profiles.assigned_hotel.
-- A direct profiles PATCH in another transaction cannot forge the timestamp.
CREATE OR REPLACE FUNCTION public.staff_work_venue_switch_authorized(
  p_user uuid, p_hotel text
)
RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.staff_work_venue_state s
    JOIN public.profiles p ON p.id = s.user_id
    JOIN public.hotel_configurations h ON h.hotel_id = s.last_worked_hotel
    JOIN public.organizations o ON o.id = h.organization_id
    WHERE s.user_id = auth.uid()
      AND s.user_id = p_user
      AND p.deleted_at IS NULL
      AND p.role::text IN ('maintenance', 'maintenance_manager', 'housekeeping')
      AND s.organization_slug = p.organization_slug
      AND h.hotel_id = p_hotel
      AND h.is_active IS TRUE
      AND o.is_active IS TRUE
      AND o.slug = p.organization_slug
      AND s.updated_at = pg_catalog.transaction_timestamp()
  );
$function$;

REVOKE ALL ON FUNCTION public.staff_work_venue_switch_authorized(uuid,text)
  FROM PUBLIC, anon, authenticated;


CREATE OR REPLACE FUNCTION public.guard_profile_tenant_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      IF NOT (
        (v_caller_role IN ('admin','manager','housekeeping_manager','top_management','top_management_manager')
          AND NEW.assigned_hotel IS NOT NULL
          AND public.hotel_belongs_to_user_organization(auth.uid(), NEW.assigned_hotel))
        OR public.staff_work_venue_switch_authorized(auth.uid(), NEW.assigned_hotel)
      ) THEN
        RAISE EXCEPTION 'Property assignment is not allowed' USING ERRCODE = '42501';
      END IF;
    END IF;
  ELSIF NEW.organization_slug IS DISTINCT FROM OLD.organization_slug THEN
    RAISE EXCEPTION 'Users cannot be moved between organizations' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$

CREATE OR REPLACE FUNCTION public.rd_protect_profile_authorization_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  actor public.profiles%ROWTYPE;
BEGIN
  IF OLD.organization_slug IS DISTINCT FROM 'rdhotels'
     AND NEW.organization_slug IS DISTINCT FROM 'rdhotels' THEN
    RETURN NEW;
  END IF;
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;

  SELECT * INTO actor FROM public.profiles WHERE id = auth.uid();
  IF actor.id IS NULL OR actor.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Profile change not authorized';
  END IF;

  -- Super administrators may switch only their own working context between
  -- ACTIVE organizations. Preserve all role, privilege, staff assignment and
  -- account deletion protections.
  IF actor.id = OLD.id AND actor.is_super_admin IS TRUE
     AND NEW.organization_slug IS DISTINCT FROM OLD.organization_slug
     AND EXISTS (
       SELECT 1 FROM public.organizations o
       WHERE o.slug = NEW.organization_slug AND o.is_active IS TRUE
     )
     AND NEW.assigned_hotel IS NULL
     AND NEW.id IS NOT DISTINCT FROM OLD.id
     AND NEW.role IS NOT DISTINCT FROM OLD.role
     AND NEW.is_super_admin IS NOT DISTINCT FROM OLD.is_super_admin
     AND NEW.hotel_id IS NOT DISTINCT FROM OLD.hotel_id
     AND NEW.acts_as_housekeeper IS NOT DISTINCT FROM OLD.acts_as_housekeeper
     AND NEW.deleted_at IS NOT DISTINCT FROM OLD.deleted_at
     AND NEW.deleted_by IS NOT DISTINCT FROM OLD.deleted_by
  THEN
     RETURN NEW;
  END IF;

  IF actor.id = OLD.id AND (
    NEW.id IS DISTINCT FROM OLD.id
    OR NEW.role IS DISTINCT FROM OLD.role
    OR NEW.organization_slug IS DISTINCT FROM OLD.organization_slug
    OR NEW.is_super_admin IS DISTINCT FROM OLD.is_super_admin
    OR (
      NEW.assigned_hotel IS DISTINCT FROM OLD.assigned_hotel
      AND NOT (
        public.staff_work_venue_switch_authorized(actor.id, NEW.assigned_hotel)
        OR (
          actor.role::text = ANY (ARRAY[
            'admin', 'manager', 'housekeeping_manager',
            'top_management', 'top_management_manager'
          ])
          AND actor.organization_slug = 'rdhotels'
          AND OLD.organization_slug = 'rdhotels'
          AND NEW.organization_slug = 'rdhotels'
          AND NEW.assigned_hotel IS NOT NULL
          AND public.hotel_belongs_to_user_organization(actor.id, NEW.assigned_hotel)
        )
      )
    )
    OR NEW.hotel_id IS DISTINCT FROM OLD.hotel_id
    OR NEW.acts_as_housekeeper IS DISTINCT FROM OLD.acts_as_housekeeper
    OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
    OR NEW.deleted_by IS DISTINCT FROM OLD.deleted_by
  ) THEN
    RAISE EXCEPTION 'Users cannot change their own access, role, organization or hotel';
  END IF;

  IF (NEW.role IS DISTINCT FROM OLD.role
      OR NEW.organization_slug IS DISTINCT FROM OLD.organization_slug
      OR NEW.is_super_admin IS DISTINCT FROM OLD.is_super_admin)
     AND (
       actor.organization_slug IS DISTINCT FROM 'rdhotels'
       OR actor.role::text <> 'admin'
     ) THEN
    RAISE EXCEPTION 'Role and organization changes require an RD Hotels administrator';
  END IF;
  IF NEW.is_super_admin IS DISTINCT FROM OLD.is_super_admin
     AND actor.is_super_admin IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Super-administrator privileges cannot be delegated';
  END IF;
  RETURN NEW;
END;
$function$

