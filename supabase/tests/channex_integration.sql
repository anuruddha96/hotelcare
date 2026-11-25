-- Assertions for 20261113150000_channex_channel_manager.sql on disposable PostgreSQL.
\set ON_ERROR_STOP 1

INSERT INTO public.hotel_org VALUES ('sandbox-hotel', 'org-a'), ('real-hotel', 'org-a'), ('other-org-hotel', 'org-b');
INSERT INTO public.profiles (id, role, organization_slug, assigned_hotel) VALUES
  ('00000000-0000-0000-0000-00000000000a', 'manager', 'org-a', 'sandbox-hotel'),
  ('00000000-0000-0000-0000-00000000000b', 'manager', 'org-b', 'other-org-hotel');

-- 1. Gates -----------------------------------------------------------------
INSERT INTO public.channex_connections (hotel_id, organization_slug, environment, mode, is_sandbox_hotel, channex_property_id, currency)
VALUES ('sandbox-hotel', 'org-a', 'staging', 'live', true, '11111111-1111-1111-1111-111111111111', 'EUR');

DO $$ BEGIN
  BEGIN
    INSERT INTO public.channex_connections (hotel_id, organization_slug, environment, mode) VALUES ('real-hotel', 'org-a', 'staging', 'live');
    RAISE EXCEPTION 'FAIL: staging live allowed for a non-sandbox hotel';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO public.channex_connections (hotel_id, organization_slug, environment, mode) VALUES ('real-hotel', 'org-a', 'production', 'live');
    RAISE EXCEPTION 'FAIL: production live allowed without compliance checklist';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

INSERT INTO public.channex_connections (hotel_id, organization_slug, environment, mode) VALUES ('real-hotel', 'org-a', 'production', 'off');
DO $$ BEGIN
  BEGIN
    UPDATE public.channex_connections SET mode = 'live', ntak_reporting_path = 'previo_receives_bookings',
      viza_document_scan_confirmed = true, tax_settings_confirmed = true, dpa_signed = true, single_publisher_confirmed = true
    WHERE hotel_id = 'real-hotel';
    RAISE EXCEPTION 'FAIL: production live allowed without certification/owner approval';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
-- Fully satisfied gate works.
UPDATE public.channex_connections SET mode = 'live', ntak_reporting_path = 'previo_receives_bookings',
  viza_document_scan_confirmed = true, tax_settings_confirmed = true, dpa_signed = true, single_publisher_confirmed = true,
  certified_at = now(), owner_approved_at = now()
WHERE hotel_id = 'real-hotel';
UPDATE public.channex_connections SET mode = 'off' WHERE hotel_id = 'real-hotel';

-- 2. Availability signals ---------------------------------------------------
INSERT INTO public.room_types (id, hotel_id, organization_slug, name, num_rooms) VALUES
  ('22222222-2222-2222-2222-222222222222', 'sandbox-hotel', 'org-a', 'Double', 3);
INSERT INTO public.channex_mappings (hotel_id, kind, local_id, channex_id) VALUES
  ('sandbox-hotel', 'room_type', '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333'),
  ('sandbox-hotel', 'rate_plan', '22222222-2222-2222-2222-222222222222', '44444444-4444-4444-4444-444444444444');

INSERT INTO public.reservations (hotel_id, room_type_requested, status, check_in_date, check_out_date)
VALUES ('sandbox-hotel', 'Double', 'confirmed', current_date + 10, current_date + 12),
       ('real-hotel', 'Double', 'confirmed', current_date + 10, current_date + 12);

DO $$ DECLARE n integer; f date; t date; BEGIN
  SELECT count(*), min(date_from), max(date_to) INTO n, f, t FROM public.channex_availability_dirty;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL: expected 1 dirty row (connected hotel only), got %', n; END IF;
  IF f <> current_date + 10 OR t <> current_date + 11 THEN RAISE EXCEPTION 'FAIL: dirty range % .. %', f, t; END IF;
END $$;

