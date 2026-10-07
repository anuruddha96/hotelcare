-- Disposable CI regression for manager-confirmed stay continuity.
DO $test$
DECLARE
  work_day date := (now() AT TIME ZONE 'Europe/Budapest')::date;
  room_id uuid := '77777777-7777-4777-8777-777777777777';
  r public.rooms%ROWTYPE;
  review public.housekeeping_stay_extension_reviews%ROWTYPE;
BEGIN
  INSERT INTO public.rooms(
    id, hotel, organization_slug, is_checkout_room, guest_nights_stayed, pms_metadata
  ) VALUES (
    room_id,
    'Hotel Memories Budapest',
    'rdhotels',
    false,
    4,
    jsonb_build_object(
      'pmsSyncDate', work_day::text,
      'lastPmsRefreshDate', work_day::text,
      'currentNight', 4,
      'totalNights', 4,
      'arrivalDate', (work_day - 3)::text,
      'manual_daily', true,
      'manual_checkout', false,
      'manual_moved_date', work_day::text,
      'manual_moved_at', work_day::text || 'T09:00:00+02:00',
      'manual_moved_by', '00000000-0000-4000-8000-000000000001',
      'occupiedToday', true,
      'scheduledDepartureToday', false
    )
  );

  -- The real extension arrives after the manager already confirmed the guest
  -- is staying. The review must not ask that manager/reception to verify again.
  UPDATE public.rooms
  SET guest_nights_stayed = 5,
      pms_metadata = pms_metadata
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

  IF review.id IS NULL THEN
    RAISE EXCEPTION 'Expected extension review was not recorded';
  END IF;
  IF review.identity_status <> 'verified' OR review.status <> 'acknowledged' THEN
    RAISE EXCEPTION 'Manager-confirmed extension was not auto-verified/acknowledged: %/%',
      review.identity_status, review.status;
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
