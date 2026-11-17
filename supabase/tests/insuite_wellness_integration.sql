-- In-Suite wellness integration test. Runs after booking_engine_fixture.sql,
-- insuite_wellness_fixture.sql and the 20261117180000_insuite_wellness.sql
-- migration. Every check raises on failure.

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

-- Slot start in Budapest local time, N days from today.
CREATE OR REPLACE FUNCTION t.at(p_days int, p_time text) RETURNS timestamptz LANGUAGE sql STABLE AS $$
  SELECT ((public.t_local_today() + p_days) + p_time::time) AT TIME ZONE 'Europe/Budapest'
$$;
CREATE OR REPLACE FUNCTION t.res_id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-0000-0000-0000000d000' || p)::uuid
$$;
CREATE OR REPLACE FUNCTION t.resource(p_hotel text, p_kind text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM public.insuite_wellness_resources WHERE hotel_id = p_hotel AND kind = p_kind
$$;
CREATE OR REPLACE FUNCTION t.book(p_kind text, p_days int, p_time text, p_party int, p_res text,
                                  p_source text DEFAULT 'insuite', p_client uuid DEFAULT NULL, p_name text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.insuite_wellness_book(t.resource('channex-test-property', p_kind), t.at(p_days, p_time), p_party,
    p_source, CASE WHEN p_res IS NULL THEN NULL ELSE t.res_id(p_res) END, NULL, p_name, NULL, NULL, p_client, '')
$$;
CREATE TABLE IF NOT EXISTS t.res (k text PRIMARY KEY, v jsonb NOT NULL);
GRANT ALL ON t.res TO anon, authenticated, service_role;

-- ------------------------------------------------------------ seed and defaults
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM public.insuite_wellness_resources) = 4, 'jacuzzi + sauna seeded for two hotels';
  ASSERT (SELECT bool_and(is_active) FROM public.insuite_wellness_resources WHERE hotel_id = 'channex-test-property'), 'test property switched on';
  ASSERT NOT (SELECT bool_or(is_active) FROM public.insuite_wellness_resources WHERE hotel_id = 'memories-budapest'), 'memories waits for a top manager';
  ASSERT (SELECT bool_and(slot_minutes = 60 AND max_guests = 2 AND price = 0 AND max_per_day = 1
                          AND opens_at = '09:00' AND closes_at = '21:00')
            FROM public.insuite_wellness_resources), 'defaults: 60 min, 2 guests, free, once a day, 09-21';
  ASSERT (SELECT organization_slug FROM public.insuite_wellness_resources WHERE hotel_id = 'memories-budapest' LIMIT 1) = 'rdhotels', 'org slug from hotel';
END $$;

-- ------------------------------------------------------------ calendar
DO $$
DECLARE c jsonb; day jsonb;
BEGIN
  c := public.insuite_wellness_slots('channex-test-property', public.t_local_today() + 1, public.t_local_today() + 2);
  ASSERT (c->>'ok')::boolean, 'calendar ok';
  ASSERT jsonb_array_length(c->'resources') = 2, 'two active resources';
  day := c->'resources'->0->'days'->0;
  ASSERT jsonb_array_length(day->'slots') = 12, format('12 one-hour slots between 09 and 21, got %s', jsonb_array_length(day->'slots'));
  ASSERT (day->'slots'->0->>'starts_at')::timestamptz = t.at(1, '09:00'), 'first slot 09:00 Budapest';
  ASSERT (day->'slots'->11->>'ends_at')::timestamptz = t.at(1, '21:00'), 'last slot ends 21:00';
  ASSERT (SELECT bool_and(s->>'status' = 'free') FROM jsonb_array_elements(day->'slots') s), 'all free tomorrow';
  ASSERT jsonb_array_length(public.insuite_wellness_slots('channex-test-property', public.t_local_today(), public.t_local_today() + 1, NULL, true, true)->'resources') = 2, 'inactive filter by hotel';
  ASSERT jsonb_array_length(public.insuite_wellness_slots('memories-budapest', public.t_local_today(), public.t_local_today())->'resources') = 0, 'inactive hidden';
  ASSERT jsonb_array_length(public.insuite_wellness_slots('memories-budapest', public.t_local_today(), public.t_local_today(), NULL, true, true)->'resources') = 2, 'inactive shown for setup';
  ASSERT NOT (public.insuite_wellness_slots('channex-test-property', public.t_local_today() + 2, public.t_local_today() + 1)->>'ok')::boolean, 'reversed range refused';
  -- today: nothing that started more than 15 minutes ago is offered
  c := public.insuite_wellness_slots('channex-test-property', public.t_local_today(), public.t_local_today());
  ASSERT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(c->'resources'->0->'days'->0->'slots') s
                      WHERE s->>'status' = 'free' AND (s->>'starts_at')::timestamptz < now() - interval '15 minutes'), 'past slots not free';
