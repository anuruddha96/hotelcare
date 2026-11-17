-- Booking engine integration test. Runs after booking_engine_fixture.sql and the
-- 20261117140000_booking_engine.sql migration. Every check raises on failure.

CREATE SCHEMA t;

CREATE FUNCTION t.book(p_public_id text, p_in date, p_out date, p_rooms jsonb,
                       p_email text DEFAULT 'Anna@Example.org', p_marketing boolean DEFAULT false,
                       p_token text DEFAULT repeat('a', 64), p_terms boolean DEFAULT true)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.booking_engine_create_booking(p_public_id, p_in, p_out, p_rooms,
    jsonb_build_object('first_name', 'Anna', 'last_name', 'Kovács', 'email', p_email, 'phone', '+36 1 234 5678',
                       'country', 'hu', 'arrival_time', '15:00', 'special_requests', 'Quiet room'),
    'hu', jsonb_build_object('terms', p_terms, 'marketing', p_marketing), '{"utm_source": "google", "gclid": "x1"}',
    p_token, 'iphash', 'test-agent')
$$;

CREATE FUNCTION t.room(p_type text, p_plan text, p_adults int DEFAULT 2, p_children int DEFAULT 0)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('room_type_id', p_type::uuid, 'rate_plan_id', p_plan::uuid, 'adults', p_adults, 'children', p_children)
$$;

CREATE FUNCTION t.expect_error(p_sql text, p_code text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = p_code OR SQLSTATE = p_code THEN RETURN; END IF;
    RAISE EXCEPTION 'expected %, got % (%) for: %', p_code, SQLERRM, SQLSTATE, p_sql;
  END;
  RAISE EXCEPTION 'expected %, but it succeeded: %', p_code, p_sql;
END $$;

CREATE FUNCTION t.offer(p_engine uuid, p_in date, p_out date, p_plan text)
RETURNS record LANGUAGE sql AS $$
  SELECT o.available, o.total, o.blocked, o.min_stay, o.max_stay, o.currency
    FROM public.booking_engine_offers(p_engine, p_in, p_out) o WHERE o.rate_plan_id = p_plan::uuid
$$;

CREATE FUNCTION t.avail(p_type text, p_date date) RETURNS int LANGUAGE sql AS $$
  SELECT availability FROM public.pms_ari_availability WHERE room_type_id = p_type::uuid AND date = p_date
$$;

CREATE FUNCTION t.reset_twin_bar() RETURNS void LANGUAGE sql AS $$
  UPDATE public.pms_ari_rates
     SET rate = 95, min_stay_arrival = 1, min_stay_through = NULL, max_stay = NULL,
         closed_to_arrival = false, closed_to_departure = false, stop_sell = false
   WHERE rate_plan_id = '00000000-0000-0000-0000-0000000002a1'
$$;

GRANT USAGE ON SCHEMA t TO anon, authenticated, service_role;
CREATE TABLE t.res (k text PRIMARY KEY, v jsonb NOT NULL);
GRANT ALL ON t.res TO anon, authenticated, service_role;

\set twin '''00000000-0000-0000-0000-0000000001a1'''
\set dbl '''00000000-0000-0000-0000-0000000001a2'''
\set twin_bar '''00000000-0000-0000-0000-0000000002a1'''
\set twin_bb '''00000000-0000-0000-0000-0000000002a2'''
\set dbl_bar '''00000000-0000-0000-0000-0000000002a3'''

-- ------------------------------------------------------------ RLS on engine setup
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000aaa2', false);  -- reception
SELECT t.expect_error($q$INSERT INTO public.booking_engines (hotel_id) VALUES ('native-hotel')$q$, '42501');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000aaa1', false);  -- manager
SELECT t.expect_error($q$INSERT INTO public.booking_engines (hotel_id) VALUES ('previo-hotel')$q$, '42501');
INSERT INTO public.booking_engines (hotel_id, display_name) VALUES ('native-hotel', 'Native Hotel Direct');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000aaa2', false);  -- reception reads, cannot change
DO $$
DECLARE n int;
BEGIN
  ASSERT (SELECT count(*) FROM public.booking_engines) = 1, 'reception should see the engine';
  UPDATE public.booking_engines SET enabled = true;
  GET DIAGNOSTICS n = ROW_COUNT;
  ASSERT n = 0, 'reception must not update the engine';
END $$;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000aaa3', false);  -- other organisation
DO $$ BEGIN ASSERT (SELECT count(*) FROM public.booking_engines) = 0, 'other tenants must not see the engine'; END $$;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000aaa1', false);
INSERT INTO public.room_type_profiles (room_type_id, hotel_id, max_adults, max_occupancy, amenities)
VALUES (:twin, 'spoofed-hotel', 2, 3, ARRAY['wifi']);
UPDATE public.room_type_profiles SET max_children = 1 WHERE room_type_id = :twin;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);

