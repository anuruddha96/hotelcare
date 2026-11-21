-- NTAK PMS v9 migration checks (run after ntak_fixture.sql + the migration).
\set ON_ERROR_STOP on

DO $$
DECLARE
  g1 uuid; g2 uuid; r101 uuid; r102 uuid; res uuid; n int; t text;
BEGIN
  INSERT INTO public.guests (first_name, last_name, hotel_id) VALUES ('Edit', 'Teszt', 'h1') RETURNING id INTO g1;
  INSERT INTO public.guests (first_name, last_name, hotel_id) VALUES ('Anna', 'Kovacs', 'h1') RETURNING id INTO g2;
  INSERT INTO public.rooms (hotel, room_number) VALUES ('h1', '101') RETURNING id INTO r101;
  INSERT INTO public.rooms (hotel, room_number) VALUES ('h1', '102') RETURNING id INTO r102;

  -- 1. Disabled hotel: nothing is queued, but the booker becomes a stay guest.
  INSERT INTO public.reservations (hotel_id, organization_slug, guest_id, room_id, check_in_date, check_out_date, channex_booking_id, reservation_number)
  VALUES ('h1', 'org', g1, r101, current_date + 10, current_date + 12, 'CHX-1', 'HC-1') RETURNING id INTO res;
  SELECT count(*) INTO n FROM public.ntak_booking_queue;
  IF n <> 0 THEN RAISE EXCEPTION 'disabled hotel must not queue bookings (%)', n; END IF;
  SELECT count(*) INTO n FROM public.reservation_guests WHERE reservation_id = res AND guest_id = g1 AND is_primary;
  IF n <> 1 THEN RAISE EXCEPTION 'booker must be a primary stay guest'; END IF;

  -- 2. Enabled hotel: booking changes are queued under the shared booking number.
  INSERT INTO public.ntak_settings (hotel_id, organization_slug, enabled, registration_number, provider_tax_number)
  VALUES ('h1', 'org', true, 'SZ25003491', '69861195-2-44');
  UPDATE public.reservations SET adults = 2 WHERE id = res;
  SELECT booking_no INTO t FROM public.ntak_booking_queue WHERE hotel_id = 'h1';
  IF t IS DISTINCT FROM 'CHX-1' THEN RAISE EXCEPTION 'booking number should be the Channex booking id, got %', t; END IF;
  IF public.ntak_booking_no(NULL, '', 'HC-9', res) <> 'HC-9' THEN RAISE EXCEPTION 'empty ids must be skipped like in ledger.ts'; END IF;

  -- 3. Stay events and corrections.
  UPDATE public.reservations SET status = 'checked_in', check_in_date = current_date, check_out_date = current_date + 2 WHERE id = res;
  UPDATE public.reservations SET room_id = r102 WHERE id = res;
  UPDATE public.reservations SET status = 'checked_out' WHERE id = res;
  UPDATE public.reservations SET status = 'checked_in' WHERE id = res;
  SELECT string_agg(kind || CASE WHEN is_correction THEN '*' ELSE '' END, ',' ORDER BY occurred_at) INTO t FROM public.ntak_event_queue WHERE reservation_id = res;
  IF t IS DISTINCT FROM 'erkezett,lakoegysegetCserelt,tavozott,erkezett*' THEN RAISE EXCEPTION 'unexpected event sequence %', t; END IF;
  SELECT count(*) INTO n FROM public.ntak_event_queue WHERE kind = 'lakoegysegetCserelt' AND from_room_id = r101 AND room_id = r102;
  IF n <> 1 THEN RAISE EXCEPTION 'room change must record both rooms'; END IF;

  -- 4. A new booker becomes primary; the old one stays as companion.
  UPDATE public.reservations SET guest_id = g2 WHERE id = res;
  SELECT string_agg(CASE WHEN is_primary THEN 'P' ELSE 'C' END, '' ORDER BY is_primary DESC) INTO t FROM public.reservation_guests WHERE reservation_id = res;
  IF t IS DISTINCT FROM 'PC' THEN RAISE EXCEPTION 'expected one primary and one companion, got %', t; END IF;

  -- 5. NTAK bookkeeping never blocks a front-desk write.
  ALTER TABLE public.ntak_booking_queue RENAME TO ntak_booking_queue_off;
  UPDATE public.reservations SET adults = 3 WHERE id = res;
  ALTER TABLE public.ntak_booking_queue_off RENAME TO ntak_booking_queue;
  SELECT adults INTO n FROM public.reservations WHERE id = res;
  IF n <> 3 THEN RAISE EXCEPTION 'reservation update must succeed even when NTAK queueing fails'; END IF;

  -- 6. Vault helpers: create, update, read; never callable by clients.
  PERFORM public.ntak_put_secret('h1', 'salt', 'first');
  PERFORM public.ntak_put_secret('h1', 'salt', 'zDaBMMumxc/1rLNjHHg55O');
  IF public.ntak_get_secret('h1', 'salt') <> 'zDaBMMumxc/1rLNjHHg55O' THEN RAISE EXCEPTION 'secret update failed'; END IF;
  SELECT count(*) INTO n FROM vault.secrets WHERE name = public.ntak_secret_name('h1', 'salt');
  IF n <> 1 THEN RAISE EXCEPTION 'secret must be updated in place'; END IF;
  IF has_function_privilege('authenticated', 'public.ntak_get_secret(text,text)', 'EXECUTE') THEN RAISE EXCEPTION 'clients must not read NTAK secrets'; END IF;
  IF has_function_privilege('anon', 'public.ntak_put_secret(text,text,text)', 'EXECUTE') THEN RAISE EXCEPTION 'anon must not write NTAK secrets'; END IF;
  BEGIN
    PERFORM public.ntak_put_secret('h1', 'other', 'x');
    RAISE EXCEPTION 'unknown secret kinds must be rejected';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'NTAK_SECRET_KIND' THEN RAISE; END IF;
  END;

  -- 7. Constraints mirror the NTAK formats.
  BEGIN
    UPDATE public.ntak_settings SET registration_number = 'sz123' WHERE hotel_id = 'h1';
    RAISE EXCEPTION 'invalid registration number accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.ntak_unit_profiles (room_id, hotel_id, room_number, single_beds) VALUES (r101, 'h1', '101', 2000);
    RAISE EXCEPTION 'bed count above 1000 accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