-- Overbooking clamps to 0, cancelled does not count.
INSERT INTO public.reservations (hotel_id, room_type_requested, status, check_in_date, check_out_date) VALUES
  ('sandbox-hotel', 'Double', 'confirmed', current_date + 10, current_date + 11),
  ('sandbox-hotel', 'Double', 'confirmed', current_date + 10, current_date + 11),
  ('sandbox-hotel', 'Double', 'confirmed', current_date + 10, current_date + 11),
  ('sandbox-hotel', 'Double', 'cancelled', current_date + 11, current_date + 12);

DO $$ DECLARE a10 integer; a11 integer; a12 integer; BEGIN
  SELECT availability INTO a10 FROM public.channex_room_type_availability('sandbox-hotel', current_date + 10, current_date + 12) WHERE stay_date = current_date + 10;
  SELECT availability INTO a11 FROM public.channex_room_type_availability('sandbox-hotel', current_date + 10, current_date + 12) WHERE stay_date = current_date + 11;
  SELECT availability INTO a12 FROM public.channex_room_type_availability('sandbox-hotel', current_date + 10, current_date + 12) WHERE stay_date = current_date + 12;
  IF a10 <> 0 THEN RAISE EXCEPTION 'FAIL: overbooked night should be 0, got %', a10; END IF;
  IF a11 <> 2 THEN RAISE EXCEPTION 'FAIL: night 11 expected 2 (cancelled ignored), got %', a11; END IF;
  IF a12 <> 3 THEN RAISE EXCEPTION 'FAIL: checkout night expected 3, got %', a12; END IF;
END $$;

-- 3. Rate deltas from the revenue engine ------------------------------------
INSERT INTO public.revenue_rate_push_items (hotel_id, stay_date, room_type_name, occupancy, target_price, currency) VALUES
  ('sandbox-hotel', current_date + 20, 'Double', 2, 123.4, 'EUR'),
  ('sandbox-hotel', current_date + 20, 'Double', 1, 99, 'EUR'),      -- not primary occupancy: ignored
  ('real-hotel', current_date + 20, 'Double', 2, 150, 'EUR');        -- hotel off: ignored
DO $$ DECLARE n integer; p jsonb; BEGIN
  SELECT count(*), max(patch::text)::jsonb INTO n, p FROM public.channex_rate_changes;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL: expected 1 rate change, got %', n; END IF;
  IF p->>'rate' <> '123.40' THEN RAISE EXCEPTION 'FAIL: rate formatted as %', p->>'rate'; END IF;
END $$;

-- 3b. Full sync rate source: latest capture, primary occupancy, base plan only ----
INSERT INTO public.revenue_room_type_rates (hotel_id, stay_date, room_type_name, rate_plan_id, occupancy, price, min_stay, closed_to_arrival, captured_at) VALUES
  ('sandbox-hotel', current_date + 5, 'Double', 'base', 2, 100, NULL, false, now() - interval '2 hours'),
  ('sandbox-hotel', current_date + 5, 'Double', 'base', 2, 110, 2, true, now() - interval '1 hour'),   -- newest wins
  ('sandbox-hotel', current_date + 5, 'Double', 'base', 1, 80, NULL, false, now()),                    -- other occupancy
  ('sandbox-hotel', current_date + 5, 'Double', 'nonref', 2, 90, NULL, false, now()),                  -- other plan
  ('sandbox-hotel', current_date + 6, 'Double', 'base', 2, 0, NULL, false, now()),                     -- no price: skipped
  ('real-hotel', current_date + 5, 'Double', 'base', 2, 999, NULL, false, now());                      -- unmapped hotel
DO $$ DECLARE n integer; p numeric; ms integer; cta boolean; BEGIN
  SELECT count(*) INTO n FROM public.channex_full_sync_rates('sandbox-hotel', current_date, current_date + 30);
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL: full sync rates expected 1 night, got %', n; END IF;
  SELECT price, min_stay, closed_to_arrival INTO p, ms, cta FROM public.channex_full_sync_rates('sandbox-hotel', current_date, current_date + 30);
  IF p <> 110 OR ms <> 2 OR NOT cta THEN RAISE EXCEPTION 'FAIL: full sync picked % / % / %', p, ms, cta; END IF;
  SELECT count(*) INTO n FROM public.channex_full_sync_rates('real-hotel', current_date, current_date + 30);
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL: unmapped hotel returned rates'; END IF;
END $$;

