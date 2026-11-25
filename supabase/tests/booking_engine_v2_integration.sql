-- Booking engine v2 integration test. Runs after booking_engine_fixture.sql,
-- booking_engine_v2_fixture.sql and the booking engine, wellness and v2
-- migrations. Every check raises on failure.

CREATE SCHEMA IF NOT EXISTS t;
GRANT USAGE ON SCHEMA t TO anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION t.expect_error(p_sql text, p_code text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = p_code OR SQLSTATE = p_code THEN RETURN; END IF;
    RAISE EXCEPTION 'expected %, got % (%) for: %', p_code, SQLERRM, SQLSTATE, p_sql;
  END;
  RAISE EXCEPTION 'expected %, but it succeeded: %', p_code, p_sql;
END $$;
CREATE OR REPLACE FUNCTION t.as_user(p uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', p::text, false)
$$;
CREATE OR REPLACE FUNCTION t.book(p_public_id text, p_in date, p_out date, p_preview boolean, p_first text DEFAULT 'Anna',
                                  p_last text DEFAULT 'Kovács', p_email text DEFAULT 'anna@example.org')
RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.booking_engine_create_booking(p_public_id, p_in, p_out,
    jsonb_build_array(jsonb_build_object('room_type_id', '00000000-0000-0000-0000-0000000001a1', 'rate_plan_id', '00000000-0000-0000-0000-0000000002a1', 'adults', 2, 'children', 0)),
    jsonb_build_object('first_name', p_first, 'last_name', p_last, 'email', p_email),
    'en', '{"terms": true}', '{}', repeat('b', 64), 'iphash', 'agent', p_preview)
$$;
CREATE TABLE IF NOT EXISTS t.counts (k text PRIMARY KEY, v bigint);
CREATE OR REPLACE FUNCTION t.snapshot(p text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO t.counts VALUES
    (p || ':reservations', (SELECT count(*) FROM public.reservations)),
    (p || ':bookings', (SELECT count(*) FROM public.booking_engine_bookings)),
    (p || ':guests', (SELECT count(*) FROM public.guests)),
    (p || ':events', (SELECT count(*) FROM public.reservation_events)),
    (p || ':avail', (SELECT sum(availability) FROM public.pms_ari_availability WHERE hotel_id = 'native-hotel'))
  ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v
$$;
CREATE OR REPLACE FUNCTION t.same(a text, b text) RETURNS boolean LANGUAGE sql AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM t.counts x JOIN t.counts y ON split_part(x.k, ':', 2) = split_part(y.k, ':', 2)
     WHERE split_part(x.k, ':', 1) = a AND split_part(y.k, ':', 1) = b AND x.v IS DISTINCT FROM y.v)
$$;
CREATE OR REPLACE FUNCTION t.pid() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT public_id FROM public.booking_engines WHERE hotel_id = 'native-hotel'
$$;
GRANT ALL ON ALL TABLES IN SCHEMA t TO anon, authenticated, service_role;

-- ------------------------------------------------------------ top management only
SET ROLE authenticated;
SELECT t.as_user('00000000-0000-0000-0000-00000000aaa1');  -- hotel manager
SELECT t.expect_error($q$INSERT INTO public.booking_engines (hotel_id) VALUES ('native-hotel')$q$, '42501');
SELECT t.as_user('00000000-0000-0000-0000-00000000aaa4');  -- top management
INSERT INTO public.booking_engines (hotel_id, display_name, contact)
VALUES ('native-hotel', 'Native Hotel Direct', '{"email": "front@native.example", "phone": "+36 1 555 0000"}');
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM public.booking_engines) = 1, 'top management sees the engine';
  ASSERT (SELECT preview_token ~ '^[0-9a-f]{64}$' FROM public.booking_engines), 'test link token created';
  ASSERT (SELECT reminder_days FROM public.booking_engines) = 3, 'reminder 3 days before arrival by default';
END $$;
SELECT t.as_user('00000000-0000-0000-0000-00000000aaa1');
DO $$ BEGIN ASSERT (SELECT count(*) FROM public.booking_engines) = 0, 'other managers no longer see the embed code or test link'; END $$;
SELECT t.expect_error($q$SELECT public.booking_engine_reset_preview_token('native-hotel')$q$, '42501');
SELECT t.as_user('00000000-0000-0000-0000-00000000aaa2');
DO $$ BEGIN ASSERT (SELECT count(*) FROM public.booking_engines) = 0, 'reception does not see it either'; END $$;
SELECT t.as_user('00000000-0000-0000-0000-00000000aaa4');
DO $$
DECLARE old text := (SELECT preview_token FROM public.booking_engines);
DECLARE fresh text;
BEGIN
  fresh := public.booking_engine_reset_preview_token('native-hotel');
  ASSERT fresh <> old AND fresh = (SELECT preview_token FROM public.booking_engines), 'test link renewed';
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT public_id AS pid FROM public.booking_engines \gset
\set pid_q '''' :pid ''''

-- ------------------------------------------------------------ switched off: nothing to see without the test link
DO $$
DECLARE c jsonb := public.booking_engine_public_config(t.pid());
DECLARE p jsonb := public.booking_engine_public_config(t.pid(), true);
BEGIN
  ASSERT NOT (c->'engine'->>'enabled')::boolean AND jsonb_array_length(c->'room_types') = 0, 'no rooms while off';
  ASSERT c->'engine'->>'name' = 'Native Hotel Direct' AND c->'engine'->'contact'->>'email' = 'front@native.example', 'name and contact for the not-available page';
  ASSERT NOT (c->'engine' ? 'policies') AND NOT (c->'engine' ? 'booking_window'), 'no booking details while off';
  ASSERT NOT (c->>'preview')::boolean, 'not a preview';
  ASSERT jsonb_array_length(p->'room_types') = 2 AND (p->>'preview')::boolean, 'test link shows everything';
  ASSERT (public.booking_engine_search(t.pid(), current_date + 10, current_date + 12)->>'error') = 'ENGINE_UNAVAILABLE', 'no prices while off';
  ASSERT (public.booking_engine_calendar(t.pid(), current_date, current_date + 30)->>'error') = 'ENGINE_UNAVAILABLE', 'no calendar while off';
  ASSERT (public.booking_engine_search(t.pid(), current_date + 10, current_date + 12, true)->>'ok')::boolean, 'test link searches';
  ASSERT (public.booking_engine_calendar(t.pid(), current_date, current_date + 30, true)->>'ok')::boolean, 'test link calendar';
END $$;

-- ------------------------------------------------------------ test bookings are dry runs
SELECT t.snapshot('before');
DO $$
DECLARE r jsonb;
BEGIN
  r := t.book(t.pid(), current_date + 10, current_date + 12, true);
  ASSERT (r->>'preview')::boolean AND r->>'reference' ~ '^TEST-[0-9A-F]{7}$', 'preview reference ' || COALESCE(r->>'reference', 'null');
  ASSERT r->>'booking_id' IS NULL AND (r->>'total')::numeric = 190, 'priced like a real booking: ' || (r->>'total');
  ASSERT NOT (r->'rooms'->0 ? 'reservation_id'), 'no reservation ids in a preview';
END $$;
SELECT t.snapshot('after');
DO $$ BEGIN
  ASSERT t.same('before', 'after'), 'a test booking stores nothing and leaves availability alone';
  ASSERT NOT (SELECT enabled FROM public.booking_engines), 'engine still switched off after the preview';
END $$;
-- Real booking while off is refused; the test link does not unlock real bookings.
SELECT t.expect_error(format($q$SELECT t.book(%L, current_date + 10, current_date + 12, false)$q$, :pid_q), 'ENGINE_UNAVAILABLE');
-- The preview still applies every rule.
SELECT t.expect_error(format($q$SELECT t.book(%L, current_date + 12, current_date + 10, true)$q$, :pid_q), 'INVALID_DATES');

UPDATE public.booking_engines SET enabled = true;
DO $$
DECLARE r jsonb;
BEGIN
  PERFORM t.snapshot('on_before');
  r := t.book(t.pid(), current_date + 20, current_date + 22, true);
  PERFORM t.snapshot('on_after');
  ASSERT t.same('on_before', 'on_after') AND (r->>'preview')::boolean, 'preview stays a dry run when the engine is on';
  r := t.book(t.pid(), current_date + 20, current_date + 22, false);
  ASSERT r->>'reference' ~ '^W[0-9A-F]{7}$' AND r->>'booking_id' IS NOT NULL AND NOT (r ? 'preview'), 'live booking stored';
  ASSERT (public.booking_engine_public_config(t.pid())->>'preview')::boolean = false, 'enabled engine is not a preview';
  ASSERT (public.booking_engine_public_config(t.pid(), true)->>'preview')::boolean, 'test link stays test mode after go-live';
END $$;

-- ------------------------------------------------------------ returning guests
-- Two past stays of Anna: one booked on the website (guest e-mail), one from
-- the PMS under "KOVÁCS Anna"; she used the jacuzzi during the second.
INSERT INTO public.reservations (id, hotel_id, organization_slug, guest_id, status, check_in_date, check_out_date, source, source_reservation_id, pms_guest_name)
SELECT '00000000-0000-0000-0000-0000000e0001', 'native-hotel', 'channex', g.id, 'checked_out', current_date - 200, current_date - 197, 'website', 'PAST-1', NULL
  FROM public.guests g WHERE lower(g.email) = 'anna@example.org' LIMIT 1;
INSERT INTO public.reservations (id, hotel_id, organization_slug, status, check_in_date, check_out_date, source, source_reservation_id, pms_guest_name) VALUES
  ('00000000-0000-0000-0000-0000000e0002', 'native-hotel', 'channex', 'checked_out', current_date - 60, current_date - 58, 'previo', 'PAST-2', 'KOVÁCS Anna'),
  ('00000000-0000-0000-0000-0000000e0003', 'native-hotel', 'channex', 'cancelled', current_date - 30, current_date - 28, 'previo', 'PAST-3', 'Anna Kovacs'),
  ('00000000-0000-0000-0000-0000000e0004', 'previo-hotel', 'rdhotels', 'checked_out', current_date - 90, current_date - 88, 'previo', 'PAST-4', 'Anna Kovács');
INSERT INTO public.insuite_wellness_resources (organization_slug, hotel_id, kind, name, is_active)
VALUES ('channex', 'native-hotel', 'jacuzzi', 'Jacuzzi', true), ('channex', 'native-hotel', 'sauna', 'Sauna', true);
INSERT INTO public.insuite_wellness_bookings (organization_slug, hotel_id, resource_id, reservation_id, guest_name, party_size, starts_at, ends_at, status, source, ticket_code)
SELECT 'channex', 'native-hotel', id, '00000000-0000-0000-0000-0000000e0002', 'Anna', 2,
       (current_date - 59) + time '19:00', (current_date - 59) + time '20:00', 'completed', 'insuite', 'JZ-PAST01'
  FROM public.insuite_wellness_resources WHERE hotel_id = 'native-hotel' AND kind = 'jacuzzi';
DO $$
DECLARE h jsonb;
DECLARE current_ids uuid[] := ARRAY(SELECT (x->>'reservation_id')::uuid FROM public.booking_engine_bookings b, jsonb_array_elements(b.rooms) x);
BEGIN
  h := public.booking_engine_guest_history('native-hotel', 'ANNA@example.org', 'Anna', 'Kovács', current_ids);
  ASSERT (h->>'previous_stays')::int = 2, 'two earlier stays (cancelled and other hotels ignored): ' || h::text;
  ASSERT h->'wellness_kinds' = '["jacuzzi"]'::jsonb, 'remembers the jacuzzi: ' || h::text;
  ASSERT (h->>'last_stay_end')::date = current_date - 58, 'last stay end';
  h := public.booking_engine_guest_history('native-hotel', 'someone@example.org', 'Kovacs', 'Anna', current_ids);
  ASSERT (h->>'previous_stays')::int = 2 AND h->'wellness_kinds' = '["jacuzzi"]'::jsonb, 'name in any order and without accents: ' || h::text;
  h := public.booking_engine_guest_history('native-hotel', 'new@example.org', 'Anna', '', current_ids);
  ASSERT (h->>'previous_stays')::int = 0 AND h->'wellness_kinds' = '[]'::jsonb, 'one word never identifies a person';
  h := public.booking_engine_guest_history('previo-hotel', 'anna@example.org', 'Anna', 'Kovács');
  ASSERT (h->>'previous_stays')::int = 1 AND h->'wellness_kinds' = '[]'::jsonb, 'per hotel';
END $$;

-- ------------------------------------------------------------ pre-arrival reminders
DO $$
DECLARE e uuid := (SELECT id FROM public.booking_engines);
BEGIN
  DELETE FROM public.booking_engine_bookings;
  INSERT INTO public.booking_engine_bookings (engine_id, hotel_id, organization_slug, reference, manage_token_hash, guest_email, guest_name,
    check_in_date, check_out_date, rooms, total_amount, currency, status, created_at) VALUES
    (e, 'native-hotel', 'channex', 'WDUE0001', repeat('a', 64), 'a@example.org', 'Due', current_date + 3, current_date + 5, '[]', 1, 'USD', 'confirmed', now() - interval '10 days'),
    (e, 'native-hotel', 'channex', 'WDUE0002', repeat('a', 64), 'b@example.org', 'Due catch-up', current_date + 1, current_date + 2, '[]', 1, 'USD', 'confirmed', now() - interval '10 days'),
    (e, 'native-hotel', 'channex', 'WNOT0001', repeat('a', 64), 'c@example.org', 'Booked yesterday', current_date + 2, current_date + 3, '[]', 1, 'USD', 'confirmed', now() - interval '1 day'),
    (e, 'native-hotel', 'channex', 'WNOT0002', repeat('a', 64), 'd@example.org', 'Too early', current_date + 9, current_date + 10, '[]', 1, 'USD', 'confirmed', now() - interval '20 days'),
    (e, 'native-hotel', 'channex', 'WNOT0003', repeat('a', 64), 'e@example.org', 'Cancelled', current_date + 3, current_date + 4, '[]', 1, 'USD', 'cancelled', now() - interval '10 days'),
    (e, 'native-hotel', 'channex', 'WNOT0004', repeat('a', 64), 'f@example.org', 'Already sent', current_date + 3, current_date + 4, '[]', 1, 'USD', 'confirmed', now() - interval '10 days'),
    (e, 'native-hotel', 'channex', 'WNOT0005', repeat('a', 64), 'g@example.org', 'Arrives today', current_date, current_date + 1, '[]', 1, 'USD', 'confirmed', now() - interval '10 days');
  UPDATE public.booking_engine_bookings SET reminder_sent_at = now() WHERE reference = 'WNOT0004';
  ASSERT (SELECT array_agg(reference ORDER BY reference) FROM public.booking_engine_due_reminders()) = ARRAY['WDUE0001', 'WDUE0002'],
    'due: ' || (SELECT string_agg(reference, ',') FROM public.booking_engine_due_reminders());
  UPDATE public.booking_engines SET reminder_days = 0;
  ASSERT NOT EXISTS (SELECT 1 FROM public.booking_engine_due_reminders()), 'reminder switched off';
  UPDATE public.booking_engines SET reminder_days = 3;
  ASSERT (SELECT count(*) FROM cron.job WHERE jobname = 'booking-engine-reminders') = 1, 'daily job scheduled once';
  ASSERT public.booking_engine_worker_secret() IS NULL, 'no vault here: no secret (production uses Vault)';
END $$;
SELECT t.expect_error($q$UPDATE public.booking_engines SET reminder_days = 30$q$, '23514');

-- ------------------------------------------------------------ service role only
SET ROLE anon;
SELECT t.expect_error(format($q$SELECT public.booking_engine_search(%L, current_date + 10, current_date + 12, true)$q$, :pid_q), '42501');
SELECT t.expect_error($q$SELECT public.booking_engine_guest_history('native-hotel', 'a@example.org', 'A', 'B')$q$, '42501');
RESET ROLE;
SET ROLE authenticated;
SELECT t.as_user('00000000-0000-0000-0000-00000000aaa4');
SELECT t.expect_error(format($q$SELECT public.booking_engine_create_booking(%L, current_date + 10, current_date + 12, '[]', '{}', 'en', '{}', '{}', 'x', 'x', 'x', true)$q$, :pid_q), '42501');
SELECT t.expect_error($q$SELECT * FROM public.booking_engine_due_reminders()$q$, '42501');
SELECT t.expect_error($q$SELECT public.booking_engine_worker_secret()$q$, '42501');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);

\echo 'booking engine v2 integration: all checks passed'
