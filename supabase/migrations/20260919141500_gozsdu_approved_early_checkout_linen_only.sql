-- Gozsdu only. A guest can check out after an assignment was created as
-- daily_cleaning. The checkout poll attaches a system event and pms_hold to
-- that assignment. Once housekeeping is completed AND supervisor approved,
-- that housekeeping conflict should not prevent recording linen quantities.
-- It must NOT release/reclassify the assignment, clear a manager alert, change
-- PMS occupancy or treat a housekeeper's in-progress status as checkout proof.
-- No existing room, assignment, event or linen rows are changed.
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
  v_approved_early_checkout boolean;
BEGIN
  IF NEW.hotel_id <> 'gozsdu-court' OR NEW.status NOT IN ('collected', 'nothing_to_collect') THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_room FROM public.rooms
    WHERE id = NEW.room_id
      AND organization_slug = NEW.organization_slug
      AND hotel IN ('gozsdu-court', 'Gozsdu Court Budapest')
    FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gozsdu laundry: room unavailable' USING ERRCODE = '42501';
  END IF;
  IF NOT (v_room.is_checkout_room IS TRUE OR v_room.pms_metadata->>'scheduledDepartureToday' = 'true') THEN
    RETURN NEW; -- Existing stayover flow. Do not infer consent from this guard.
  END IF;

  -- Checkout and release must still be independently confirmed for the SAME
  -- work date. In particular, ready_to_clean on an in-progress assignment
  -- alone is not proof: this deliberately keeps room 4005-style conflicts
  -- locked until the PMS/authorized release evidence is reconciled.
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
    RAISE EXCEPTION 'Checkout release conflicts with PMS: dirty linen cannot be recorded yet' USING ERRCODE = '42501';
  END IF;

  -- Lock the actual assignment rows before checking: a concurrent re-hold
  -- must not race against the linen collection write.
  PERFORM 1 FROM public.room_assignments a
    WHERE a.room_id = NEW.room_id
      AND a.organization_slug = NEW.organization_slug
      AND a.assignment_date = NEW.work_date
    FOR SHARE;

  SELECT count(*) FILTER (
           WHERE a.assignment_type = 'checkout_cleaning'
             AND a.status IN ('assigned', 'in_progress', 'completed')
             AND a.ready_to_clean IS TRUE
             AND a.pms_hold IS NOT TRUE AND a.is_dnd IS NOT TRUE
         ),
         count(*) FILTER (
           WHERE a.assignment_type <> 'maintenance'
             AND a.status IN ('assigned', 'in_progress', 'completed')
             AND (a.assignment_type <> 'checkout_cleaning'
               OR a.ready_to_clean IS NOT TRUE OR a.pms_hold IS TRUE OR a.is_dnd IS TRUE)
         )
    INTO v_valid_count, v_conflicts
    FROM public.room_assignments a
    WHERE a.room_id = NEW.room_id
      AND a.organization_slug = NEW.organization_slug
      AND a.assignment_date = NEW.work_date;

  IF v_valid_count > 0 AND v_conflicts = 0 THEN
    RETURN NEW; -- Original strict, released checkout assignment path.
  END IF;

  -- Linen-only exception: the single completed, supervisor-approved DAILY
  -- assignment has the specific system-generated early-checkout hold, and its
  -- linked checkout-confirmed event belongs to this room and assignment.
  -- Never clear the hold, reinterpret approval as guest checkout or broaden
  -- this exception to an arbitrary manual hold / mixed assignments.
  SELECT EXISTS (
    SELECT 1
    FROM public.room_assignments a
    JOIN public.pms_change_events e
      ON e.id = a.pms_hold_event_id
     AND e.hotel_id = 'gozsdu-court'
     AND e.room_id = NEW.room_id
     AND e.event_type = 'checkout_confirmed'
     AND e.source = 'poll_checkouts'
     AND e.is_conflict IS TRUE
     AND e.conflicts_with_assignment_id = a.id
     AND e.after->>'is_checkout_room' = 'true'
    WHERE v_room.status = 'clean'
      AND a.room_id = NEW.room_id
      AND a.organization_slug = NEW.organization_slug
      AND a.assignment_date = NEW.work_date
      AND a.assignment_type = 'daily_cleaning'
      AND a.status = 'completed'
      AND a.supervisor_approved IS TRUE
      AND a.ready_to_clean IS TRUE
      AND a.pms_hold IS TRUE
      AND a.pms_hold_reason = 'Guest checked out — assignment type may need to change'
      AND a.is_dnd IS NOT TRUE
      AND NOT EXISTS (
        SELECT 1 FROM public.room_assignments other
         WHERE other.room_id = NEW.room_id
           AND other.organization_slug = NEW.organization_slug
           AND other.assignment_date = NEW.work_date
           AND other.id <> a.id
           AND other.assignment_type <> 'maintenance'
           AND other.status IN ('assigned', 'in_progress', 'completed')
      )
  ) INTO v_approved_early_checkout;

  IF v_approved_early_checkout THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Checkout assignment conflict: dirty linen cannot be recorded yet' USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION public.guard_gozsdu_laundry_checkout_collection() FROM PUBLIC;
-- The existing BEFORE INSERT OR UPDATE OF status trigger remains attached.