-- Trigger-owned columns: organisation, immutable public id, real hotel on profiles.
DO $$
DECLARE e public.booking_engines%ROWTYPE;
BEGIN
  SELECT * INTO e FROM public.booking_engines;
  ASSERT e.organization_slug = 'channex', 'organisation comes from the hotel';
  ASSERT e.public_id ~ '^[a-f0-9]{12}$', 'public id is 12 hex characters';
  ASSERT NOT e.enabled, 'new engines start switched off';
  UPDATE public.booking_engines SET public_id = 'hacked', hotel_id = 'previo-hotel', organization_slug = 'x';
  ASSERT (SELECT public_id FROM public.booking_engines) = e.public_id, 'public id is immutable';
  ASSERT (SELECT hotel_id FROM public.booking_engines) = 'native-hotel', 'hotel is immutable';
  ASSERT (SELECT hotel_id FROM public.room_type_profiles) = 'native-hotel', 'profile hotel comes from the room type';
END $$;

SELECT public_id AS pid, id AS eid FROM public.booking_engines \gset
\set pid_q '''' :pid ''''
\set eid_q '''' :eid ''''

-- ------------------------------------------------------------ public config and calendar
DO $$
DECLARE c jsonb := public.booking_engine_public_config((SELECT public_id FROM public.booking_engines));
BEGIN
  ASSERT (c->'engine'->>'enabled')::boolean = false, 'disabled engine reports enabled=false';
  ASSERT c->'engine'->>'currency' = 'USD', 'currency comes from the rate plans';
  ASSERT c->'engine'->>'name' = 'Native Hotel Direct', 'display name wins';
  ASSERT jsonb_array_length(c->'room_types') = 2, 'two sellable room types';
  ASSERT jsonb_array_length(c->'room_types'->0->'rate_plans') = 2, 'twin has two rate plans';
  ASSERT (c->'room_types'->0->>'max_occupancy')::int = 3, 'profile occupancy is published';
  ASSERT public.booking_engine_public_config('nope') IS NULL, 'unknown engine returns null';
END $$;

DO $$
DECLARE
  pid text := (SELECT public_id FROM public.booking_engines);
  c jsonb;
BEGIN
  UPDATE public.pms_ari_rates SET stop_sell = true WHERE hotel_id = 'native-hotel' AND date = current_date + 11;
  c := public.booking_engine_calendar(pid, current_date + 10, current_date + 12);
  ASSERT (c->>'ok')::boolean, 'calendar ok';
  ASSERT jsonb_array_length(c->'days') = 3, 'three days';
  ASSERT (c->'days'->0->>'open')::boolean AND (c->'days'->0->>'from')::numeric = 95, 'day 1 open from 95';
  ASSERT NOT (c->'days'->1->>'open')::boolean, 'stop-sell day is closed';
  UPDATE public.pms_ari_rates SET stop_sell = false WHERE hotel_id = 'native-hotel' AND date = current_date + 11;
  UPDATE public.pms_ari_rates SET closed_to_arrival = true WHERE hotel_id = 'native-hotel' AND date = current_date + 12;
  c := public.booking_engine_calendar(pid, current_date + 10, current_date + 12);
  ASSERT (c->'days'->2->>'cta')::boolean, 'CTA day flagged';
  UPDATE public.pms_ari_rates SET closed_to_arrival = false WHERE hotel_id = 'native-hotel' AND date = current_date + 12;
  ASSERT jsonb_array_length(public.booking_engine_calendar(pid, current_date, current_date + 200)->'days') = 93, 'calendar capped at 93 days';
END $$;

-- ------------------------------------------------------------ offers and restrictions
DO $$
DECLARE
  e uuid := (SELECT id FROM public.booking_engines);
  d1 date := current_date + 10; d3 date := current_date + 12;
  r record;