-- 8. RLS: staff of the hotel can read; others see nothing.
INSERT INTO public.profiles (id, role) VALUES ('00000000-0000-0000-0000-0000000000a1', 'manager'), ('00000000-0000-0000-0000-0000000000b2', 'manager');
INSERT INTO public.hotel_access VALUES ('00000000-0000-0000-0000-0000000000a1', 'h1');

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.ntak_settings) <> 1 THEN RAISE EXCEPTION 'hotel staff must see NTAK settings'; END IF;
  IF (SELECT count(*) FROM public.ntak_event_queue) <> 4 THEN RAISE EXCEPTION 'hotel staff must see NTAK events'; END IF;
  IF (SELECT count(*) FROM public.reservation_guests) <> 2 THEN RAISE EXCEPTION 'hotel staff must see stay guests'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', false);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.ntak_settings) <> 0 THEN RAISE EXCEPTION 'other hotels must not see NTAK settings'; END IF;
  IF (SELECT count(*) FROM public.ntak_messages) <> 0 THEN RAISE EXCEPTION 'other hotels must not see NTAK messages'; END IF;
  BEGIN
    UPDATE public.ntak_settings SET enabled = false;
    RAISE EXCEPTION 'clients must not write NTAK settings';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;


-- Re-downloading a pending request must preserve the original key.
do $$
declare registration text; result text;
begin
  select registration_number into strict registration from public.ntak_settings where hotel_id = 'h1';
  perform public.ntak_save_pending_csr('h1',registration,'csr-a','key-a','hash-a');
  result := public.ntak_save_pending_csr('h1',registration,'csr-b','key-b','hash-b');
  if result is distinct from 'csr-a' or public.ntak_get_secret('h1','pending_key') is distinct from 'key-a' then
    raise exception 'Repeat request replaced its key';
  end if;
  begin
    perform public.ntak_install_certificate('h1',registration,'cert-b','key-b',true,'{}','01',now()+interval '1 day');
    raise exception 'Stale key was accepted';
  exception when raise_exception then
    if sqlerrm <> 'Registration or pending key changed' then raise; end if;
  end;
  perform public.ntak_install_certificate('h1',registration,'cert-a','key-a',true,'{}','01',now()+interval '1 day');
  if public.ntak_get_secret('h1','key') is distinct from 'key-a' or public.ntak_get_secret('h1','cert') is distinct from 'cert-a'
    or public.ntak_get_secret('h1','pending_key') is not null or
    (select pending_csr_pem from public.ntak_settings where hotel_id='h1') is not null then
    raise exception 'Certificate promotion failed';
  end if;
end $$;

SELECT 'ntak migration checks passed' AS result;
