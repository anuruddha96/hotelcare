-- Guest journey integration test. Runs after guest_journey_fixture.sql and the
-- 20261117160000_guest_journey.sql migration. Every check raises on failure.

-- ------------------------------------------------------------ name key
DO $$ BEGIN
  ASSERT public.pms_guest_name_key('Kovács Anna') = 'anna kovacs', public.pms_guest_name_key('Kovács Anna');
  ASSERT public.pms_guest_name_key('Dr. Anna  KOVÁCS') = 'anna kovacs', 'title, accents, case, spaces';
  ASSERT public.pms_guest_name_key('Müller, Hans') = public.pms_guest_name_key('Hans Muller'), 'umlaut and comma';
  ASSERT public.pms_guest_name_key('Jean-Luc Picard') = 'jean luc picard', 'hyphen';
  ASSERT public.pms_guest_name_key('John J. Smith') = 'john smith', 'initials ignored';
  ASSERT public.pms_guest_name_key('Иван Петров') = public.pms_guest_name_key('Петров Иван'), 'cyrillic word order';
  ASSERT public.pms_guest_name_key('Иван Петров') IS NOT NULL, 'cyrillic has a key';
  ASSERT public.pms_guest_name_key('Anna') IS NULL, 'one word is not enough';
  ASSERT public.pms_guest_name_key('OTA Guest') IS NULL, 'placeholder';
  ASSERT public.pms_guest_name_key('') IS NULL AND public.pms_guest_name_key(NULL) IS NULL, 'empty';
  ASSERT public.pms_reservation_guest_key('  ', 'Kovacs Anna') = 'anna kovacs', 'contact name fallback';
  ASSERT public.pms_guest_display_name('Dr.  Anna   Kovács') = 'Anna Kovács', 'display name';
END $$;

-- ------------------------------------------------------------ data
-- h1 (Previo-like, no profiles): Anna's stays under four spellings, a group,
-- a one-word name and the previous occupant of room 101.
INSERT INTO public.reservations (id, reservation_number, hotel_id, room_id, status, check_in_date, check_out_date, adults, children,
                                 total_amount, currency, source, special_requests, pms_guest_name, pms_contact_email, pms_channel, ota_name)
VALUES
  ('00000000-0000-0000-0000-00000000d00a', 'A', 'h1', '00000000-0000-0000-0000-000000000101', 'checked_out', current_date - 60, current_date - 58, 2, 0, 200, 'EUR', 'previo', NULL, 'Kovács Anna', 'anna.k@example.org', 'Booking.com', 'Booking.com'),
  ('00000000-0000-0000-0000-00000000d00b', 'B', 'h1', '00000000-0000-0000-0000-000000000102', 'checked_out', current_date - 30, current_date - 27, 2, 1, 330, 'EUR', 'previo', 'Quiet room please', 'Anna KOVACS', NULL, 'Direct', NULL),
  ('00000000-0000-0000-0000-00000000d00c', 'C', 'h1', NULL, 'confirmed', current_date + 20, current_date + 22, 2, 0, 210, 'EUR', 'previo', NULL, 'Dr. Anna Kovács', NULL, 'Direct', NULL),
  ('00000000-0000-0000-0000-00000000d00d', 'D', 'h1', NULL, 'cancelled', current_date + 40, current_date + 41, 1, 0, 90, 'EUR', 'previo', NULL, 'Kovacs Anna', NULL, 'Direct', NULL),
  ('00000000-0000-0000-0000-00000000d0e1', 'G1', 'h1', '00000000-0000-0000-0000-000000000101', 'confirmed', current_date + 5, current_date + 7, 2, 0, 100, 'EUR', 'previo', NULL, 'Tour Group Alpha', NULL, 'Agency', NULL),
  ('00000000-0000-0000-0000-00000000d0e2', 'G2', 'h1', '00000000-0000-0000-0000-000000000102', 'confirmed', current_date + 5, current_date + 7, 2, 0, 100, 'EUR', 'previo', NULL, 'Tour Group Alpha', NULL, 'Agency', NULL),
  ('00000000-0000-0000-0000-00000000d0e3', 'G3', 'h1', '00000000-0000-0000-0000-000000000103', 'confirmed', current_date + 5, current_date + 7, 2, 0, 100, 'EUR', 'previo', NULL, 'Tour Group Alpha', NULL, 'Agency', NULL),
  ('00000000-0000-0000-0000-00000000d0f1', 'J', 'h1', '00000000-0000-0000-0000-000000000103', 'confirmed', current_date + 1, current_date + 3, 1, 0, 120, 'EUR', 'previo', NULL, 'John Smith', NULL, 'Expedia', 'Expedia'),
  ('00000000-0000-0000-0000-00000000d0f2', 'S', 'h1', NULL, 'checked_out', current_date - 10, current_date - 9, 1, 0, 60, 'EUR', 'previo', NULL, 'Anna', NULL, 'Direct', NULL),
  ('00000000-0000-0000-0000-00000000d0f3', 'P', 'h1', '00000000-0000-0000-0000-000000000101', 'checked_out', current_date - 62, current_date - 60, 1, 0, 150, 'EUR', 'previo', NULL, 'Peter Previous', NULL, 'Direct', NULL);