-- 4. Booking revisions -------------------------------------------------------
INSERT INTO public.channex_booking_revisions (id, revision_id, channex_booking_id, channex_property_id, hotel_id, environment,
  revision_status, ota_name, ota_reservation_code, arrival_date, departure_date, payload, received_via)
VALUES ('55555555-5555-5555-5555-555555555555', 'rev-1', 'bk-1', '11111111-1111-1111-1111-111111111111', 'sandbox-hotel', 'staging',
  'new', 'Booking.com', 'BDC-1', current_date + 30, current_date + 32, '{"customer":{"name":"Anna"}}', 'webhook');

SELECT public.channex_apply_revision('55555555-5555-5555-5555-555555555555', 'new',
  '{"first_name":"Anna","last_name":"Kovács","email":"a@example.test","country":"HU","payment_collect":"ota"}',
  jsonb_build_array(jsonb_build_object('room_index', 0, 'room_type_name', 'Double', 'check_in_date', current_date + 30,
    'check_out_date', current_date + 32, 'adults', 2, 'children', 0, 'total_amount', '230.00', 'rate_per_night', '115.00', 'currency', 'EUR')));

DO $$ DECLARE n integer; s text; src text; BEGIN
  SELECT count(*), max(status::text), max(source) INTO n, s, src FROM public.reservations WHERE channex_booking_id = 'bk-1';
  IF n <> 1 OR s <> 'confirmed' OR src <> 'channex' THEN RAISE EXCEPTION 'FAIL: new booking not created (% % %)', n, s, src; END IF;
  SELECT state INTO s FROM public.channex_booking_revisions WHERE revision_id = 'rev-1';
  IF s <> 'applied' THEN RAISE EXCEPTION 'FAIL: revision state %', s; END IF;
END $$;

-- Re-applying is a no-op.
SELECT public.channex_apply_revision('55555555-5555-5555-5555-555555555555', 'new', '{}', '[]');
-- A second "new" revision of the same booking (resend) links instead of duplicating.
INSERT INTO public.channex_booking_revisions (id, revision_id, channex_booking_id, channex_property_id, hotel_id, environment, revision_status, received_via)
VALUES ('55555555-5555-5555-5555-555555555556', 'rev-1b', 'bk-1', '11111111-1111-1111-1111-111111111111', 'sandbox-hotel', 'staging', 'new', 'feed');
SELECT public.channex_apply_revision('55555555-5555-5555-5555-555555555556', 'new', '{"first_name":"X"}',
  jsonb_build_array(jsonb_build_object('room_index', 0, 'room_type_name', 'Double', 'check_in_date', current_date + 30, 'check_out_date', current_date + 32)));
DO $$ DECLARE n integer; g integer; BEGIN
  SELECT count(*) INTO n FROM public.reservations WHERE channex_booking_id = 'bk-1';
  SELECT count(*) INTO g FROM public.guests;
  IF n <> 1 OR g <> 1 THEN RAISE EXCEPTION 'FAIL: duplicate delivery created rows (res %, guests %)', n, g; END IF;
END $$;

-- Modification goes to a review case, booking untouched.
INSERT INTO public.channex_booking_revisions (id, revision_id, channex_booking_id, channex_property_id, hotel_id, environment, revision_status, received_via)
VALUES ('55555555-5555-5555-5555-555555555557', 'rev-2', 'bk-1', '11111111-1111-1111-1111-111111111111', 'sandbox-hotel', 'staging', 'modified', 'feed');
SELECT public.channex_apply_revision('55555555-5555-5555-5555-555555555557', 'review', NULL, NULL, 'ota_modification', '{"changes":["dates"]}');
DO $$ DECLARE n integer; BEGIN
  SELECT count(*) INTO n FROM public.channex_review_cases WHERE reason = 'ota_modification' AND array_length(reservation_ids, 1) = 1;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL: modification review case missing'; END IF;