BEGIN
  SELECT * INTO r FROM t.offer(e, d1, d3, '00000000-0000-0000-0000-0000000002a1') AS (available int, total numeric, blocked text, min_stay int, max_stay int, currency text);
  ASSERT r.available = 2 AND r.total = 190 AND r.blocked IS NULL AND r.currency = 'USD', format('twin BAR base offer %s', row_to_json(r));
  SELECT * INTO r FROM t.offer(e, d1, d3, '00000000-0000-0000-0000-0000000002a3') AS (available int, total numeric, blocked text, min_stay int, max_stay int, currency text);
  ASSERT r.available = 1 AND r.total = 220, 'double BAR base offer';

  UPDATE public.pms_ari_rates SET min_stay_arrival = 3 WHERE rate_plan_id = '00000000-0000-0000-0000-0000000002a1' AND date = d1;
  SELECT * INTO r FROM t.offer(e, d1, d3, '00000000-0000-0000-0000-0000000002a1') AS (available int, total numeric, blocked text, min_stay int, max_stay int, currency text);
  ASSERT r.blocked = 'min_stay' AND r.min_stay = 3, 'min stay on arrival';
  SELECT * INTO r FROM t.offer(e, d1, d3, '00000000-0000-0000-0000-0000000002a2') AS (available int, total numeric, blocked text, min_stay int, max_stay int, currency text);
  ASSERT r.blocked IS NULL, 'restriction is per rate plan';
  PERFORM t.reset_twin_bar();
  UPDATE public.pms_ari_rates SET min_stay_through = 3 WHERE rate_plan_id = '00000000-0000-0000-0000-0000000002a1' AND date = d1 + 1;
  SELECT * INTO r FROM t.offer(e, d1, d3, '00000000-0000-0000-0000-0000000002a1') AS (available int, total numeric, blocked text, min_stay int, max_stay int, currency text);
  ASSERT r.blocked = 'min_stay', 'min stay through a middle night';
  PERFORM t.reset_twin_bar();
  UPDATE public.pms_ari_rates SET closed_to_arrival = true WHERE rate_plan_id = '00000000-0000-0000-0000-0000000002a1' AND date = d1;
  SELECT * INTO r FROM t.offer(e, d1, d3, '00000000-0000-0000-0000-0000000002a1') AS (available int, total numeric, blocked text, min_stay int, max_stay int, currency text);
  ASSERT r.blocked = 'closed_to_arrival', 'CTA';
  PERFORM t.reset_twin_bar();
  UPDATE public.pms_ari_rates SET closed_to_departure = true WHERE rate_plan_id = '00000000-0000-0000-0000-0000000002a1' AND date = d3;
  SELECT * INTO r FROM t.offer(e, d1, d3, '00000000-0000-0000-0000-0000000002a1') AS (available int, total numeric, blocked text, min_stay int, max_stay int, currency text);
  ASSERT r.blocked = 'closed_to_departure', 'CTD';
  PERFORM t.reset_twin_bar();
  UPDATE public.pms_ari_rates SET stop_sell = true WHERE rate_plan_id = '00000000-0000-0000-0000-0000000002a1' AND date = d1 + 1;
  SELECT * INTO r FROM t.offer(e, d1, d3, '00000000-0000-0000-0000-0000000002a1') AS (available int, total numeric, blocked text, min_stay int, max_stay int, currency text);
  ASSERT r.blocked = 'stop_sell', 'stop sell';
  PERFORM t.reset_twin_bar();
  UPDATE public.pms_ari_rates SET max_stay = 1 WHERE rate_plan_id = '00000000-0000-0000-0000-0000000002a1' AND date = d1;
  SELECT * INTO r FROM t.offer(e, d1, d3, '00000000-0000-0000-0000-0000000002a1') AS (available int, total numeric, blocked text, min_stay int, max_stay int, currency text);
  ASSERT r.blocked = 'max_stay' AND r.max_stay = 1, 'max stay';
  PERFORM t.reset_twin_bar();
  UPDATE public.pms_ari_rates SET rate = 0 WHERE rate_plan_id = '00000000-0000-0000-0000-0000000002a1' AND date = d1 + 1;
  SELECT * INTO r FROM t.offer(e, d1, d3, '00000000-0000-0000-0000-0000000002a1') AS (available int, total numeric, blocked text, min_stay int, max_stay int, currency text);
  ASSERT r.blocked = 'no_rate', 'zero rate is not sellable';
  PERFORM t.reset_twin_bar();
  UPDATE public.pms_ari_availability SET sell_limit = 0 WHERE room_type_id = '00000000-0000-0000-0000-0000000001a1' AND date = d1;
  SELECT * INTO r FROM t.offer(e, d1, d3, '00000000-0000-0000-0000-0000000002a1') AS (available int, total numeric, blocked text, min_stay int, max_stay int, currency text);
  ASSERT r.blocked = 'sold_out' AND r.available = 0, 'sold out';
  UPDATE public.pms_ari_availability SET sell_limit = NULL WHERE room_type_id = '00000000-0000-0000-0000-0000000001a1';

  -- A rate plan switched off for the website disappears from offers.
  UPDATE public.booking_engines SET rate_plans = '{"00000000-0000-0000-0000-0000000002a2": {"enabled": false}}';
  ASSERT NOT EXISTS (SELECT 1 FROM public.booking_engine_offers(e, d1, d3) o WHERE o.rate_plan_id = '00000000-0000-0000-0000-0000000002a2'), 'disabled plan hidden';
  UPDATE public.booking_engines SET rate_plans = '{}';