END $$;

-- ------------------------------------------------------------ booking
DO $$
DECLARE b jsonb;
BEGIN
  b := t.book('jacuzzi', 1, '10:00', 2, '1');
  ASSERT b->>'status' = 'booked' AND b->>'source' = 'insuite', 'booked instantly';
  ASSERT b->>'ticket_code' ~ '^JZ-[0-9A-F]{6}$', 'ticket code ' || (b->>'ticket_code');
  ASSERT b->>'guest_name' = 'Anna Kovács' AND b->>'room_number' = '101', 'guest and room from the stay';
  ASSERT (b->>'ends_at')::timestamptz = t.at(1, '11:00'), 'one hour';
  ASSERT b->>'resource_name' = 'Jacuzzi' AND b->>'hotel_name' = 'Test Property - HotelCare', 'names for e-mails';
  ASSERT NOT (b ? 'slot'), 'no internal range in the payload';
  INSERT INTO t.res VALUES ('r1_jacuzzi', b);
END $$;

-- Nobody else can take it, whatever channel.
SELECT t.expect_error($q$SELECT t.book('jacuzzi', 1, '10:00', 1, '4')$q$, 'SLOT_TAKEN');
SELECT t.expect_error($q$SELECT t.book('jacuzzi', 1, '10:00', 1, NULL, 'reception', NULL, 'Walk-in')$q$, 'SLOT_TAKEN');
-- Once a day per room by default; the sauna is separate.
SELECT t.expect_error($q$SELECT t.book('jacuzzi', 1, '12:00', 2, '1')$q$, 'DAILY_LIMIT');
DO $$ BEGIN ASSERT t.book('sauna', 1, '10:00', 2, '1')->>'ticket_code' ~ '^SA-', 'sauna at the same hour'; END $$;
-- Rules
SELECT t.expect_error($q$SELECT t.book('jacuzzi', 1, '14:00', 3, '4')$q$, 'TOO_MANY_GUESTS');
SELECT t.expect_error($q$SELECT t.book('jacuzzi', 1, '14:00', 0, '4')$q$, 'TOO_MANY_GUESTS');
SELECT t.expect_error($q$SELECT t.book('jacuzzi', 1, '14:30', 2, '4')$q$, 'INVALID_SLOT');
SELECT t.expect_error($q$SELECT t.book('jacuzzi', 1, '08:00', 2, '4')$q$, 'INVALID_SLOT');
SELECT t.expect_error($q$SELECT t.book('jacuzzi', 1, '20:30', 2, '4')$q$, 'INVALID_SLOT');
SELECT t.expect_error($q$SELECT t.book('jacuzzi', 1, '21:00', 2, '4')$q$, 'INVALID_SLOT');
SELECT t.expect_error($q$SELECT t.book('jacuzzi', -2, '10:00', 2, '4')$q$, 'SLOT_PASSED');
SELECT t.expect_error($q$SELECT t.book('jacuzzi', 5, '10:00', 2, '1')$q$, 'OUTSIDE_STAY');
SELECT t.expect_error($q$SELECT t.book('jacuzzi', 1, '15:00', 2, '3')$q$, 'STAY_NOT_ACTIVE');
SELECT t.expect_error($q$SELECT public.insuite_wellness_book(t.resource('channex-test-property', 'jacuzzi'), t.at(1, '15:00'), 1, 'insuite', t.res_id('5'))$q$, 'STAY_NOT_ACTIVE');
SELECT t.expect_error($q$SELECT public.insuite_wellness_book(t.resource('memories-budapest', 'jacuzzi'), t.at(1, '15:00'), 1, 'insuite', t.res_id('5'))$q$, 'WELLNESS_UNAVAILABLE');
SELECT t.expect_error($q$SELECT t.book('jacuzzi', 1, '15:00', 2, NULL, 'insuite')$q$, 'STAY_REQUIRED');
SELECT t.expect_error($q$SELECT t.book('jacuzzi', 1, '15:00', 2, NULL, 'booking_engine')$q$, 'STAY_REQUIRED');
SELECT t.expect_error($q$SELECT t.book('jacuzzi', 1, '15:00', 2, NULL, 'reception', NULL, '  ')$q$, 'GUEST_NAME_REQUIRED');
SELECT t.expect_error($q$SELECT t.book('jacuzzi', 1, '15:00', 2, '4', 'website')$q$, 'INVALID_SOURCE');
DO $$ BEGIN
  -- Pre-arrival booking from the website for the future stay.
  ASSERT t.book('jacuzzi', 5, '18:00', 2, '2', 'booking_engine')->>'guest_name' = 'Peter Nagy', 'pre-arrival booking';
  -- Walk-in at reception without a reservation.
  ASSERT t.book('sauna', 1, '16:00', 1, NULL, 'reception', NULL, 'Day Visitor')->>'reservation_id' IS NULL, 'walk-in';
