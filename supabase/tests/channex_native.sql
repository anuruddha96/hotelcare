-- Native rates & availability (HotelCare as PMS) on top of the channel manager foundation.
-- Run after: channex_fixture.sql, channex_native_fixture.sql, 20261113150000, 20261113160000, 20261113161000.
DO $$
DECLARE
  v_uid uuid := '00000000-0000-0000-0000-0000000000c1';
  n integer;
  r record;
  v_twin uuid; v_dbl uuid;
BEGIN
  INSERT INTO public.profiles (id, role, organization_slug, is_super_admin) VALUES (v_uid, 'admin', 'channex', true);
  INSERT INTO public.hotel_org VALUES ('channex-test-property', 'channex');
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, false);

  -- Seeded sandbox tenant
  SELECT count(*) INTO n FROM public.rate_plans WHERE hotel_id = 'channex-test-property';
  IF n <> 4 THEN RAISE EXCEPTION 'expected 4 rate plans, got %', n; END IF;
  IF (SELECT settings ? 'manager_email' FROM public.hotel_configurations WHERE hotel_id = 'channex-test-property') THEN
    RAISE EXCEPTION 'contact settings were cloned into the sandbox';
  END IF;
  IF NOT public.pms_ari_native_hotel('channex-test-property') OR public.pms_ari_native_hotel('memories-budapest') THEN
    RAISE EXCEPTION 'native gate wrong';
  END IF;

  INSERT INTO public.channex_connections (hotel_id, organization_slug, environment, mode, is_sandbox_hotel, channex_property_id, currency)
  VALUES ('channex-test-property', 'channex', 'staging', 'live', true, '11111111-2222-3333-4444-555555555555', 'USD');
  INSERT INTO public.channex_mappings (hotel_id, kind, local_id, channex_id)
  SELECT hotel_id, 'room_type', id, md5('rt' || name)::uuid FROM public.room_types WHERE hotel_id = 'channex-test-property';
  INSERT INTO public.channex_mappings (hotel_id, kind, local_id, channex_id)
  SELECT hotel_id, 'rate_plan', id, md5('rp' || code)::uuid FROM public.rate_plans WHERE hotel_id = 'channex-test-property';

  -- Test 3: one save on three rate plans -> three field-level signals keyed by rate plan
  PERFORM public.pms_ari_save('channex-test-property', jsonb_build_object('rates', jsonb_build_array(
    jsonb_build_object('rate_plan_id', (SELECT id FROM public.rate_plans WHERE code = 'TWIN-BAR'), 'date_from', '2027-11-21', 'rate', 333),
    jsonb_build_object('rate_plan_id', (SELECT id FROM public.rate_plans WHERE code = 'DBL-BAR'), 'date_from', '2027-11-25', 'rate', 444),
    jsonb_build_object('rate_plan_id', (SELECT id FROM public.rate_plans WHERE code = 'DBL-BB'), 'date_from', '2027-11-29', 'rate', 456.23))));
  SELECT count(*) INTO n FROM public.channex_rate_changes WHERE source = 'hotelcare_native' AND rate_plan_id IS NOT NULL AND currency = 'USD';
  IF n <> 3 THEN RAISE EXCEPTION 'expected 3 native rate signals, got %', n; END IF;

  -- Min stay only: the stored rate is preserved and only min stay is signalled
  PERFORM public.pms_ari_save('channex-test-property', jsonb_build_object('rates', jsonb_build_array(
    jsonb_build_object('rate_plan_id', (SELECT id FROM public.rate_plans WHERE code = 'TWIN-BAR'), 'date_from', '2027-11-21', 'min_stay_arrival', 3))));
  SELECT patch INTO r FROM public.channex_rate_changes ORDER BY id DESC LIMIT 1;
  IF r.patch <> '{"min_stay_arrival": 3}'::jsonb THEN RAISE EXCEPTION 'unexpected patch %', r.patch; END IF;
  IF (SELECT rate FROM public.pms_ari_rates WHERE date = '2027-11-21') <> 333 THEN RAISE EXCEPTION 'rate was overwritten'; END IF;

  -- Test 9: rooms to sell 8 / 1, then a booking each -> 7 / 0
  SELECT id INTO v_twin FROM public.room_types WHERE hotel_id = 'channex-test-property' AND name = 'Twin Room';
  SELECT id INTO v_dbl FROM public.room_types WHERE hotel_id = 'channex-test-property' AND name = 'Double Room';
  PERFORM public.pms_ari_save('channex-test-property', jsonb_build_object('availability', jsonb_build_array(
    jsonb_build_object('room_type_id', v_twin, 'date_from', '2027-11-21', 'availability', 8),
    jsonb_build_object('room_type_id', v_dbl, 'date_from', '2027-11-25', 'availability', 1))));
  INSERT INTO public.reservations (hotel_id, organization_slug, check_in_date, check_out_date, status, source, room_type_requested, source_reservation_id)
  VALUES ('channex-test-property', 'channex', '2027-11-21', '2027-11-22', 'confirmed', 'hotelcare', 'Twin Room', 'R1'),
         ('channex-test-property', 'channex', '2027-11-25', '2027-11-26', 'confirmed', 'hotelcare', 'Double Room', 'R2');
  SELECT availability INTO n FROM public.channex_room_type_availability('channex-test-property', '2027-11-21', '2027-11-25')
   WHERE room_type_id = v_twin AND stay_date = '2027-11-21';
  IF n <> 7 THEN RAISE EXCEPTION 'twin availability % <> 7', n; END IF;
  SELECT availability INTO n FROM public.channex_room_type_availability('channex-test-property', '2027-11-21', '2027-11-25')
   WHERE room_type_id = v_dbl AND stay_date = '2027-11-25';
  IF n <> 0 THEN RAISE EXCEPTION 'double availability % <> 0', n; END IF;

  -- Full sync source: every mapped plan for every night, stored values win over defaults
  SELECT count(*) INTO n FROM public.channex_full_sync_rates('channex-test-property', current_date, current_date + 499);
  IF n <> 2000 THEN RAISE EXCEPTION 'full sync rows % <> 2000', n; END IF;
  SELECT * INTO r FROM public.channex_full_sync_rates('channex-test-property', '2027-11-21', '2027-11-21')
   WHERE rate_plan_id = (SELECT id FROM public.rate_plans WHERE code = 'TWIN-BAR');
  IF r.price <> 333 OR r.min_stay <> 3 OR r.max_stay <> 0 OR r.stop_sell THEN RAISE EXCEPTION 'full sync row wrong %', row_to_json(r); END IF;

  -- Previo hotel untouched
  INSERT INTO public.reservations (hotel_id, check_in_date, check_out_date, source, source_reservation_id)
  VALUES ('memories-budapest', current_date + 1, current_date + 2, 'previo', 'X');
  IF EXISTS (SELECT 1 FROM public.pms_ari_availability WHERE hotel_id = 'memories-budapest') THEN RAISE EXCEPTION 'Previo hotel got native rows'; END IF;

  RAISE NOTICE 'channex_native ARI: OK';
