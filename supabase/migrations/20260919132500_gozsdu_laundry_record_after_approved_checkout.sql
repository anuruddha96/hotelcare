-- Gozsdu ONLY: the original guard mistakenly required an ACTIVE housekeeping
-- assignment even after a room had been cleaned and approved. Completed
-- checkout assignments must still permit the laundry employee to record linen.
-- Never infer guest departure from clean/approved status: require current-day
-- PMS checkout + released room, and preserve holds, DND and conflict checks.
-- Existing room/PMS/assignment/linen data are not modified by this migration.
CREATE OR REPLACE FUNCTION public.guard_gozsdu_laundry_checkout_collection()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room public.rooms%ROWTYPE;
  v_valid_count integer;
  v_conflicts integer;
BEGIN
  IF NEW.hotel_id <> 'gozsdu-court' OR NEW.status NOT IN ('collected', 'nothing_to_collect') THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_room FROM public.rooms
    WHERE id = NEW.room_id AND organization_slug = NEW.organization_slug
      AND hotel IN ('gozsdu-court', 'Gozsdu Court Budapest')
    FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gozsdu laundry: room unavailable' USING ERRCODE = '42501';
  END IF;
  IF NOT (v_room.is_checkout_room IS TRUE OR v_room.pms_metadata->>'scheduledDepartureToday' = 'true') THEN
    RETURN NEW; -- Existing stayover process; client requires express guest permission.
  END IF;

  IF v_room.is_dnd IS TRUE
    OR v_room.status = 'out_of_order'
    OR v_room.pms_metadata->'gozsduAvailability'->>'status' IS DISTINCT FROM 'operating'
    OR v_room.pms_metadata->>'isNoShow' = 'true'
    OR v_room.pms_metadata->>'lastPmsRefreshDate' IS DISTINCT FROM NEW.work_date::text
    OR v_room.pms_metadata->>'checkedOutToday' IS DISTINCT FROM 'true'
    OR v_room.pms_metadata->>'readyToClean' IS DISTINCT FROM 'true'
    OR (v_room.pms_metadata ? 'readyToCleanDate'
      AND v_room.pms_metadata->>'readyToCleanDate' IS DISTINCT FROM NEW.work_date::text)
  THEN
    RAISE EXCEPTION 'Checkout has not been released: not ready to record dirty linen' USING ERRCODE = '42501';
  END IF;

  -- Prevent concurrent changes while validating. Completed checkout assignments
  -- remain valid for RECORDING linen, not proof of physical room entry.
  PERFORM 1 FROM public.room_assignments a
    WHERE a.room_id = NEW.room_id AND a.organization_slug = NEW.organization_slug
      AND a.assignment_date = NEW.work_date FOR SHARE;
  SELECT count(*) FILTER (WHERE a.assignment_type = 'checkout_cleaning'
      AND a.status IN ('assigned', 'in_progress', 'completed')
      AND a.ready_to_clean IS TRUE AND a.pms_hold IS NOT TRUE AND a.is_dnd IS NOT TRUE),
    count(*) FILTER (WHERE a.assignment_type <> 'maintenance'
      AND a.status IN ('assigned', 'in_progress', 'completed')
      AND (a.assignment_type <> 'checkout_cleaning' OR a.ready_to_clean IS NOT TRUE
        OR a.pms_hold IS TRUE OR a.is_dnd IS TRUE))
    INTO v_valid_count, v_conflicts
    FROM public.room_assignments a
    WHERE a.room_id = NEW.room_id AND a.organization_slug = NEW.organization_slug
      AND a.assignment_date = NEW.work_date;

  IF v_valid_count = 0 OR v_conflicts > 0 THEN
    RAISE EXCEPTION 'Checkout assignment is blocked: dirty linen cannot be recorded' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_gozsdu_laundry_checkout_collection() FROM PUBLIC;
-- Existing BEFORE INSERT OR UPDATE OF status trigger remains attached.
