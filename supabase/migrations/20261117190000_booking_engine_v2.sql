-- Booking engine, second round.
--
--  1. Top management only: the settings page, the embed code for the
--     hotel's web team and the test link are no longer visible to other
--     managers or staff. Website bookings stay visible to reception.
--  2. Private test link: a per-engine token lets top managers open the
--     guest pages while the engine is switched off. Bookings made with it
--     are dry runs: every rule and price is checked, nothing is saved.
--     Without the token a switched-off engine shows only its name and
--     contact details, no rooms or prices.
--  3. Pre-arrival reminder N days before arrival (0 = off), sent by a daily
--     job. 4. Returning-guest lookup for the welcome-back e-mail lines.

-- ---------------------------------------------------------------- 1. top management only
CREATE OR REPLACE FUNCTION public.booking_engine_can_manage(_hotel_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT auth.uid() IS NOT NULL
     AND public.can_access_pms_hotel(auth.uid(), _hotel_id, NULL)
     AND (public.is_super_admin(auth.uid())
          OR public.get_user_role(auth.uid())::text = ANY (ARRAY['admin', 'top_management', 'top_management_manager']));
$fn$;

DROP POLICY IF EXISTS "Hotel staff read booking engine" ON public.booking_engines;
DROP POLICY IF EXISTS "Top management read booking engine" ON public.booking_engines;
CREATE POLICY "Top management read booking engine" ON public.booking_engines
  FOR SELECT TO authenticated USING (public.booking_engine_can_manage(hotel_id));

-- ---------------------------------------------------------------- 2. test link + reminders
ALTER TABLE public.booking_engines
  ADD COLUMN IF NOT EXISTS preview_token text NOT NULL
    DEFAULT (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  ADD COLUMN IF NOT EXISTS reminder_days smallint NOT NULL DEFAULT 3;
DO $$ BEGIN
  ALTER TABLE public.booking_engines ADD CONSTRAINT booking_engines_reminder_days CHECK (reminder_days BETWEEN 0 AND 14);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.booking_engines ADD CONSTRAINT booking_engines_preview_token CHECK (preview_token ~ '^[0-9a-f]{32,128}$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.booking_engine_bookings
  ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_status text;

-- New test link (the old one stops working at once).
CREATE OR REPLACE FUNCTION public.booking_engine_reset_preview_token(_hotel_id text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v text;
BEGIN
  IF NOT public.booking_engine_can_manage(_hotel_id) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = '42501'; END IF;
  v := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  UPDATE public.booking_engines SET preview_token = v WHERE hotel_id = _hotel_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  RETURN v;
END;
$fn$;
REVOKE ALL ON FUNCTION public.booking_engine_reset_preview_token(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.booking_engine_reset_preview_token(text) TO authenticated, service_role;

-- The guest-facing functions gain p_preview. The existing bodies are kept
-- as *_core / *_live (renamed, grants unchanged) and wrapped, so prices,
-- rules and the booking itself are exactly what was tested before.
DO $$ BEGIN
  IF to_regprocedure('public.booking_engine_public_config_full(text)') IS NULL THEN
    ALTER FUNCTION public.booking_engine_public_config(text) RENAME TO booking_engine_public_config_full;
  END IF;
  IF to_regprocedure('public.booking_engine_calendar_core(text, date, date)') IS NULL THEN
    ALTER FUNCTION public.booking_engine_calendar(text, date, date) RENAME TO booking_engine_calendar_core;
  END IF;
  IF to_regprocedure('public.booking_engine_search_core(text, date, date)') IS NULL THEN
    ALTER FUNCTION public.booking_engine_search(text, date, date) RENAME TO booking_engine_search_core;
  END IF;
  IF to_regprocedure('public.booking_engine_create_booking_live(text, date, date, jsonb, jsonb, text, jsonb, jsonb, text, text, text)') IS NULL THEN
    ALTER FUNCTION public.booking_engine_create_booking(text, date, date, jsonb, jsonb, text, jsonb, jsonb, text, text, text)
      RENAME TO booking_engine_create_booking_live;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.booking_engine_public_config(p_public_id text, p_preview boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v jsonb := public.booking_engine_public_config_full(p_public_id);
  v_on boolean;
BEGIN
  IF v IS NULL THEN RETURN NULL; END IF;
  v_on := COALESCE((v -> 'engine' ->> 'enabled')::boolean, false);
  IF v_on OR COALESCE(p_preview, false) THEN
    RETURN v || jsonb_build_object('preview', NOT v_on AND COALESCE(p_preview, false));
  END IF;
  -- Switched off: enough for a branded "not available, contact the hotel" page.
  RETURN jsonb_build_object(
    'engine', jsonb_build_object(
      'id', v -> 'engine' -> 'id', 'enabled', false, 'name', v -> 'engine' -> 'name',
      'logo_url', v -> 'engine' -> 'logo_url', 'theme', v -> 'engine' -> 'theme',
      'languages', v -> 'engine' -> 'languages', 'default_language', v -> 'engine' -> 'default_language',
      'contact', v -> 'engine' -> 'contact', 'today', v -> 'engine' -> 'today'),
    'room_types', '[]'::jsonb,
    'preview', false);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.booking_engine_calendar(p_public_id text, p_from date, p_to date, p_preview boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF NOT COALESCE(p_preview, false)
     AND NOT EXISTS (SELECT 1 FROM public.booking_engines WHERE public_id = p_public_id AND enabled) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ENGINE_UNAVAILABLE');
  END IF;
  RETURN public.booking_engine_calendar_core(p_public_id, p_from, p_to);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.booking_engine_search(p_public_id text, p_check_in date, p_check_out date, p_preview boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF NOT COALESCE(p_preview, false)
     AND NOT EXISTS (SELECT 1 FROM public.booking_engines WHERE public_id = p_public_id AND enabled) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ENGINE_UNAVAILABLE');
  END IF;
  RETURN public.booking_engine_search_core(p_public_id, p_check_in, p_check_out);
END;
$fn$;

-- Live booking unchanged. A preview runs the very same booking inside a
-- sub-transaction (with the engine switched on only there) and rolls it
-- back: same checks, same price, nothing stored, no Channex message.
CREATE OR REPLACE FUNCTION public.booking_engine_create_booking(
  p_public_id text, p_check_in date, p_check_out date, p_rooms jsonb, p_guest jsonb, p_language text,
  p_consent jsonb, p_attribution jsonb, p_token_hash text, p_ip_hash text, p_user_agent text,
  p_preview boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_result jsonb;
  v_detail text;
BEGIN
  IF NOT COALESCE(p_preview, false) THEN
    RETURN public.booking_engine_create_booking_live(p_public_id, p_check_in, p_check_out, p_rooms, p_guest, p_language,
      p_consent, p_attribution, p_token_hash, p_ip_hash, p_user_agent);
  END IF;
  BEGIN
    UPDATE public.booking_engines SET enabled = true WHERE public_id = p_public_id;
    v_result := public.booking_engine_create_booking_live(p_public_id, p_check_in, p_check_out, p_rooms, p_guest, p_language,
      p_consent, p_attribution, p_token_hash, p_ip_hash, p_user_agent);
    RAISE EXCEPTION USING ERRCODE = 'P0420', MESSAGE = 'BOOKING_ENGINE_PREVIEW', DETAIL = v_result::text;
  EXCEPTION WHEN SQLSTATE 'P0420' THEN
    GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
    v_result := v_detail::jsonb;
  END;
  RETURN v_result || jsonb_build_object(
    'preview', true, 'booking_id', NULL,
    'reference', 'TEST-' || substr(COALESCE(v_result ->> 'reference', 'W0000000'), 2),
    'rooms', COALESCE((SELECT jsonb_agg(x - 'reservation_id' - 'reservation_number')
                         FROM jsonb_array_elements(v_result -> 'rooms') x), '[]'::jsonb));
END;
$fn$;

REVOKE ALL ON FUNCTION public.booking_engine_public_config(text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.booking_engine_calendar(text, date, date, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.booking_engine_search(text, date, date, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.booking_engine_create_booking(text, date, date, jsonb, jsonb, text, jsonb, jsonb, text, text, text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.booking_engine_public_config(text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.booking_engine_calendar(text, date, date, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.booking_engine_search(text, date, date, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.booking_engine_create_booking(text, date, date, jsonb, jsonb, text, jsonb, jsonb, text, text, text, boolean)
  TO service_role;

-- ---------------------------------------------------------------- 4. returning guests
-- Earlier stays of this person at this hotel (same e-mail on the guest
-- record, or the same name key the guest directory uses), and the
-- jacuzzi / sauna they used then. Server side only: the result goes into
-- the guest's own e-mail, never onto a public page.
CREATE OR REPLACE FUNCTION public.booking_engine_guest_history(
  p_hotel_id text, p_email text, p_first_name text, p_last_name text, p_exclude uuid[] DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_email text := NULLIF(lower(btrim(COALESCE(p_email, ''))), '');
  v_key text := public.pms_guest_name_key(COALESCE(p_first_name, '') || ' ' || COALESCE(p_last_name, ''));
  v_today date := (now() AT TIME ZONE 'Europe/Budapest')::date;
  v_ids uuid[];
  v_last date;
BEGIN
  SELECT array_agg(r.id), max(r.check_out_date) INTO v_ids, v_last
    FROM public.reservations r
    LEFT JOIN public.guests g ON g.id = r.guest_id
   WHERE r.hotel_id = p_hotel_id
     AND NOT (r.id = ANY (COALESCE(p_exclude, '{}')))
     AND r.status::text IN ('checked_out', 'checked_in', 'confirmed')
     AND r.check_out_date <= v_today
     AND r.pms_missing_since IS NULL
     AND ((v_email IS NOT NULL AND lower(g.email) = v_email)
          OR (v_key IS NOT NULL AND public.pms_reservation_guest_key(r.pms_guest_name, r.pms_contact_name) = v_key)
          OR (v_key IS NOT NULL AND public.pms_guest_name_key(g.first_name || ' ' || g.last_name) = v_key));
  RETURN jsonb_build_object(
    'previous_stays', COALESCE(cardinality(v_ids), 0),
    'last_stay_end', v_last,
    'wellness_kinds', COALESCE((
      SELECT jsonb_agg(DISTINCT k ORDER BY k) FROM (
        SELECT wr.kind AS k FROM public.insuite_wellness_bookings wb
          JOIN public.insuite_wellness_resources wr ON wr.id = wb.resource_id
         WHERE wb.reservation_id = ANY (COALESCE(v_ids, '{}')) AND wb.status IN ('booked', 'completed')
        UNION
        SELECT ib.kind FROM public.insuite_booking_requests ib
         WHERE ib.reservation_id = ANY (COALESCE(v_ids, '{}')) AND ib.status IN ('confirmed', 'completed')
           AND ib.kind IN ('jacuzzi', 'sauna')
      ) kinds), '[]'::jsonb));
END;
$fn$;
REVOKE ALL ON FUNCTION public.booking_engine_guest_history(text, text, text, text, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.booking_engine_guest_history(text, text, text, text, uuid[]) TO service_role;

-- ---------------------------------------------------------------- 3. reminders
-- Bookings due a pre-arrival e-mail today: arriving within the engine's
-- reminder window, booked before that window opened (a guest who books two
-- days ahead already has a fresh confirmation), not yet reminded.
CREATE OR REPLACE FUNCTION public.booking_engine_due_reminders(p_limit integer DEFAULT 200)
RETURNS SETOF public.booking_engine_bookings LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT b.*
    FROM public.booking_engine_bookings b
    JOIN public.booking_engines be ON be.id = b.engine_id
   WHERE be.reminder_days > 0
     AND b.status = 'confirmed'
     AND b.reminder_sent_at IS NULL
     AND b.check_in_date > (now() AT TIME ZONE 'Europe/Budapest')::date
     AND b.check_in_date <= (now() AT TIME ZONE 'Europe/Budapest')::date + be.reminder_days
     AND b.created_at < ((b.check_in_date - be.reminder_days)::timestamp AT TIME ZONE 'Europe/Budapest')
   ORDER BY b.check_in_date, b.created_at
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 200), 1), 500);
$fn$;
REVOKE ALL ON FUNCTION public.booking_engine_due_reminders(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.booking_engine_due_reminders(integer) TO service_role;

-- Machine secret for the daily job, generated here and kept in Vault; no
-- person ever sees it. Same pattern as the Channex worker.
DO $$
DECLARE v_exists boolean;
BEGIN
  IF to_regnamespace('vault') IS NULL THEN RETURN; END IF;
  EXECUTE 'SELECT EXISTS (SELECT 1 FROM vault.secrets WHERE name = $1)' INTO v_exists USING 'booking_engine_worker_secret';
  IF NOT v_exists THEN
    EXECUTE 'SELECT vault.create_secret($1, $2, $3)'
      USING replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
            'booking_engine_worker_secret', 'Authorises the booking-engine daily reminder job';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.booking_engine_worker_secret()
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v text;
BEGIN
  IF to_regnamespace('vault') IS NULL THEN RETURN NULL; END IF;
  EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = $1 LIMIT 1' INTO v USING 'booking_engine_worker_secret';
  RETURN v;
END;
$fn$;
REVOKE ALL ON FUNCTION public.booking_engine_worker_secret() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.booking_engine_worker_secret() TO service_role;

DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'booking-engine-reminders';
  -- 08:37 UTC = 09:37 / 10:37 in Budapest. Does nothing when no reminder is due.
  PERFORM cron.schedule('booking-engine-reminders', '37 8 * * *', $job$
    SELECT net.http_post(
      url := 'https://pcmszqqklkolvvlabohq.supabase.co/functions/v1/booking-engine',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-worker-secret', public.booking_engine_worker_secret()),
      body := jsonb_build_object('action', 'reminders'),
      timeout_milliseconds := 60000)
    WHERE EXISTS (SELECT 1 FROM public.booking_engine_due_reminders(1));
  $job$);
END $$;