-- Minibar and breakfast belong to whoever slept the night before.
INSERT INTO public.room_minibar_usage (room_id, minibar_item_id, quantity_used, usage_date) VALUES
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-00000000c001', 2, ((current_date - 59) + time '10:00') AT TIME ZONE 'Europe/Budapest'),
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-00000000c002', 1, ((current_date - 58) + time '10:00') AT TIME ZONE 'Europe/Budapest'),
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-00000000c002', 1, ((current_date - 60) + time '09:00') AT TIME ZONE 'Europe/Budapest');
INSERT INTO public.breakfast_attendance (hotel_id, stay_date, room_number, served_count) VALUES
  ('h1', current_date - 59, '101', 2),
  ('h1', current_date - 58, '101 ', 2),
  ('h1', current_date - 60, '101', 1),
  ('h1', current_date - 57, '101', 0);
INSERT INTO public.insuite_orders (id, hotel_id, room_id, reservation_id, status) VALUES
  ('00000000-0000-0000-0000-00000000e001', 'h1', '00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-00000000d00b', 'completed'),
  ('00000000-0000-0000-0000-00000000e002', 'h1', '00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-00000000d00b', 'cancelled');
INSERT INTO public.insuite_order_lines (order_id, name_snapshot, quantity) VALUES
  ('00000000-0000-0000-0000-00000000e001', 'Espresso', 2),
  ('00000000-0000-0000-0000-00000000e001', 'Club sandwich', 1),
  ('00000000-0000-0000-0000-00000000e002', 'Champagne', 1);
INSERT INTO public.insuite_service_requests (hotel_id, room_id, request_type, created_at) VALUES
  ('h1', '00000000-0000-0000-0000-000000000102', 'towels', ((current_date - 29) + time '15:00') AT TIME ZONE 'Europe/Budapest'),
  ('h1', '00000000-0000-0000-0000-000000000102', 'cleaning', ((current_date - 30) + time '10:00') AT TIME ZONE 'Europe/Budapest');

-- h2 (HotelCare PMS): the same person got a new guests row per booking; one
-- reservation was entered by hand (no PMS name), one came from an OTA.
INSERT INTO public.guests (id, hotel_id, organization_slug, first_name, last_name, email, created_at) VALUES
  ('00000000-0000-0000-0000-00000000b001', 'h2', 'rdhotels', 'Peter', 'Nagy', 'peter@example.org', now() - interval '100 days'),
  ('00000000-0000-0000-0000-00000000b002', 'h2', 'rdhotels', 'Péter', 'Nagy', NULL, now() - interval '1 day'),
  ('00000000-0000-0000-0000-00000000b003', 'h2', 'rdhotels', 'OTA', 'Guest', NULL, now());
INSERT INTO public.reservations (id, reservation_number, hotel_id, guest_id, room_id, status, check_in_date, check_out_date, total_amount, currency, source, pms_guest_name)
VALUES
  ('00000000-0000-0000-0000-00000000d201', 'N1', 'h2', '00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-000000000201', 'checked_out', current_date - 50, current_date - 48, 180, 'USD', 'direct', NULL),
  ('00000000-0000-0000-0000-00000000d202', 'N2', 'h2', '00000000-0000-0000-0000-00000000b002', NULL, 'confirmed', current_date + 3, current_date + 5, 190, 'USD', 'channex', 'Peter Nagy'),
  ('00000000-0000-0000-0000-00000000d203', 'N3', 'h2', '00000000-0000-0000-0000-00000000b003', NULL, 'confirmed', current_date + 8, current_date + 9, 95, 'USD', 'channex', 'OTA Guest');

CREATE TEMP TABLE res (k text PRIMARY KEY, v jsonb);
GRANT ALL ON res TO authenticated;