END $$;

-- Cancellation cancels.
INSERT INTO public.channex_booking_revisions (id, revision_id, channex_booking_id, channex_property_id, hotel_id, environment, revision_status, ota_name, received_via)
VALUES ('55555555-5555-5555-5555-555555555558', 'rev-3', 'bk-1', '11111111-1111-1111-1111-111111111111', 'sandbox-hotel', 'staging', 'cancelled', 'Booking.com', 'webhook');
SELECT public.channex_apply_revision('55555555-5555-5555-5555-555555555558', 'cancelled', NULL, NULL);
DO $$ DECLARE s text; BEGIN
  SELECT status::text INTO s FROM public.reservations WHERE channex_booking_id = 'bk-1';
  IF s <> 'cancelled' THEN RAISE EXCEPTION 'FAIL: cancellation not applied (%)', s; END IF;
END $$;

-- Cancellation of a booking we never held becomes a review case.
INSERT INTO public.channex_booking_revisions (id, revision_id, channex_booking_id, channex_property_id, hotel_id, environment, revision_status, received_via)
VALUES ('55555555-5555-5555-5555-555555555559', 'rev-4', 'bk-unknown', '11111111-1111-1111-1111-111111111111', 'sandbox-hotel', 'staging', 'cancelled', 'feed');
SELECT public.channex_apply_revision('55555555-5555-5555-5555-555555555559', 'cancelled', NULL, NULL);
DO $$ DECLARE s text; BEGIN
  SELECT state INTO s FROM public.channex_booking_revisions WHERE revision_id = 'rev-4';
  IF s <> 'review' THEN RAISE EXCEPTION 'FAIL: unknown cancellation state %', s; END IF;
END $$;

-- Property mismatch is refused.
INSERT INTO public.channex_booking_revisions (id, revision_id, channex_booking_id, channex_property_id, hotel_id, environment, revision_status, received_via)
VALUES ('55555555-5555-5555-5555-55555555555a', 'rev-5', 'bk-5', '99999999-9999-9999-9999-999999999999', 'sandbox-hotel', 'staging', 'new', 'feed');
DO $$ BEGIN
  BEGIN
    PERFORM public.channex_apply_revision('55555555-5555-5555-5555-55555555555a', 'new', '{}', '[]');
    RAISE EXCEPTION 'FAIL: property mismatch applied';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF;
  END;
END $$;

-- 5. RLS and privileges ------------------------------------------------------
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
DO $$ DECLARE n integer; BEGIN
  SELECT count(*) INTO n FROM public.channex_connections;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL: other organisation sees % connections', n; END IF;
  SELECT count(*) INTO n FROM public.channex_booking_revisions;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL: other organisation sees % revisions', n; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
DO $$ DECLARE n integer; BEGIN
  SELECT count(*) INTO n FROM public.channex_connections;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL: own-hotel manager sees % connections (expected 1)', n; END IF;
  BEGIN
    UPDATE public.channex_connections SET kill_switch = true;
    RAISE EXCEPTION 'FAIL: authenticated user could update a connection';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.channex_apply_revision('55555555-5555-5555-5555-555555555555', 'new', '{}', '[]');
    RAISE EXCEPTION 'FAIL: authenticated user could call channex_apply_revision';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.get_channex_webhook_secret();
    RAISE EXCEPTION 'FAIL: authenticated user could read the webhook secret';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

-- 6. PII purge -------------------------------------------------------------
UPDATE public.channex_booking_revisions SET departure_date = current_date - 120 WHERE revision_id = 'rev-1';
SELECT public.channex_purge_revision_pii();
DO $$ DECLARE p jsonb; BEGIN
  SELECT payload INTO p FROM public.channex_booking_revisions WHERE revision_id = 'rev-1';
  IF p ? 'customer' THEN RAISE EXCEPTION 'FAIL: guest data not purged'; END IF;
END $$;

SELECT 'channex SQL checks passed' AS result;