END $$;

-- Retried request returns the same booking.
DO $$
DECLARE a jsonb; b jsonb;
BEGIN
  a := t.book('jacuzzi', 2, '09:00', 1, '4', 'insuite', '00000000-0000-0000-0000-00000000e001');
  b := t.book('jacuzzi', 2, '09:00', 1, '4', 'insuite', '00000000-0000-0000-0000-00000000e001');
  ASSERT a->>'id' = b->>'id' AND (b->>'repeated')::boolean AND NOT (a->>'repeated')::boolean, 'idempotent';
END $$;

-- ------------------------------------------------------------ the database guarantee
-- Even a direct insert that skips the function cannot overlap a live booking.
SELECT t.expect_error($q$
  INSERT INTO public.insuite_wellness_bookings (organization_slug, hotel_id, resource_id, guest_name, party_size, starts_at, ends_at, source, ticket_code)
  VALUES ('channex', 'channex-test-property', t.resource('channex-test-property', 'jacuzzi'), 'Sneaky', 1,
          t.at(1, '10:30'), t.at(1, '11:30'), 'reception', 'JZ-SNEAK1')$q$, '23P01');
SELECT t.expect_error($q$
  INSERT INTO public.insuite_wellness_bookings (organization_slug, hotel_id, resource_id, guest_name, party_size, starts_at, ends_at, source, ticket_code)
  VALUES ('channex', 'channex-test-property', t.resource('channex-test-property', 'jacuzzi'), 'Sneaky', 1,
          t.at(1, '09:00'), t.at(1, '12:00'), 'reception', 'JZ-SNEAK2')$q$, '23P01');
DO $$ BEGIN
  -- Back-to-back is fine: 11:00-12:00 touches 10:00-11:00 without overlapping.
  ASSERT t.book('jacuzzi', 1, '11:00', 2, '4')->>'status' = 'booked', 'adjacent slot';
END $$;

-- ------------------------------------------------------------ what each side sees
DO $$
DECLARE c jsonb; slots jsonb; s jsonb;
BEGIN
  c := public.insuite_wellness_slots('channex-test-property', public.t_local_today() + 1, public.t_local_today() + 1, t.res_id('1'));
  slots := (SELECT r->'days'->0->'slots' FROM jsonb_array_elements(c->'resources') r WHERE r->>'kind' = 'jacuzzi');
  s := slots->1;  -- 10:00, Anna's
  ASSERT s->>'status' = 'mine' AND s->'booking'->>'ticket_code' = (SELECT v->>'ticket_code' FROM t.res WHERE k = 'r1_jacuzzi'), 'guest sees own ticket';
  s := slots->2;  -- 11:00, the other guest's
  ASSERT s->>'status' = 'booked' AND NOT (s ? 'booking'), 'guest sees only that it is taken';
  ASSERT position('Other Guest' IN c::text) = 0 AND position('room_number' IN c::text) = 0, 'no other guest details leak';
  c := public.insuite_wellness_slots('channex-test-property', public.t_local_today() + 1, public.t_local_today() + 1, NULL, true);
  slots := (SELECT r->'days'->0->'slots' FROM jsonb_array_elements(c->'resources') r WHERE r->>'kind' = 'jacuzzi');
  ASSERT slots->2->'booking'->>'guest_name' = 'Other Guest' AND slots->2->'booking'->>'room_number' = '102', 'staff see who booked';
  ASSERT jsonb_array_length(public.insuite_wellness_stay_bookings(ARRAY[t.res_id('1')])) = 2, 'stay bookings: jacuzzi + sauna';
  ASSERT (public.insuite_wellness_stay_bookings(ARRAY[t.res_id('1')])->0->>'can_cancel')::boolean, 'future booking can be cancelled';