-- ------------------------------------------------------------ profile
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000aaa1', false);
INSERT INTO res SELECT 'anna', public.pms_guest_profile('h1', 'n:Anna Kovács');
DO $$
DECLARE p jsonb := (SELECT v FROM res WHERE k = 'anna'); a jsonb;
BEGIN
  ASSERT p->>'key' = 'n:anna kovacs' AND NOT (p->>'has_profile')::boolean AND p->'guest_id' = 'null'::jsonb, format('identity %s', p->>'key');
  ASSERT p->>'name' = 'Anna Kovács', format('display name %s', p->>'name');
  ASSERT p->>'email' = 'anna.k@example.org', 'email from bookings';
  ASSERT (p->'stats'->>'stays')::int = 3 AND (p->'stats'->>'cancelled')::int = 1, format('stats %s', p->'stats');
  ASSERT (p->'stats'->>'nights')::int = 7 AND (p->'stats'->>'spend')::numeric = 740 AND p->'stats'->>'currency' = 'EUR', 'nights and spend';
  ASSERT (p->'stats'->>'first_stay')::date = current_date - 60 AND (p->'stats'->>'last_stay')::date = current_date - 27, 'first and last stay';
  ASSERT (p->'stats'->>'next_arrival')::date = current_date + 20 AND NOT (p->'stats'->>'in_house')::boolean, 'next arrival';
  ASSERT p->'learned'->'minibar' = '[{"qty": 2, "name": "Coca-Cola"}, {"qty": 1, "name": "Pringles"}]'::jsonb, format('minibar %s', p->'learned'->'minibar');
  ASSERT (p->'learned'->>'minibar_stays')::int = 1, 'one stay with minibar';
  ASSERT (p->'learned'->>'breakfast_days')::int = 2, format('breakfast %s', p->'learned'->>'breakfast_days');
  ASSERT (p->'learned'->>'insuite_orders')::int = 1 AND p->'learned'->'insuite_items' = '["Club sandwich", "Espresso"]'::jsonb, format('in-suite %s', p->'learned');
  ASSERT p->'learned'->'requests' = '[{"type": "towels", "count": 1}]'::jsonb, format('requests %s', p->'learned'->'requests');
  ASSERT (p->'learned'->>'children_stays')::int = 1 AND (p->'learned'->>'max_party')::int = 3, 'party';
  ASSERT jsonb_array_length(p->'stays') = 4 AND p->'stays'->0->>'reservation_number' = 'D', 'all four bookings, newest first';
  SELECT s INTO a FROM jsonb_array_elements(p->'stays') s WHERE s->>'reservation_number' = 'A';
  ASSERT (a->>'breakfast_days')::int = 2 AND jsonb_array_length(a->'minibar') = 2 AND a->>'room_type' = 'Dvoulůžkový pokoj', format('stay A %s', a);
END $$;

DO $$ BEGIN
  ASSERT public.pms_guest_profile('h1', 'n:zz qq') IS NULL, 'unknown guest';
  ASSERT public.pms_guest_profile('h1', 'garbage') IS NULL, 'bad key';
  ASSERT public.pms_guest_profile(NULL, 'g:' || gen_random_uuid()) IS NULL, 'unknown guest row';
END $$;

-- One person, three guests rows: the oldest holds the profile.
DO $$
DECLARE p jsonb := public.pms_guest_profile(NULL, 'g:00000000-0000-0000-0000-00000000b002');
BEGIN
  ASSERT p->>'key' = 'n:nagy peter' AND p->>'guest_id' = '00000000-0000-0000-0000-00000000b001', format('merged identity %s', p);
  ASSERT (p->>'profile_count')::int = 2 AND (p->'stats'->>'stays')::int = 2 AND p->>'email' = 'peter@example.org', 'both stays, oldest row';
  p := public.pms_guest_profile(NULL, 'g:00000000-0000-0000-0000-00000000b003');
  ASSERT p->>'key' = 'g:00000000-0000-0000-0000-00000000b003' AND (p->'stats'->>'stays')::int = 1, 'placeholder name stays on its own row';
END $$;

-- No access to the hotel.
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000aaa2', false);
DO $$ BEGIN
  BEGIN
    PERFORM public.pms_guest_profile('h1', 'n:anna kovacs');
    RAISE EXCEPTION 'must be forbidden';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.pms_guest_profile_save('h1', 'n:anna kovacs', '{"vip": true}');
    RAISE EXCEPTION 'save must be forbidden';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  ASSERT (SELECT count(*) FROM public.pms_guest_signals(ARRAY['00000000-0000-0000-0000-00000000d00c'::uuid])) = 0, 'no signals for other hotels';
