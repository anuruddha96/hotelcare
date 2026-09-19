-- Gozsdu only. Previo sometimes replaces an outgoing reservation with an
-- incoming arrival before its checkout poll returns an explicit status 6/9.
-- For linen ENTRY ONLY, accept today's PMS-derived verified departure together
-- with a clean, completed, supervisor-approved, RTC checkout assignment and
-- explicit confirmation that the incoming guest has not arrived.
-- No rooms, PMS flags, assignments, events, or existing counts are changed.
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
  v_approved_operational_checkout boolean;
BEGIN
  IF NEW.hotel_id <> 'gozsdu-court' OR NEW.status NOT IN ('collected', 'nothing_to_collect') THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_room FROM public.rooms
    WHERE id = NEW.room_id AND organization_slug = NEW.organization_slug
      AND hotel IN ('gozsdu-court', 'Gozsdu Court Budapest') FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gozsdu laundry: room unavailable' USING ERRCODE = '42501';
  END IF;
  IF NOT (v_room.is_checkout_room IS TRUE OR v_room.pms_metadata->>'scheduledDepartureToday' = 'true') THEN
    RETURN NEW;
  END IF;
  IF v_room.is_dnd IS TRUE
    OR v_room.status = 'out_of_order'
    OR v_room.pms_metadata->'gozsduAvailability'->>'status' IS DISTINCT FROM 'operating'
    OR v_room.pms_metadata->>'isNoShow' = 'true'
    OR v_room.pms_metadata->>'lastPmsRefreshDate' IS DISTINCT FROM NEW.work_date::text
  THEN
    RAISE EXCEPTION 'Checkout room cannot be released for linen collection' USING ERRCODE = '42501';
  END IF;

  -- Lock existing work before choosing either valid release path.
  PERFORM 1 FROM public.room_assignments a
    WHERE a.room_id = NEW.room_id AND a.organization_slug = NEW.organization_slug
      AND a.assignment_date = NEW.work_date FOR SHARE;

  -- A supervisor has already verified that the checkout clean is COMPLETE.
  -- Keep an in-progress room blocked when the PMS checkout status is absent.
  -- Explicitly require the local departure date and unarrived replacement
  -- guest; never infer departure merely from being in the checkout bucket.
  SELECT EXISTS (
    SELECT 1 FROM public.room_assignments a
    WHERE v_room.is_checkout_room IS TRUE
      AND v_room.status = 'clean'
      AND v_room.pms_metadata->>'gozsduVerifiedDepartureDate' = NEW.work_date::text
      AND v_room.pms_metadata->>'occupiedToday' = 'false'
      AND v_room.pms_metadata->>'stayThroughToday' IS DISTINCT FROM 'true'
      AND v_room.pms_metadata->>'gozsduIncomingGuestNotArrived' = 'true'
      AND a.room_id = NEW.room_id
      AND a.organization_slug = NEW.organization_slug
      AND a.assignment_date = NEW.work_date
      AND a.assignment_type = 'checkout_cleaning'
      AND a.status = 'completed'
      AND a.supervisor_approved IS TRUE
      AND a.ready_to_clean IS TRUE
      AND a.pms_hold IS NOT TRUE
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
  ) INTO v_approved_operational_checkout;
  IF v_approved_operational_checkout THEN
    RETURN NEW;
  END IF;

  -- Normal checkout: actual same-day PMS checked-out and released state.
  IF v_room.pms_metadata->>'checkedOutToday' IS DISTINCT FROM 'true'
    OR v_room.pms_metadata->>'readyToClean' IS DISTINCT FROM 'true'
    OR (v_room.pms_metadata ? 'readyToCleanDate'
      AND v_room.pms_metadata->>'readyToCleanDate' IS DISTINCT FROM NEW.work_date::text)
  THEN
    RAISE EXCEPTION 'Checkout release conflicts with PMS: dirty linen cannot be recorded yet' USING ERRCODE = '42501';
  END IF;

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
    RETURN NEW;
  END IF;

  -- Preserve the earlier, narrower 410 early-checkout exception, including
  -- the linked authentic checkout event and the original supervisor hold.
  SELECT EXISTS (
    SELECT 1 FROM public.room_assignments a
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