END $$;

-- Booking window (search).
DO $$
DECLARE pid text := (SELECT public_id FROM public.booking_engines);
BEGIN
  ASSERT public.booking_engine_search(pid, current_date - 1, current_date + 1)->>'error' = 'TOO_SOON', 'past arrival';
  ASSERT public.booking_engine_search(pid, current_date + 5, current_date + 5)->>'error' = 'INVALID_DATES', 'zero nights';
  ASSERT public.booking_engine_search(pid, current_date + 5, current_date + 36)->>'error' = 'TOO_LONG', 'over max nights';
  ASSERT public.booking_engine_search(pid, current_date + 400, current_date + 401)->>'error' = 'TOO_FAR', 'beyond max advance';
  ASSERT (public.booking_engine_search(pid, current_date + 10, current_date + 12)->>'ok')::boolean, 'valid search';
  ASSERT jsonb_array_length(public.booking_engine_search(pid, current_date + 10, current_date + 12)->'offers') = 3, 'three offers';
  ASSERT public.booking_engine_search('nope', current_date + 10, current_date + 12)->>'error' = 'ENGINE_UNAVAILABLE', 'unknown engine';
END $$;

-- ------------------------------------------------------------ booking
SELECT t.expect_error(format($q$SELECT t.book(%L, current_date + 10, current_date + 12, jsonb_build_array(t.room(%L, %L)))$q$,
  :pid_q, :twin, :twin_bar), 'ENGINE_UNAVAILABLE');
UPDATE public.booking_engines SET enabled = true;

-- Validation errors write nothing.
SELECT t.expect_error(format($q$SELECT t.book(%L, current_date + 10, current_date + 12, jsonb_build_array(t.room(%L, %L, 3)))$q$, :pid_q, :twin, :twin_bar), 'INVALID_OCCUPANCY');
SELECT t.expect_error(format($q$SELECT t.book(%L, current_date + 10, current_date + 12, jsonb_build_array(t.room(%L, %L)))$q$, :pid_q, :twin, :dbl_bar), 'RATE_UNAVAILABLE');
SELECT t.expect_error(format($q$SELECT t.book(%L, current_date + 10, current_date + 12, jsonb_build_array(t.room(%L, %L), t.room(%L, %L), t.room(%L, %L), t.room(%L, %L), t.room(%L, %L)))$q$,
  :pid_q, :twin, :twin_bar, :twin, :twin_bar, :twin, :twin_bar, :twin, :twin_bar, :twin, :twin_bar), 'INVALID_ROOMS');
SELECT t.expect_error(format($q$SELECT t.book(%L, current_date + 10, current_date + 12, jsonb_build_array(t.room(%L, %L)), p_terms => false)$q$, :pid_q, :twin, :twin_bar), 'CONSENT_REQUIRED');
SELECT t.expect_error(format($q$SELECT t.book(%L, current_date + 10, current_date + 12, jsonb_build_array(t.room(%L, %L)), p_email => 'not-an-email')$q$, :pid_q, :twin, :twin_bar), 'INVALID_GUEST');
SELECT t.expect_error(format($q$SELECT t.book(%L, current_date + 10, current_date + 12, jsonb_build_array(t.room(%L, %L)), p_token => 'short')$q$, :pid_q, :twin, :twin_bar), 'INVALID_TOKEN');
SELECT t.expect_error(format($q$SELECT t.book(%L, current_date - 2, current_date + 1, jsonb_build_array(t.room(%L, %L)))$q$, :pid_q, :twin, :twin_bar), 'TOO_SOON');
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM public.reservations) = 0 AND (SELECT count(*) FROM public.guests) = 0, 'failed attempts leave nothing behind';
END $$;