END $$;

-- Bookings: two rooms, sandbox modification, cancellation, change after check-in
DO $$
DECLARE
  p constant text := '11111111-2222-3333-4444-555555555555';
  n integer;
  s text;
BEGIN
  INSERT INTO public.channex_booking_revisions (id, revision_id, channex_booking_id, channex_property_id, hotel_id, environment, revision_status, ota_name, ota_reservation_code, received_via)
  VALUES ('bbbbbbbb-0000-0000-0000-000000000001', 'native-rev-1', 'native-bk-1', p, 'channex-test-property', 'staging', 'new', 'Booking.com', 'BDC-1', 'feed'),
         ('bbbbbbbb-0000-0000-0000-000000000002', 'native-rev-2', 'native-bk-1', p, 'channex-test-property', 'staging', 'modified', 'Booking.com', 'BDC-1', 'feed'),
         ('bbbbbbbb-0000-0000-0000-000000000003', 'native-rev-3', 'native-bk-1', p, 'channex-test-property', 'staging', 'cancelled', 'Booking.com', 'BDC-1', 'feed'),
         ('bbbbbbbb-0000-0000-0000-000000000004', 'native-rev-4', 'native-bk-2', p, 'channex-test-property', 'staging', 'new', 'Booking.com', 'BDC-2', 'feed'),
         ('bbbbbbbb-0000-0000-0000-000000000005', 'native-rev-5', 'native-bk-2', p, 'channex-test-property', 'staging', 'modified', 'Booking.com', 'BDC-2', 'feed');

  s := public.channex_apply_revision('bbbbbbbb-0000-0000-0000-000000000001', 'new', '{"first_name":"Anna","last_name":"Kovacs"}',
    '[{"room_index":0,"room_type_name":"Twin Room","check_in_date":"2027-12-10","check_out_date":"2027-12-12","adults":2,"total_amount":"200.00","rate_per_night":"100.00","currency":"USD"},
      {"room_index":1,"room_type_name":"Double Room","check_in_date":"2027-12-10","check_out_date":"2027-12-12","adults":2,"total_amount":"240.00","rate_per_night":"120.00","currency":"USD"}]')->>'state';
  SELECT count(*) INTO n FROM public.reservations WHERE channex_booking_id = 'native-bk-1' AND status = 'confirmed';
  IF s <> 'applied' OR n <> 2 THEN RAISE EXCEPTION 'two-room booking: state %, rooms %', s, n; END IF;

  s := public.channex_apply_revision('bbbbbbbb-0000-0000-0000-000000000002', 'modify', '{}',
    '[{"room_index":0,"room_type_name":"Twin Room","check_in_date":"2027-12-10","check_out_date":"2027-12-13","adults":2,"total_amount":"300.00","rate_per_night":"100.00","currency":"USD"}]')->>'state';
  IF s <> 'applied' THEN RAISE EXCEPTION 'modify state %', s; END IF;
  IF (SELECT check_out_date FROM public.reservations WHERE channex_booking_id = 'native-bk-1' AND channex_room_index = 0) <> '2027-12-13'
     OR (SELECT status FROM public.reservations WHERE channex_booking_id = 'native-bk-1' AND channex_room_index = 1) <> 'cancelled' THEN
    RAISE EXCEPTION 'modification not applied';
  END IF;

  s := public.channex_apply_revision('bbbbbbbb-0000-0000-0000-000000000003', 'cancelled', NULL, NULL)->>'state';
  SELECT count(*) INTO n FROM public.reservations WHERE channex_booking_id = 'native-bk-1' AND status <> 'cancelled';
  IF s <> 'applied' OR n <> 0 THEN RAISE EXCEPTION 'cancellation: state %, open rooms %', s, n; END IF;

  PERFORM public.channex_apply_revision('bbbbbbbb-0000-0000-0000-000000000004', 'new', '{"first_name":"Bo","last_name":"Li"}',
    '[{"room_index":0,"room_type_name":"Double Room","check_in_date":"2027-12-20","check_out_date":"2027-12-21","adults":2,"total_amount":"120","rate_per_night":"120","currency":"USD"}]');
  UPDATE public.reservations SET actual_check_in = now(), status = 'checked_in' WHERE channex_booking_id = 'native-bk-2';
  s := public.channex_apply_revision('bbbbbbbb-0000-0000-0000-000000000005', 'modify', '{}',
    '[{"room_index":0,"room_type_name":"Double Room","check_in_date":"2027-12-20","check_out_date":"2027-12-23","adults":2,"total_amount":"360","rate_per_night":"120","currency":"USD"}]')->>'state';
  IF s <> 'review' THEN RAISE EXCEPTION 'change after check-in should be a review case, got %', s; END IF;

  RAISE NOTICE 'channex_native bookings: OK';
END $$;
