-- Regression: only evidence-backed extension candidates reach the manager queue.
DO $test$
DECLARE
  work_day date := (now() AT TIME ZONE 'Europe/Budapest')::date;
  org_id uuid;
  snapshot_room uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  chain_room uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
  manual_room uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
  review public.housekeeping_stay_extension_reviews%ROWTYPE;
  review_count integer;
BEGIN
  INSERT INTO public.organizations(id, slug)
  VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa00', 'rdhotels')
  ON CONFLICT (slug) DO NOTHING;

  SELECT id INTO org_id FROM public.organizations WHERE slug = 'rdhotels' LIMIT 1;

  INSERT INTO public.hotel_configurations(hotel_id, hotel_name, organization_id)
  SELECT 'ottofiori', 'Hotel Ottofiori', org_id
  WHERE NOT EXISTS (
    SELECT 1 FROM public.hotel_configurations
    WHERE hotel_id = 'ottofiori' OR hotel_name = 'Hotel Ottofiori'
  );

  -- 1) Snapshot-only change: same reservation, checkout moved by one day.
  -- This is exactly the class of false positive seen on Ottofiori room 101.
  INSERT INTO public.rooms(
    id, hotel, organization_slug, is_checkout_room, guest_nights_stayed, pms_metadata
  ) VALUES (
    snapshot_room, 'Hotel Ottofiori', 'rdhotels', true, 1,
    jsonb_build_object(
      'pmsProvider', 'previo',
      'pmsSyncDate', work_day::text,
      'lastPmsRefreshDate', work_day::text,
      'currentNight', 1,
      'totalNights', 1,
      'arrivalDate', (work_day - 1)::text,
      'departureDate', work_day::text,
      'scheduledDepartureToday', true,
      'continuousStay', jsonb_build_object(
        'linkedBy', 'pms_snapshot',
        'confidence', 'strong',
        'reservationIds', jsonb_build_array('R101'),
        'segments', jsonb_build_array(
          jsonb_build_object(
            'reservationId', 'R101',
            'arrivalDate', (work_day - 1)::text,
            'departureDate', work_day::text,
            'nights', 1
          )
        ),
        'currentNight', 1,
        'totalNights', 1
      )
    )
  );

  UPDATE public.rooms
  SET is_checkout_room = false,
      guest_nights_stayed = 2,
      pms_metadata = pms_metadata
        || jsonb_build_object(
          'currentNight', 2,
          'totalNights', 2,
          'departureDate', (work_day + 1)::text,
          'scheduledDepartureToday', false,
          'occupiedToday', true,
          'stayThroughToday', true,
          'continuousStay', jsonb_build_object(
            'linkedBy', 'pms_snapshot',
            'confidence', 'strong',
            'reservationIds', jsonb_build_array('R101'),
            'segments', jsonb_build_array(
              jsonb_build_object(
                'reservationId', 'R101',
                'arrivalDate', (work_day - 1)::text,
                'departureDate', (work_day + 1)::text,
                'nights', 2
              )
            ),
            'currentNight', 2,
            'totalNights', 2
          )
        )
  WHERE id = snapshot_room;

  SELECT count(*) INTO review_count
  FROM public.housekeeping_stay_extension_reviews
  WHERE room_id = snapshot_room AND status <> 'resolved';

  IF review_count <> 0 THEN
    RAISE EXCEPTION 'Snapshot-only checkout-date change created a false extension review';
  END IF;

  -- 2) Real Previo evidence: two contiguous same-guest reservation segments.
  INSERT INTO public.rooms(
    id, hotel, organization_slug, is_checkout_room, guest_nights_stayed, pms_metadata
  ) VALUES (
    chain_room, 'Hotel Ottofiori', 'rdhotels', true, 1,
    jsonb_build_object(
      'pmsProvider', 'previo',
      'pmsSyncDate', work_day::text,
      'lastPmsRefreshDate', work_day::text,
      'currentNight', 1,
      'totalNights', 1,
      'arrivalDate', (work_day - 1)::text,
      'departureDate', work_day::text,
      'scheduledDepartureToday', true,
      'continuousStay', jsonb_build_object(
        'linkedBy', 'pms_snapshot',
        'confidence', 'strong',
        'reservationIds', jsonb_build_array('A'),
        'segments', jsonb_build_array(
          jsonb_build_object(
            'reservationId', 'A',
            'arrivalDate', (work_day - 1)::text,
            'departureDate', work_day::text,
            'nights', 1
          )
        ),
        'currentNight', 1,
        'totalNights', 1
      )
    )
  );

  UPDATE public.rooms
  SET is_checkout_room = false,
      guest_nights_stayed = 2,
      pms_metadata = pms_metadata
        || jsonb_build_object(
          'currentNight', 2,
          'totalNights', 2,
          'departureDate', (work_day + 1)::text,
          'scheduledDepartureToday', false,
          'occupiedToday', true,
          'stayThroughToday', true,
          'continuousStay', jsonb_build_object(
            'linkedBy', 'previo_chain',
            'confidence', 'probable',
            'reservationIds', jsonb_build_array('A', 'B'),
            'segments', jsonb_build_array(
              jsonb_build_object(
                'reservationId', 'A',
                'arrivalDate', (work_day - 1)::text,
                'departureDate', work_day::text,
                'nights', 1
              ),
              jsonb_build_object(
                'reservationId', 'B',
                'arrivalDate', work_day::text,
                'departureDate', (work_day + 1)::text,
                'nights', 1
              )
            ),
            'currentNight', 2,
            'totalNights', 2
          )
        )
  WHERE id = chain_room;

  SELECT * INTO review
  FROM public.housekeeping_stay_extension_reviews
  WHERE room_id = chain_room AND status <> 'resolved';

  IF review.id IS NULL OR review.identity_status <> 'needs_verification' THEN
    RAISE EXCEPTION 'Evidence-backed Previo chain did not create a review';
  END IF;

  -- Dismissing a different guest must not require a note.
  PERFORM public.hc_acknowledge_stay_extension(review.id, false, NULL, true);
  SELECT * INTO review
  FROM public.housekeeping_stay_extension_reviews
  WHERE id = review.id;

  IF review.status <> 'resolved' OR review.resolution_note IS NOT NULL THEN
    RAISE EXCEPTION 'Different-guest dismissal still requires or invents a note';
  END IF;

  -- 3) Explicit Checkout -> Daily in HotelCare is sufficient evidence even
  -- while the replacement Previo reservation is not available yet.
  INSERT INTO public.rooms(
    id, hotel, organization_slug, is_checkout_room, guest_nights_stayed, pms_metadata
  ) VALUES (
    manual_room, 'Hotel Ottofiori', 'rdhotels', true, 2,
    jsonb_build_object(
      'pmsProvider', 'previo',
      'pmsSyncDate', work_day::text,
      'lastPmsRefreshDate', work_day::text,
      'currentNight', 2,
      'totalNights', 2,
      'arrivalDate', (work_day - 2)::text,
      'departureDate', work_day::text,
      'scheduledDepartureToday', true
    )
  );

  UPDATE public.rooms
  SET is_checkout_room = false,
      guest_nights_stayed = 3,
      pms_metadata = pms_metadata
        || jsonb_build_object(
          'currentNight', 3,
          'totalNights', 3,
          'manual_daily', true,
          'manual_checkout', false,
          'manual_moved_date', work_day::text,
          'manual_moved_at', work_day::text || 'T09:00:00+02:00',
          'manual_moved_by', 'manager-test',
          'scheduledDepartureToday', false,
          'occupiedToday', true,
          'stayThroughToday', true
        )
  WHERE id = manual_room;

  SELECT * INTO review
  FROM public.housekeeping_stay_extension_reviews
  WHERE room_id = manual_room AND status <> 'resolved';

  IF review.id IS NULL
     OR review.identity_status <> 'verified'
     OR review.status <> 'acknowledged'
  THEN
    RAISE EXCEPTION 'Explicit HotelCare Checkout -> Daily did not create an auto-verified review';
  END IF;

  RAISE NOTICE 'PASS: extension queue requires manager or multi-reservation evidence; dismiss note is optional';
END;
$test$;
