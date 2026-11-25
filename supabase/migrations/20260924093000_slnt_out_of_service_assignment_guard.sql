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


-- A manual SLNT Out of Service block must survive PMS room refreshes. The
-- manager releases it by explicitly writing slntManualOutOfService=false.
CREATE OR REPLACE FUNCTION public.preserve_slnt_manual_out_of_service()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_manual_block boolean :=
    coalesce((OLD.pms_metadata ->> 'slntManualOutOfService')::boolean, false);
  v_release_requested boolean :=
    coalesce(NEW.pms_metadata, '{}'::jsonb) ? 'slntManualOutOfService'
    AND coalesce((NEW.pms_metadata ->> 'slntManualOutOfService')::boolean, false) = false;
BEGIN
  IF lower(coalesce(OLD.organization_slug, NEW.organization_slug, '')) IN ('slnt', 'slnt-group')
     AND OLD.status = 'out_of_order'
     AND v_old_manual_block
     AND NOT v_release_requested THEN
    NEW.status := 'out_of_order';
    NEW.pms_metadata := jsonb_set(
      coalesce(NEW.pms_metadata, '{}'::jsonb),
      '{slntManualOutOfService}',
      'true'::jsonb,
      true
    );

    IF NOT (NEW.pms_metadata ? 'slntManualOutOfServiceAt')
       AND OLD.pms_metadata ? 'slntManualOutOfServiceAt' THEN
      NEW.pms_metadata := jsonb_set(
        NEW.pms_metadata,
        '{slntManualOutOfServiceAt}',
        OLD.pms_metadata -> 'slntManualOutOfServiceAt',
        true
      );
    END IF;

    IF NOT (NEW.pms_metadata ? 'slntManualOutOfServiceBy')
       AND OLD.pms_metadata ? 'slntManualOutOfServiceBy' THEN
      NEW.pms_metadata := jsonb_set(
        NEW.pms_metadata,
        '{slntManualOutOfServiceBy}',
        OLD.pms_metadata -> 'slntManualOutOfServiceBy',
        true
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS preserve_slnt_manual_out_of_service
  ON public.rooms;

CREATE TRIGGER preserve_slnt_manual_out_of_service
BEFORE UPDATE OF status, pms_metadata
ON public.rooms
FOR EACH ROW
EXECUTE FUNCTION public.preserve_slnt_manual_out_of_service();

COMMENT ON FUNCTION public.preserve_slnt_manual_out_of_service()
IS 'Keeps an SLNT manager Out of Service block authoritative until explicit release.';