END $$;

-- ------------------------------------------------------------ cancel and staff actions
DO $$
DECLARE id uuid := (SELECT (v->>'id')::uuid FROM t.res WHERE k = 'r1_jacuzzi'); x jsonb;
BEGIN
  -- Another stay cannot cancel it.
  BEGIN
    PERFORM public.insuite_wellness_change(id, 'channex-test-property', 'cancel', NULL, t.res_id('4'));
    RAISE EXCEPTION 'other stay cancelled a booking';
  EXCEPTION WHEN OTHERS THEN ASSERT SQLERRM = 'NOT_FOUND', SQLERRM; END;
  -- A guest may only cancel.
  BEGIN
    PERFORM public.insuite_wellness_change(id, 'channex-test-property', 'complete', NULL, t.res_id('1'));
    RAISE EXCEPTION 'guest completed a booking';
  EXCEPTION WHEN OTHERS THEN ASSERT SQLERRM = 'INVALID_ACTION', SQLERRM; END;
  -- Wrong hotel finds nothing.
  BEGIN
    PERFORM public.insuite_wellness_change(id, 'memories-budapest', 'cancel');
    RAISE EXCEPTION 'cross-hotel change';
  EXCEPTION WHEN OTHERS THEN ASSERT SQLERRM = 'NOT_FOUND', SQLERRM; END;
  x := public.insuite_wellness_change(id, 'channex-test-property', 'cancel', NULL, t.res_id('1'), 'plans changed');
  ASSERT x->>'status' = 'cancelled' AND x->>'cancel_reason' = 'plans changed', 'guest cancelled own booking';
  -- The slot is free again and the daily limit no longer counts it.
  ASSERT t.book('jacuzzi', 1, '10:00', 1, '1')->>'status' = 'booked', 'rebooked after cancel';
END $$;

DO $$
DECLARE b jsonb; x jsonb;
BEGIN
  b := t.book('sauna', 2, '20:00', 2, '4');
  x := public.insuite_wellness_change((b->>'id')::uuid, 'channex-test-property', 'key_handed', '00000000-0000-0000-0000-00000000bbb1');
  ASSERT x->>'key_handed_at' IS NOT NULL AND x->>'status' = 'booked', 'key handed';
  BEGIN
    PERFORM public.insuite_wellness_change((b->>'id')::uuid, 'channex-test-property', 'no_show');
    RAISE EXCEPTION 'no-show before start';
  EXCEPTION WHEN OTHERS THEN ASSERT SQLERRM = 'TOO_EARLY', SQLERRM; END;
  x := public.insuite_wellness_change((b->>'id')::uuid, 'channex-test-property', 'complete');
  ASSERT x->>'status' = 'completed', 'completed';
  BEGIN
    PERFORM public.insuite_wellness_change((b->>'id')::uuid, 'channex-test-property', 'cancel');
    RAISE EXCEPTION 'cancelled a completed booking';
  EXCEPTION WHEN OTHERS THEN ASSERT SQLERRM = 'INVALID_TRANSITION', SQLERRM; END;
END $$;

-- A booking that has started can no longer be cancelled by the guest.
DO $$
DECLARE pid uuid;
BEGIN
  INSERT INTO public.insuite_wellness_bookings (organization_slug, hotel_id, resource_id, reservation_id, guest_name, party_size, starts_at, ends_at, source, ticket_code)
  VALUES ('channex', 'channex-test-property', t.resource('channex-test-property', 'sauna'), t.res_id('1'), 'Anna', 1,
          now() - interval '30 minutes', now() + interval '30 minutes', 'insuite', 'SA-PAST01') RETURNING id INTO pid;
  BEGIN
    PERFORM public.insuite_wellness_change(pid, 'channex-test-property', 'cancel', NULL, t.res_id('1'));
    RAISE EXCEPTION 'guest cancelled a started booking';
  EXCEPTION WHEN OTHERS THEN ASSERT SQLERRM = 'TOO_LATE', SQLERRM; END;
  ASSERT public.insuite_wellness_change(pid, 'channex-test-property', 'no_show')->>'status' = 'no_show', 'staff mark no-show after start';