END $$;

-- ------------------------------------------------------------ save preferences
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000aaa1', false);
INSERT INTO res SELECT 'save1', public.pms_guest_profile_save('h1', 'n:anna kovacs',
  '{"tags": ["quiet_room", "extra_pillows", "quiet_room", " "], "dietary": "Gluten-free", "notes": "Prefers a high floor", "vip": true, "nationality": "hu"}');
RESET ROLE;
DO $$
DECLARE s jsonb := (SELECT v FROM res WHERE k = 'save1'); g public.guests%ROWTYPE;
BEGIN
  ASSERT (s->>'ok')::boolean AND s->>'key' = 'n:anna kovacs', format('save %s', s);
  SELECT * INTO g FROM public.guests WHERE id = (s->>'guest_id')::uuid;
  ASSERT g.hotel_id = 'h1' AND g.organization_slug = 'rdhotels' AND g.first_name = 'Anna' AND g.last_name = 'Kovács', format('created profile %s %s', g.first_name, g.last_name);
  ASSERT g.email = 'anna.k@example.org', 'contact comes from the latest stay that has one';
  ASSERT g.vip_status = 'vip' AND g.nationality = 'HU' AND g.notes = 'Prefers a high floor', 'columns';
  ASSERT g.preferences->'tags' = '["extra_pillows", "quiet_room"]'::jsonb AND g.preferences->>'dietary' = 'Gluten-free', format('prefs %s', g.preferences);
  ASSERT g.preferences->>'profile_source' = 'bookings' AND g.preferences->>'updated_by' = '00000000-0000-0000-0000-00000000aaa1', 'audit';
  ASSERT (SELECT count(*) FROM public.reservations WHERE hotel_id = 'h1' AND guest_id IS NOT NULL) = 0, 'reservations are never rewritten';
END $$;

SET ROLE authenticated;
-- Reception signals right after the save.
INSERT INTO res SELECT 'sig', jsonb_agg(to_jsonb(s)) FROM public.pms_guest_signals(ARRAY[
  '00000000-0000-0000-0000-00000000d00c', '00000000-0000-0000-0000-00000000d0e1', '00000000-0000-0000-0000-00000000d0f1',
  '00000000-0000-0000-0000-00000000d00a', '00000000-0000-0000-0000-00000000d0f2', '00000000-0000-0000-0000-00000000d202']::uuid[]) s;
DO $$
DECLARE all_s jsonb := (SELECT v FROM res WHERE k = 'sig'); x jsonb;
BEGIN
  ASSERT jsonb_array_length(all_s) = 6, format('six signals %s', all_s);
  SELECT e INTO x FROM jsonb_array_elements(all_s) e WHERE e->>'reservation_id' = '00000000-0000-0000-0000-00000000d00c';
  ASSERT (x->>'previous_stays')::int = 2 AND (x->>'last_stay_end')::date = current_date - 27 AND (x->>'group_size')::int = 1, format('Anna C %s', x);
  ASSERT (x->>'vip')::boolean AND x->'tags' = '["extra_pillows", "quiet_room"]'::jsonb AND x->>'dietary' = 'Gluten-free' AND x->>'notes' = 'Prefers a high floor', 'Anna preferences';
  SELECT e INTO x FROM jsonb_array_elements(all_s) e WHERE e->>'reservation_id' = '00000000-0000-0000-0000-00000000d0e1';
  ASSERT (x->>'previous_stays')::int = 0 AND (x->>'group_size')::int = 3, format('group %s', x);
  SELECT e INTO x FROM jsonb_array_elements(all_s) e WHERE e->>'reservation_id' = '00000000-0000-0000-0000-00000000d0f1';
  ASSERT (x->>'previous_stays')::int = 0 AND x->>'profile_key' = 'n:john smith', 'first-time guest';
  SELECT e INTO x FROM jsonb_array_elements(all_s) e WHERE e->>'reservation_id' = '00000000-0000-0000-0000-00000000d00a';
  ASSERT (x->>'previous_stays')::int = 0, 'first stay has no previous stays';
  SELECT e INTO x FROM jsonb_array_elements(all_s) e WHERE e->>'reservation_id' = '00000000-0000-0000-0000-00000000d0f2';
  ASSERT x->'profile_key' = 'null'::jsonb AND (x->>'previous_stays')::int = 0, 'one-word name is never matched';
  SELECT e INTO x FROM jsonb_array_elements(all_s) e WHERE e->>'reservation_id' = '00000000-0000-0000-0000-00000000d202';
  ASSERT (x->>'previous_stays')::int = 1 AND x->>'guest_id' = '00000000-0000-0000-0000-00000000b001', format('Peter %s', x);
