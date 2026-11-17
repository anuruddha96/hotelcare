-- Extra fixture for the In-Suite wellness migration. Runs after
-- booking_engine_fixture.sql (roles, auth.uid, tenancy, rooms, guests,
-- reservations copied from production) and before the migration.

-- The two hotels the migration seeds resources for.
INSERT INTO public.hotel_configurations (hotel_id, hotel_name, organization_id, settings) VALUES
  ('channex-test-property', 'Test Property - HotelCare', '00000000-0000-0000-0000-0000000000c1', '{"native_ari": true}'),
  ('memories-budapest', 'Hotel Memories Budapest', '00000000-0000-0000-0000-0000000000a1', '{}');

INSERT INTO public.profiles (id, role, is_super_admin, organization_slug, hotel_ids) VALUES
  ('00000000-0000-0000-0000-00000000bbb1', 'reception', false, 'channex', ARRAY['channex-test-property']),
  ('00000000-0000-0000-0000-00000000bbb2', 'reception', false, 'rdhotels', ARRAY['memories-budapest']);

INSERT INTO public.rooms (id, hotel, room_number) VALUES
  ('00000000-0000-0000-0000-000000000101', 'channex-test-property', '101'),
  ('00000000-0000-0000-0000-000000000102', 'channex-test-property', '102'),
  ('00000000-0000-0000-0000-000000000201', 'memories-budapest', '201');

INSERT INTO public.guests (id, hotel_id, organization_slug, first_name, last_name, email) VALUES
  ('00000000-0000-0000-0000-00000000c001', 'channex-test-property', 'channex', 'Anna', 'Kovács', 'anna@example.org'),
  ('00000000-0000-0000-0000-00000000c002', 'channex-test-property', 'channex', 'Peter', 'Nagy', NULL);

-- Local "today" in Budapest, so the test behaves the same at any UTC hour.
CREATE OR REPLACE FUNCTION public.t_local_today() RETURNS date LANGUAGE sql STABLE AS
  $$ SELECT (now() AT TIME ZONE 'Europe/Budapest')::date $$;

INSERT INTO public.reservations (id, hotel_id, organization_slug, guest_id, room_id, status,
  check_in_date, check_out_date, source, source_reservation_id, pms_guest_name) VALUES
  -- R1 in house in 101 until the day after tomorrow
  ('00000000-0000-0000-0000-0000000d0001', 'channex-test-property', 'channex', '00000000-0000-0000-0000-00000000c001',
   '00000000-0000-0000-0000-000000000101', 'checked_in', public.t_local_today() - 1, public.t_local_today() + 2, 'direct', 'W-R1', 'Anna Kovács'),
  -- R2 arrives in 5 days, no room yet (books from the website before arrival)
  ('00000000-0000-0000-0000-0000000d0002', 'channex-test-property', 'channex', '00000000-0000-0000-0000-00000000c002',
   NULL, 'confirmed', public.t_local_today() + 5, public.t_local_today() + 7, 'direct', 'W-R2', 'Peter Nagy'),
  -- R3 cancelled
  ('00000000-0000-0000-0000-0000000d0003', 'channex-test-property', 'channex', NULL,
   NULL, 'cancelled', public.t_local_today(), public.t_local_today() + 2, 'direct', 'W-R3', 'Cancelled Guest'),
  -- R4 another in-house guest in 102
  ('00000000-0000-0000-0000-0000000d0004', 'channex-test-property', 'channex', NULL,
   '00000000-0000-0000-0000-000000000102', 'checked_in', public.t_local_today(), public.t_local_today() + 3, 'direct', 'W-R4', 'Other Guest'),
  -- R5 at another hotel
  ('00000000-0000-0000-0000-0000000d0005', 'memories-budapest', 'rdhotels', NULL,
   '00000000-0000-0000-0000-000000000201', 'checked_in', public.t_local_today(), public.t_local_today() + 3, 'previo', 'P-R5', 'Memories Guest');