-- Single room, refundable.
INSERT INTO t.res SELECT 'b1', t.book(:pid_q, current_date + 10, current_date + 12, jsonb_build_array(t.room(:twin, :twin_bar)));
DO $$
DECLARE
  b jsonb := (SELECT v FROM t.res WHERE k = 'b1');
  r public.reservations%ROWTYPE;
  g public.guests%ROWTYPE;
  bk public.booking_engine_bookings%ROWTYPE;
BEGIN
  ASSERT (b->>'ok')::boolean AND b->>'reference' ~ '^W[0-9A-F]{7}$', format('booking result %s', b);
  ASSERT (b->>'total')::numeric = 190 AND b->>'currency' = 'USD', 'total and currency';
  ASSERT (b->>'free_cancellation_until')::timestamptz = ((current_date + 8)::timestamp + time '23:59:59') AT TIME ZONE 'Europe/Budapest', 'free cancellation until end of day 2 days before';
  SELECT * INTO r FROM public.reservations WHERE id = (b->'rooms'->0->>'reservation_id')::uuid;
  ASSERT r.source = 'website' AND r.source_reservation_id = b->>'reference', 'website source and reference';
  ASSERT r.status = 'confirmed' AND r.room_type_id = '00000000-0000-0000-0000-0000000001a1' AND r.room_type_requested = 'Twin Room', 'status and room type';
  ASSERT r.total_amount = 190 AND r.rate_per_night = 95 AND r.balance_due = 190 AND r.currency = 'USD', 'money fields';
  ASSERT r.payment_collect = 'property' AND r.payment_status = 'unpaid', 'pay at the hotel';
  ASSERT r.reservation_number LIKE 'RES-%' AND r.total_nights = 2, 'reservation number trigger ran';
  ASSERT r.pms_guest_name = 'Anna Kovács', 'guest name on the booking';
  ASSERT r.special_requests = E'Expected arrival: 15:00\nQuiet room', format('special requests %L', r.special_requests);
  ASSERT r.internal_notes LIKE 'Website booking W% · Best Available Rate · free cancellation until %', r.internal_notes;
  SELECT * INTO g FROM public.guests WHERE id = r.guest_id;
  ASSERT g.email = 'anna@example.org' AND g.country = 'HU' AND g.hotel_id = 'native-hotel' AND g.organization_slug = 'channex', 'guest profile';
  ASSERT g.preferences->>'language' = 'hu' AND (g.preferences->>'marketing_consent')::boolean = false, format('guest prefs %s', g.preferences);
  ASSERT t.avail('00000000-0000-0000-0000-0000000001a1', current_date + 10) = 1
     AND t.avail('00000000-0000-0000-0000-0000000001a1', current_date + 11) = 1
     AND t.avail('00000000-0000-0000-0000-0000000001a1', current_date + 12) = 2, 'availability follows the booking';
  ASSERT (SELECT count(*) FROM public.reservation_events WHERE reservation_id = r.id AND event_type = 'created') = 1, 'created event';
  SELECT * INTO bk FROM public.booking_engine_bookings WHERE reference = b->>'reference';
  ASSERT bk.attribution->>'gclid' = 'x1' AND (bk.consent->>'terms')::boolean AND bk.manage_token_hash = repeat('a', 64), 'booking row';
  ASSERT bk.guest_name = 'Anna Kovács' AND bk.language = 'hu' AND bk.status = 'confirmed', 'booking row details';
END $$;

-- Same guest again: profile reused, consent given, then never withdrawn by an unticked box.
INSERT INTO t.res SELECT 'b2', t.book(:pid_q, current_date + 14, current_date + 15, jsonb_build_array(t.room(:dbl, :dbl_bar)), p_email => 'ANNA@example.org', p_marketing => true);
INSERT INTO t.res SELECT 'b3', t.book(:pid_q, current_date + 20, current_date + 21, jsonb_build_array(t.room(:twin, :twin_bb, 1, 1)), p_marketing => false);
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM public.guests) = 1, 'one profile per e-mail per hotel';
  ASSERT (SELECT (preferences->>'marketing_consent')::boolean FROM public.guests) = true, 'consent kept';
  ASSERT (SELECT preferences ? 'marketing_consent_at' FROM public.guests), 'consent timestamp recorded';