END $$;

-- Clearing values and validation.
SELECT public.pms_guest_profile_save('h1', 'n:anna kovacs', '{"dietary": "", "tags": [], "vip": false}');
DO $$
DECLARE p jsonb := public.pms_guest_profile('h1', 'n:anna kovacs');
BEGIN
  ASSERT (p->>'has_profile')::boolean AND NOT (p->>'vip')::boolean AND p->'tags' = '[]'::jsonb AND p->'dietary' = 'null'::jsonb, format('cleared %s', p);
  ASSERT p->>'nationality' = 'HU' AND p->>'notes' = 'Prefers a high floor', 'untouched fields stay';
  ASSERT (p->'stats'->>'stays')::int = 3, 'still all stays';
  BEGIN
    PERFORM public.pms_guest_profile_save('h1', 'n:anna kovacs', '{"nationality": "HUN"}');
    RAISE EXCEPTION 'bad nationality accepted';
  EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM = 'INVALID_NATIONALITY', SQLERRM;
  END;
  BEGIN
    PERFORM public.pms_guest_profile_save('h1', 'n:anna kovacs',
      jsonb_build_object('tags', (SELECT jsonb_agg('tag' || i) FROM generate_series(1, 25) i)));
    RAISE EXCEPTION 'too many tags accepted';
  EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM = 'TOO_MANY_TAGS', SQLERRM;
  END;
  ASSERT (SELECT count(*) FROM public.guests WHERE hotel_id = 'h1') = 1, 'still one profile';
END $$;

-- ------------------------------------------------------------ directory
DO $$
DECLARE d jsonb;
BEGIN
  SELECT x INTO d FROM public.pms_guest_directory(ARRAY['h1'], NULL, 200, 0) x WHERE x->>'profile_key' = 'n:anna kovacs';
  ASSERT d->>'kind' = 'profile' AND (d->>'stays')::int = 3 AND d->>'name' = 'Anna Kovács' AND d->>'nationality' = 'HU', format('Anna row %s', d);
  ASSERT (SELECT count(*) FROM public.pms_guest_directory(ARRAY['h1'], NULL, 200, 0) x WHERE x->>'profile_key' = 'n:alpha group tour') = 1, 'group is one row';
  ASSERT (SELECT (x->>'stays')::int FROM public.pms_guest_directory(ARRAY['h1'], NULL, 200, 0) x WHERE x->>'profile_key' = 'n:alpha group tour') = 1, 'group is one stay';
  ASSERT (SELECT count(*) FROM public.pms_guest_directory(ARRAY['h1'], 'kovacs', 50, 0)) = 1, 'accent-free search';
  ASSERT (SELECT count(*) FROM public.pms_guest_directory(ARRAY['h1'], 'KOVÁCS anna', 50, 0)) = 1, 'word order search';
  ASSERT (SELECT count(*) FROM public.pms_guest_directory(ARRAY['h1'], 'anna.k@', 50, 0)) = 1, 'email search';
  SELECT x INTO d FROM public.pms_guest_directory(ARRAY['h2'], NULL, 200, 0) x WHERE x->>'profile_key' = 'n:nagy peter';
  ASSERT (d->>'stays')::int = 2 AND d->>'guest_id' = '00000000-0000-0000-0000-00000000b001', format('Peter row %s', d);
  ASSERT (SELECT count(*) FROM public.pms_guest_directory(ARRAY['h2'], NULL, 200, 0)) = 2, 'Peter once, OTA placeholder once';
END $$;
RESET ROLE;

-- ------------------------------------------------------------ grants
SET ROLE anon;
DO $$ BEGIN
  BEGIN
    PERFORM public.pms_guest_profile('h1', 'n:anna kovacs');
    RAISE EXCEPTION 'anon must not read profiles';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.pms_guest_signals(ARRAY[gen_random_uuid()]);
    RAISE EXCEPTION 'anon must not read signals';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
SET ROLE authenticated;
DO $$ BEGIN
  BEGIN
    PERFORM public.pms_guest_identity('h1', 'n:anna kovacs');
    RAISE EXCEPTION 'identity helper must stay internal';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

\echo 'guest journey integration: all checks passed'
