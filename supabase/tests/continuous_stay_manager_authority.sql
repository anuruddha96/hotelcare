-- Disposable CI regression for manager-confirmed stay continuity.
DO $test$
DECLARE
  work_day date := (now() AT TIME ZONE 'Europe/Budapest')::date;
  room_id uuid := '77777777-7777-4777-8777-777777777777';
  r public.rooms%ROWTYPE;
  review public.housekeeping_stay_extension_reviews%ROWTYPE;
BEGIN
  -- Start exactly where Room 117 starts: Previo still reports a checkout
  -- reservation with four completed nights.
  INSERT INTO public.rooms(
    id, hotel, organization_slug, is_checkout_room, guest_nights_stayed, pms_metadata
  ) VALUES (
    room_id,
    'Hotel Memories Budapest',
    'rdhotels',
    true,
    4,
    jsonb_build_object(
      'pmsSyncDate', work_day::text,
      'lastPmsRefreshDate', work_day::text,
      'currentNight', 4,
      'totalNights', 4,
      'arrivalDate', (work_day - 4)::text,
      'departureDate', work_day::text,
      'occupiedToday', false,
      'scheduledDepartureToday', true
    )
  );

  -- Éva/manager confirms the guest is staying. HotelCare opens one provisional
  -- additional stay night and records the explicit manual decision.
  UPDATE public.rooms
  SET is_checkout_room = false,
      guest_nights_stayed = 5,
      pms_metadata = pms_metadata
        || jsonb_build_object(
          'currentNight', 5,
          'totalNights', 5,
          'manual_daily', true,
          'manual_checkout', false,
          'manual_moved_date', work_day::text,
          'manual_moved_at', work_day::text || 'T09:00:00+02:00',
          'manual_moved_by', '00000000-0000-4000-8000-000000000001',
          'occupiedToday', true,
          'stayThroughToday', true,
          'scheduledDepartureToday', false,
          'checkedOutToday', false
        )
  WHERE id = room_id;

  SELECT * INTO review
  FROM public.housekeeping_stay_extension_reviews
  WHERE room_id = room_id;

  IF review.id IS NULL THEN
    RAISE EXCEPTION 'Manager-confirmed provisional extension review was not recorded';
  END IF;
  IF review.identity_status <> 'verified' OR review.status <> 'acknowledged' THEN
    RAISE EXCEPTION 'Manager-confirmed extension was not auto-verified/acknowledged: %/%',
      review.identity_status, review.status;
  END IF;

  -- The real replacement Previo reservation then expands the continuous stay.
  -- It must update the same review without reopening identity verification.
  UPDATE public.rooms
  SET pms_metadata = pms_metadata
        || jsonb_build_object(
          'currentNight', 5,
          'totalNights', 7,
          'departureDate', (work_day + 3)::text,
          'occupiedToday', true,
          'stayThroughToday', true
        )
  WHERE id = room_id;

  SELECT * INTO review
  FROM public.housekeeping_stay_extension_reviews
  WHERE room_id = room_id;

  IF review.identity_status <> 'verified' OR review.status <> 'acknowledged'
     OR review.planned_nights <> 7 THEN
    RAISE EXCEPTION 'Real Previo extension reopened identity review or lost total nights: %/%/%',
      review.identity_status, review.status, review.planned_nights;
  END IF;

  -- A later strong-identity PMS turnover is allowed to invalidate the same-day
  -- stayover bridge. Ordinary PMS writes remain protected by the legacy test.
  UPDATE public.rooms
  SET is_checkout_room = true,
      pms_metadata = jsonb_build_object(
        'pmsSyncDate', work_day::text,
        'lastPmsRefreshDate', work_day::text,
        'currentNight', 5,
        'totalNights', 5,
        'scheduledDepartureToday', true,
        'checkedOutToday', false,
        'manualOverrideResetReason', 'definitive_new_guest',
        'manualOverrideResetAt', now()::text
      )
  WHERE id = room_id;

  SELECT * INTO r FROM public.rooms WHERE id = room_id;
  IF NOT r.is_checkout_room THEN
    RAISE EXCEPTION 'Verified different-guest turnover could not restore checkout';
  END IF;
  IF r.pms_metadata ? 'manual_daily'
     OR r.pms_metadata ? 'manual_checkout'
     OR r.pms_metadata ? 'manual_moved_at'
     OR r.pms_metadata ? 'manualOverrideResetReason'
  THEN
    RAISE EXCEPTION 'Manual extension markers survived a definitive new guest reset';
  END IF;
  IF r.pms_metadata ->> 'lastManualOverrideResetReason' <> 'definitive_new_guest' THEN
    RAISE EXCEPTION 'Turnover reset audit reason was not preserved';
  END IF;

  RAISE NOTICE 'PASS manager-confirmed extension auto-verification and definitive turnover reset';
END;
$test$;
