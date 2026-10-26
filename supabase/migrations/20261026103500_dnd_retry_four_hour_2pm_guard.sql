-- DND requires two genuinely separate doorway visits for today's daily rooms.
-- Second visit: four hours after the first, OR 14:00 Budapest, whichever is
-- earlier. A first visit made at/after 14:00 may be retried immediately.
-- Eligibility NEVER means consent to enter a room with the DND sign displayed.
-- Preserve all historical photos; reject only future invalid writes.

CREATE OR REPLACE FUNCTION public.hc_dnd_retry_ready_at(p_first timestamptz)
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path TO ''
AS $$
  SELECT GREATEST(
    p_first,
    LEAST(
      p_first + INTERVAL '4 hours',
      (((p_first AT TIME ZONE 'Europe/Budapest')::date + TIME '14:00')
        AT TIME ZONE 'Europe/Budapest')
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.hc_guard_dnd_photo_second_visit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
DECLARE
  assignment_row public.room_assignments%ROWTYPE;
  first_photo_at timestamptz;
  first_at timestamptz;
  eligible_at timestamptz;
BEGIN
  IF NEW.attempt_number IS NULL OR NEW.attempt_number <= 1 THEN
    RETURN NEW;
  END IF;

  IF NEW.attempt_number <> 2 OR NEW.assignment_id IS NULL THEN
    RAISE EXCEPTION 'DND_RETRY_INVALID_ATTEMPT'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO assignment_row
  FROM public.room_assignments WHERE id = NEW.assignment_id FOR UPDATE;
  IF NOT FOUND
     OR assignment_row.room_id IS DISTINCT FROM NEW.room_id
     OR assignment_row.assignment_date IS DISTINCT FROM NEW.assignment_date
     OR assignment_row.assignment_date IS DISTINCT FROM
        (clock_timestamp() AT TIME ZONE 'Europe/Budapest')::date
     OR assignment_row.assignment_type::text <> 'daily_cleaning'
     OR assignment_row.status::text <> 'dnd_pending_retry'
     OR COALESCE(assignment_row.dnd_attempt_count, 0) <> 1 THEN
    RAISE EXCEPTION 'DND_RETRY_NOT_PENDING'
      USING ERRCODE = '23514';
  END IF;

  SELECT MAX(created_at) INTO first_photo_at FROM public.dnd_photos
  WHERE assignment_id = NEW.assignment_id AND room_id = NEW.room_id
    AND assignment_date = NEW.assignment_date AND attempt_number = 1;

  IF first_photo_at IS NULL OR assignment_row.dnd_first_attempt_at IS NULL THEN
    RAISE EXCEPTION 'DND_RETRY_FIRST_PHOTO_MISSING'
      USING ERRCODE = '23514';
  END IF;

  first_at := GREATEST(first_photo_at, assignment_row.dnd_first_attempt_at);
  eligible_at := public.hc_dnd_retry_ready_at(first_at);
  IF clock_timestamp() < eligible_at THEN
    RAISE EXCEPTION 'DND_RETRY_TOO_EARLY: available at % Budapest',
      to_char(eligible_at AT TIME ZONE 'Europe/Budapest', 'HH24:MI')
      USING ERRCODE = '23514';
  END IF;

  -- Never trust a client-supplied evidence time.
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS hc_guard_dnd_photo_second_visit ON public.dnd_photos;
CREATE TRIGGER hc_guard_dnd_photo_second_visit
BEFORE INSERT ON public.dnd_photos
FOR EACH ROW EXECUTE FUNCTION public.hc_guard_dnd_photo_second_visit();

CREATE OR REPLACE FUNCTION public.hc_guard_dnd_assignment_second_visit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
DECLARE
  first_photo_at timestamptz;
  second_photo_at timestamptz;
  eligible_at timestamptz;
BEGIN
  -- Set first-visit time from the saved evidence, not the mobile device's clock.
  IF NEW.status::text = 'dnd_pending_retry'
     AND OLD.status::text IS DISTINCT FROM 'dnd_pending_retry' THEN
    SELECT MAX(created_at) INTO first_photo_at FROM public.dnd_photos
    WHERE assignment_id = NEW.id AND room_id = NEW.room_id
      AND assignment_date = NEW.assignment_date AND attempt_number = 1;
    NEW.dnd_first_attempt_at := COALESCE(first_photo_at, clock_timestamp());
    NEW.dnd_attempt_count := 1;
    NEW.dnd_retry_unlocked_at := NULL;
  END IF;

  -- A completed DND must have a permitted second photo, not merely a client
  -- update that changes the task status to completed.
  IF OLD.status::text = 'dnd_pending_retry'
     AND NEW.status::text = 'completed' AND NEW.is_dnd IS TRUE THEN
    SELECT MAX(created_at) INTO first_photo_at FROM public.dnd_photos
    WHERE assignment_id = NEW.id AND room_id = NEW.room_id
      AND assignment_date = NEW.assignment_date AND attempt_number = 1;
    SELECT MAX(created_at) INTO second_photo_at FROM public.dnd_photos
    WHERE assignment_id = NEW.id AND room_id = NEW.room_id
      AND assignment_date = NEW.assignment_date AND attempt_number = 2;
    IF NEW.dnd_attempt_count <> 2 OR first_photo_at IS NULL
       OR second_photo_at IS NULL OR NEW.dnd_first_attempt_at IS NULL THEN
      RAISE EXCEPTION 'DND_RETRY_SECOND_PHOTO_REQUIRED'
        USING ERRCODE = '23514';
    END IF;
    eligible_at := public.hc_dnd_retry_ready_at(
      GREATEST(first_photo_at, NEW.dnd_first_attempt_at)
    );
    IF second_photo_at < eligible_at THEN
      RAISE EXCEPTION 'DND_RETRY_TOO_EARLY' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zzz_hc_guard_dnd_assignment_second_visit ON public.room_assignments;
CREATE TRIGGER zzz_hc_guard_dnd_assignment_second_visit
BEFORE UPDATE OF status, is_dnd, dnd_first_attempt_at, dnd_attempt_count
ON public.room_assignments FOR EACH ROW
EXECUTE FUNCTION public.hc_guard_dnd_assignment_second_visit();

REVOKE EXECUTE ON FUNCTION public.hc_dnd_retry_ready_at(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.hc_guard_dnd_photo_second_visit() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.hc_guard_dnd_assignment_second_visit() FROM PUBLIC, anon, authenticated;