END $$;

-- ------------------------------------------------------------ stay changes free the slots
DO $$
DECLARE live int; freed int;
BEGIN
  SELECT count(*) INTO live FROM public.insuite_wellness_bookings WHERE reservation_id = t.res_id('2') AND status = 'booked';
  ASSERT live >= 1, 'R2 has its pre-arrival booking';
  UPDATE public.reservations SET status = 'cancelled' WHERE id = t.res_id('2');
  SELECT count(*) INTO freed FROM public.insuite_wellness_bookings
   WHERE reservation_id = t.res_id('2') AND status = 'cancelled' AND cancel_reason = 'Stay cancelled';
  ASSERT freed = live, format('cancelling the stay freed %s of %s slots', freed, live);
  -- Early checkout frees what is still ahead, keeps the past.
  UPDATE public.reservations SET status = 'checked_out' WHERE id = t.res_id('1');
  ASSERT NOT EXISTS (SELECT 1 FROM public.insuite_wellness_bookings
                      WHERE reservation_id = t.res_id('1') AND status = 'booked' AND starts_at > now()), 'future slots freed at checkout';
  ASSERT EXISTS (SELECT 1 FROM public.insuite_wellness_bookings
                  WHERE reservation_id = t.res_id('1') AND cancel_reason = 'Guest checked out'), 'reason recorded';
  ASSERT EXISTS (SELECT 1 FROM public.insuite_wellness_bookings
                  WHERE reservation_id = t.res_id('1') AND status = 'no_show'), 'past no-show untouched';
  UPDATE public.reservations SET status = 'checked_in' WHERE id = t.res_id('1');  -- restore for the remaining checks
END $$;

-- ------------------------------------------------------------ opening days
UPDATE public.insuite_wellness_resources
   SET weekdays = ARRAY(SELECT d::smallint FROM generate_series(1, 7) d WHERE d <> extract(isodow FROM public.t_local_today() + 3))
 WHERE hotel_id = 'channex-test-property' AND kind = 'jacuzzi';
SELECT t.expect_error($q$SELECT t.book('jacuzzi', 3, '10:00', 1, '4')$q$, 'CLOSED');
DO $$
DECLARE day jsonb;
BEGIN
  day := (SELECT r->'days'->0 FROM jsonb_array_elements(public.insuite_wellness_slots('channex-test-property', public.t_local_today() + 3, public.t_local_today() + 3)->'resources') r WHERE r->>'kind' = 'jacuzzi');
  ASSERT NOT (day->>'open')::boolean AND jsonb_array_length(day->'slots') = 0, 'closed day has no slots';
END $$;

-- ------------------------------------------------------------ access
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000bbb1', false);  -- test property reception
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM public.insuite_wellness_bookings) > 0, 'reception sees the calendar';
  ASSERT (SELECT count(*) FROM public.insuite_wellness_resources WHERE hotel_id = 'memories-budapest') = 0, 'not other hotels';
END $$;
SELECT t.expect_error($q$UPDATE public.insuite_wellness_bookings SET status = 'cancelled'$q$, '42501');
SELECT t.expect_error($q$SELECT public.insuite_wellness_book(t.resource('channex-test-property', 'jacuzzi'), t.at(2, '19:00'), 1, 'reception', NULL, NULL, 'X')$q$, '42501');
SELECT t.expect_error($q$SELECT public.insuite_wellness_slots('channex-test-property', current_date, current_date)$q$, '42501');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000bbb2', false);  -- memories reception
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM public.insuite_wellness_bookings) = 0, 'memories staff see no test-property bookings';
  ASSERT (SELECT count(*) FROM public.insuite_wellness_resources) = 2, 'memories staff see their resources';
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
SET ROLE anon;
SELECT t.expect_error($q$SELECT public.insuite_wellness_stay_bookings(ARRAY[gen_random_uuid()])$q$, '42501');
SELECT t.expect_error($q$SELECT count(*) FROM public.insuite_wellness_bookings$q$, '42501');
RESET ROLE;

\echo 'insuite wellness integration: all checks passed'