END $$;

-- Two rooms in one booking; the last rooms cannot be sold twice.
INSERT INTO t.res SELECT 'b4', t.book(:pid_q, current_date + 30, current_date + 32, jsonb_build_array(t.room(:twin, :twin_bar), t.room(:twin, :twin_bb, 1)));
DO $$
DECLARE b jsonb := (SELECT v FROM t.res WHERE k = 'b4');
BEGIN
  ASSERT jsonb_array_length(b->'rooms') = 2 AND (b->>'total')::numeric = 190 + 230, format('two rooms %s', b);
  ASSERT (SELECT array_agg(source_reservation_id ORDER BY source_reservation_id) FROM public.reservations
           WHERE source_reservation_id LIKE (b->>'reference') || '%') = ARRAY[(b->>'reference') || '-1', (b->>'reference') || '-2'], 'room suffixes';
  ASSERT t.avail('00000000-0000-0000-0000-0000000001a1', current_date + 30) = 0, 'twin sold out';
END $$;
SELECT t.expect_error(format($q$SELECT t.book(%L, current_date + 31, current_date + 33, jsonb_build_array(t.room(%L, %L)))$q$, :pid_q, :twin, :twin_bar), 'SOLD_OUT');
SELECT t.expect_error(format($q$SELECT t.book(%L, current_date + 14, current_date + 15, jsonb_build_array(t.room(%L, %L)))$q$, :pid_q, :dbl, :dbl_bar), 'SOLD_OUT');

-- ------------------------------------------------------------ manage and cancel
DO $$
DECLARE
  pid text := (SELECT public_id FROM public.booking_engines);
  b jsonb := (SELECT v FROM t.res WHERE k = 'b1');
  g jsonb;
  c jsonb;
BEGIN
  ASSERT public.booking_engine_get_booking(pid, b->>'reference', repeat('b', 64)) IS NULL, 'wrong token sees nothing';
  g := public.booking_engine_get_booking(pid, lower(b->>'reference'), repeat('a', 64));
  ASSERT g->>'status' = 'confirmed' AND (g->>'can_cancel')::boolean, format('manage view %s', g);
  BEGIN
    PERFORM public.booking_engine_cancel_booking(pid, b->>'reference', repeat('b', 64));
    RAISE EXCEPTION 'cancel with a wrong token must fail';
  EXCEPTION WHEN raise_exception THEN
    ASSERT SQLERRM = 'NOT_FOUND', SQLERRM;
  END;
  c := public.booking_engine_cancel_booking(pid, b->>'reference', repeat('a', 64));
  ASSERT (c->>'ok')::boolean AND NOT (c ? 'already'), format('cancel %s', c);
  ASSERT (SELECT status FROM public.reservations WHERE id = (b->'rooms'->0->>'reservation_id')::uuid) = 'cancelled', 'reservation cancelled';
  ASSERT t.avail('00000000-0000-0000-0000-0000000001a1', current_date + 10) = 2, 'availability released';
  ASSERT (SELECT count(*) FROM public.reservation_events WHERE event_type = 'cancelled') = 1, 'one cancel event';
  g := public.booking_engine_get_booking(pid, b->>'reference', repeat('a', 64));
  ASSERT g->>'status' = 'cancelled' AND NOT (g->>'can_cancel')::boolean, 'cancelled view';
  ASSERT (public.booking_engine_cancel_booking(pid, b->>'reference', repeat('a', 64))->>'already')::boolean, 'second cancel is a no-op';
  ASSERT (SELECT count(*) FROM public.reservation_events WHERE event_type = 'cancelled') = 1, 'no duplicate event';
END $$;

-- A checked-in stay cannot be cancelled online.
DO $$
DECLARE pid text := (SELECT public_id FROM public.booking_engines); b jsonb := (SELECT v FROM t.res WHERE k = 'b2');
BEGIN
  UPDATE public.reservations SET status = 'checked_in' WHERE id = (b->'rooms'->0->>'reservation_id')::uuid;
  ASSERT NOT (public.booking_engine_get_booking(pid, b->>'reference', repeat('a', 64))->>'can_cancel')::boolean, 'no cancel after check-in';
  BEGIN
    PERFORM public.booking_engine_cancel_booking(pid, b->>'reference', repeat('a', 64));
    RAISE EXCEPTION 'cancel after check-in must fail';
  EXCEPTION WHEN raise_exception THEN
    ASSERT SQLERRM = 'NOT_CANCELLABLE', SQLERRM;
  END;
