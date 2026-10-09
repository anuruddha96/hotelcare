-- Portfolio-wide regression. Even if a stale migration restores the
-- legacy trigger, its function must never create a manager review.
DO $test$
DECLARE
  work_day date := (now() AT TIME ZONE 'Europe/Budapest')::date;
  target_room uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  n integer;
BEGIN
  SELECT count(*) INTO n FROM public.housekeeping_stay_extension_reviews WHERE status <> 'resolved';
  IF n <> 0 THEN
    RAISE EXCEPTION 'Pending speculative review survived retirement';
  END IF;

  -- Simulate stale migration recreating the trigger after rollout.
  CREATE TRIGGER zzz_hc_detect_stay_extension
  AFTER UPDATE OF pms_metadata, guest_nights_stayed, is_checkout_room ON public.rooms
  FOR EACH ROW WHEN (OLD.pms_metadata IS DISTINCT FROM NEW.pms_metadata)
  EXECUTE FUNCTION public.hc_record_stay_extension_review();

  INSERT INTO public.rooms(id, hotel, organization_slug, is_checkout_room, guest_nights_stayed, pms_metadata)
  VALUES (target_room, 'Hotel Ottofiori', 'rdhotels', true, 1,
    jsonb_build_object('pmsProvider', 'previo', 'pmsSyncDate', work_day::text,
      'currentNight', 1, 'totalNights', 1,
      'arrivalDate', (work_day - 1)::text, 'departureDate', work_day::text));

  -- A new arrival after the previous guest checked out, not an extension.
  UPDATE public.rooms
  SET is_checkout_room = false, guest_nights_stayed = 1,
      pms_metadata = pms_metadata || jsonb_build_object(
        'currentNight', 1, 'totalNights', 3,
        'arrivalDate', work_day::text, 'departureDate', (work_day + 3)::text,
        'continuousStay', jsonb_build_object(
          'linkedBy', 'previo_chain', 'confidence', 'probable',
          'reservationIds', jsonb_build_array('old', 'new')))
  WHERE id = target_room;

  IF EXISTS (
    SELECT 1 FROM public.housekeeping_stay_extension_reviews
    WHERE room_id = target_room AND status <> 'resolved'
  ) THEN RAISE EXCEPTION 'Legacy review writer resurrected misleading candidate'; END IF;

  -- A real explicit manager override still persists its room metadata.
  UPDATE public.rooms SET is_checkout_room = true,
      pms_metadata = pms_metadata || jsonb_build_object(
        'manual_checkout', true, 'manual_daily', false,
        'manual_moved_date', work_day::text,
        'manual_moved_at', work_day::text || 'T09:00:00+02:00')
  WHERE id = target_room;

  IF NOT EXISTS (
    SELECT 1 FROM public.rooms WHERE id=target_room AND is_checkout_room=true
      AND pms_metadata->>'manual_checkout' = 'true'
  ) THEN RAISE EXCEPTION 'Manual early-checkout override no longer preserved'; END IF;
  RAISE NOTICE 'PASS: no speculative extension reviews; manual status overrides remain available';
END;
$test$;

DROP TRIGGER IF EXISTS zzz_hc_detect_stay_extension ON public.rooms;
