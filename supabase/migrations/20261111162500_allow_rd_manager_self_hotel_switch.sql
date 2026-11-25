-- RD Hotels manager venue switching is a workspace selection, not a role grant.
-- Keep all self-escalation protections. Only an existing authorized management
-- role may select an active hotel in their own (unchanged) organization.
-- guard_profile_tenant_fields performs the same scope check independently.
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

  IF actor.id = OLD.id AND (
    NEW.id IS DISTINCT FROM OLD.id
    OR NEW.role IS DISTINCT FROM OLD.role
    OR NEW.organization_slug IS DISTINCT FROM OLD.organization_slug
    OR NEW.is_super_admin IS DISTINCT FROM OLD.is_super_admin
    OR (
      NEW.assigned_hotel IS DISTINCT FROM OLD.assigned_hotel
      AND NOT (
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
$function$;