END $$;

-- Non-refundable rate.
UPDATE public.booking_engines SET rate_plans = '{"00000000-0000-0000-0000-0000000002a2": {"refundable": false}}';
INSERT INTO t.res SELECT 'b5', t.book(:pid_q, current_date + 40, current_date + 41, jsonb_build_array(t.room(:twin, :twin_bb)));
DO $$
DECLARE pid text := (SELECT public_id FROM public.booking_engines); b jsonb := (SELECT v FROM t.res WHERE k = 'b5');
BEGIN
  ASSERT b->'free_cancellation_until' = 'null'::jsonb, format('non-refundable %s', b);
  ASSERT (SELECT internal_notes FROM public.reservations WHERE id = (b->'rooms'->0->>'reservation_id')::uuid) LIKE '% · non-refundable', 'note says non-refundable';
  BEGIN
    PERFORM public.booking_engine_cancel_booking(pid, b->>'reference', repeat('a', 64));
    RAISE EXCEPTION 'non-refundable cancel must fail';
  EXCEPTION WHEN raise_exception THEN
    ASSERT SQLERRM = 'NOT_CANCELLABLE', SQLERRM;
  END;
END $$;

-- ------------------------------------------------------------ Previo hotels never sell
INSERT INTO public.booking_engines (hotel_id, enabled) VALUES ('previo-hotel', true);
DO $$
DECLARE pid text := (SELECT public_id FROM public.booking_engines WHERE hotel_id = 'previo-hotel');
BEGIN
  ASSERT NOT (public.booking_engine_public_config(pid)->'engine'->>'enabled')::boolean, 'previo engine reports disabled';
  ASSERT public.booking_engine_search(pid, current_date + 10, current_date + 11)->>'error' = 'ENGINE_UNAVAILABLE', 'previo search blocked';
  BEGIN
    PERFORM t.book(pid, current_date + 10, current_date + 11,
                   jsonb_build_array(t.room('00000000-0000-0000-0000-0000000001b1', '00000000-0000-0000-0000-0000000002b1')));
    RAISE EXCEPTION 'previo booking must fail';
  EXCEPTION WHEN raise_exception THEN
    ASSERT SQLERRM = 'ENGINE_UNAVAILABLE', SQLERRM;
  END;
END $$;

-- ------------------------------------------------------------ rate limits
DO $$ BEGIN
  ASSERT public.booking_engine_hit('test-bucket', 60, 2) AND public.booking_engine_hit('test-bucket', 60, 2)
     AND NOT public.booking_engine_hit('test-bucket', 60, 2), 'third hit in the window is refused';
  ASSERT (SELECT count(*) FROM cron.job WHERE jobname = 'booking-engine-rate-limit-purge') = 1, 'purge job scheduled once';
END $$;

-- ------------------------------------------------------------ only the edge function (service role) may call
SET ROLE anon;
SELECT t.expect_error(format($q$SELECT public.booking_engine_search(%L, current_date + 10, current_date + 12)$q$, :pid_q), '42501');
SELECT t.expect_error($q$SELECT public.booking_engine_hit('x', 60, 1)$q$, '42501');
RESET ROLE;
DO $$ BEGIN
  SET LOCAL ROLE anon;
  ASSERT (SELECT count(*) FROM public.booking_engine_bookings) = 0 AND (SELECT count(*) FROM public.booking_engines) = 0, 'anon reads nothing';
END $$;
SET ROLE authenticated;
SELECT t.expect_error(format($q$SELECT public.booking_engine_cancel_booking(%L, 'W0000000', repeat('a', 64))$q$, :pid_q), '42501');
RESET ROLE;
SET ROLE service_role;
DO $$ BEGIN
  ASSERT (public.booking_engine_search((SELECT public_id FROM public.booking_engines WHERE hotel_id = 'native-hotel'), current_date + 10, current_date + 12)->>'ok')::boolean, 'service role can search';
END $$;
RESET ROLE;

\echo 'booking engine integration: all checks passed'
