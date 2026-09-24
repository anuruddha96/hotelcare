-- SLNT: an Out of Service unit is a hard housekeeping assignment lock.
-- This trigger is deliberately tenant-scoped so RD Hotels and other tenants
-- retain their existing room-status behavior.

CREATE OR REPLACE FUNCTION public.guard_slnt_out_of_service_housekeeping_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room_status text;
  v_organization_slug text;
BEGIN
  SELECT r.status, r.organization_slug
    INTO v_room_status, v_organization_slug
  FROM public.rooms r
  WHERE r.id = NEW.room_id;

  IF lower(coalesce(v_organization_slug, '')) IN ('slnt', 'slnt-group')
     AND v_room_status = 'out_of_order' THEN
    RAISE EXCEPTION 'SLNT_ROOM_OUT_OF_SERVICE: release the unit before assigning housekeeping'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_slnt_out_of_service_housekeeping_assignment
  ON public.room_assignments;

CREATE TRIGGER guard_slnt_out_of_service_housekeeping_assignment
BEFORE INSERT OR UPDATE OF room_id, assigned_to
ON public.room_assignments
FOR EACH ROW
EXECUTE FUNCTION public.guard_slnt_out_of_service_housekeeping_assignment();

COMMENT ON FUNCTION public.guard_slnt_out_of_service_housekeeping_assignment()
IS 'Prevents SLNT housekeeping assignment/reassignment while a room is Out of Service.';
