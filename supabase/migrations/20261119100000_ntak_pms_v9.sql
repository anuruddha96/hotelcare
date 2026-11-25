-- NTAK PMS interface v9 (Nemzeti Turisztikai Adatszolgáltató Központ, szállás modul).
--
-- Per-hotel settings, NTAK unit profiles, the stay guest list, stored guest
-- ids, one outbox for every message (daily closure, advance booking, stay
-- events, start-date query) with NTAK's processing ids and verification
-- results, the daily-closure register and the queues filled by triggers.
-- Certificates, private keys and the guest-id salt live in Vault, readable by
-- the ntak-pms edge function (service role) only.
--
-- Safety: every trigger on reservations swallows its own errors, so NTAK
-- bookkeeping can never block a front-desk action. Nothing is sent until a
-- hotel is enabled and configured in ntak_settings.

-- ---------------------------------------------------------------------------
-- 1. Settings

CREATE TABLE IF NOT EXISTS public.ntak_settings (
  hotel_id text PRIMARY KEY,
  organization_slug text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  environment text NOT NULL DEFAULT 'test' CHECK (environment IN ('test','production')),
  endpoint_url text CHECK (endpoint_url IS NULL OR endpoint_url ~ '^https://'),
  software_id text CHECK (software_id IS NULL OR software_id ~ '^[A-Za-z0-9]{1,15}$'),
  software_version text NOT NULL DEFAULT 'v1.0.0' CHECK (char_length(btrim(software_version)) BETWEEN 1 AND 10),
  registration_number text CHECK (registration_number IS NULL OR registration_number ~ '^[A-Z]{2}[0-9]{8}$'),
  provider_tax_number text CHECK (provider_tax_number IS NULL OR provider_tax_number ~ '^[0-9]{8}-[0-9]-[0-9]{2}$'),
  data_reporting_id text CHECK (data_reporting_id IS NULL OR data_reporting_id ~ '^[A-Za-z0-9]{8}$'),
  registered_room_count integer CHECK (registered_room_count IS NULL OR registered_room_count BETWEEN 1 AND 1000),
  registered_bed_count integer CHECK (registered_bed_count IS NULL OR registered_bed_count >= 0),
  accommodation_class text NOT NULL DEFAULT 'hotel_4' CHECK (accommodation_class IN
    ('hotel_5','hotel_4','hotel_3','hotel_2','hotel_1','hotel_unrated','guesthouse','camping','community','holiday_home','other','private','holiday_boat')),
  region text NOT NULL DEFAULT 'budapest' CHECK (region IN ('budapest','countryside')),
  ifa_type text NOT NULL DEFAULT 'SZAZALEKOS' CHECK (ifa_type IN ('SZAZALEKOS','TETELES','NINCS')),
  ifa_rate numeric(12,2) NOT NULL DEFAULT 4 CHECK (ifa_rate >= 0),
  ifa_vat integer NOT NULL DEFAULT 0 CHECK (ifa_vat IN (0,5,18,27)),
  -- Szálláshely-szolgáltatás is in the 5 % VAT band (NAV); confirm per hotel.
  accommodation_vat integer NOT NULL DEFAULT 5 CHECK (accommodation_vat IN (0,5,18,27)),
  signature_profile text NOT NULL DEFAULT 'rsa-sha384' CHECK (signature_profile IN ('rsa-sha384','rsa-sha256','rsa-sha512')),
  unknown_country_code text NOT NULL DEFAULT 'EGYEBKULFOLDI' CHECK (unknown_country_code IN ('EGYEBKULFOLDI','EGYEB')),
  closure_mode text NOT NULL DEFAULT 'manual' CHECK (closure_mode IN ('manual','auto')),
  auto_close_time time NOT NULL DEFAULT '05:00',
  -- First day HotelCare reports; earlier days belong to the previous PMS.
  first_closure_date date,
  -- Days on/before this date were closed by the previous PMS: resend as MODOSITO (9.2.20).
  software_change_date date,
  -- Answer of adatszolgaltatasKezdoDatum (7.3.3).
  data_start_date date,
  data_start_checked_at timestamptz,
  -- Category / payment / channel maps, package components, FX rates (ledger.ts LedgerConfig overrides).
  ledger_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Certificate metadata (PEMs are in Vault).
  cert_subject jsonb,
  cert_serial text,
  cert_not_after timestamptz,
  cert_uploaded_at timestamptz,
  pending_csr_pem text,
  pending_csr_created_at timestamptz,
  pending_spki_sha256 text,
  -- Set on certificate/registration errors; sending stops until cleared (6.1.4).
  sending_blocked_reason text,
  initial_booking_sync_started_at timestamptz,
  initial_booking_sync_done_at timestamptz,
  last_ok_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 2. NTAK unit profiles (LakoegysegType) and room-type defaults for bookings

CREATE TABLE IF NOT EXISTS public.ntak_unit_profiles (
  room_id uuid PRIMARY KEY REFERENCES public.rooms(id) ON DELETE CASCADE,
  hotel_id text NOT NULL,
  building text NOT NULL DEFAULT '1' CHECK (char_length(btrim(building)) BETWEEN 1 AND 50),
  room_number text NOT NULL CHECK (char_length(btrim(room_number)) BETWEEN 1 AND 50),
  unit_type text NOT NULL DEFAULT 'STANDARD' CHECK (unit_type IN
    ('ECONOMY','STANDARD','SUPERIOR','JUNIOR_SUITE','SUITE','MOBILHAZ','UDULOHAZ','PARCELLA','SATORHELY_KEMPINGHELY',
     'EGYEDI','PRIVAT_SZOBA_KOZOS_FURDOVEL','PRIVAT_SZOBA_SAJAT_FURDOVEL','HALOTERMI_AGY','APARTMAN','EGYEB')),
  single_beds integer NOT NULL DEFAULT 0 CHECK (single_beds BETWEEN 0 AND 1000),
  double_beds integer NOT NULL DEFAULT 1 CHECK (double_beds BETWEEN 0 AND 1000),
  extra_beds integer NOT NULL DEFAULT 0 CHECK (extra_beds BETWEEN 0 AND 10000),
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ntak_unit_profiles_hotel ON public.ntak_unit_profiles(hotel_id) WHERE active;

CREATE TABLE IF NOT EXISTS public.ntak_room_type_units (
  room_type_id uuid PRIMARY KEY REFERENCES public.room_types(id) ON DELETE CASCADE,
  hotel_id text NOT NULL,
  unit_type text NOT NULL DEFAULT 'STANDARD' CHECK (unit_type IN
    ('ECONOMY','STANDARD','SUPERIOR','JUNIOR_SUITE','SUITE','MOBILHAZ','UDULOHAZ','PARCELLA','SATORHELY_KEMPINGHELY',
     'EGYEDI','PRIVAT_SZOBA_KOZOS_FURDOVEL','PRIVAT_SZOBA_SAJAT_FURDOVEL','HALOTERMI_AGY','APARTMAN','EGYEB')),
  capacity integer NOT NULL DEFAULT 2 CHECK (capacity BETWEEN 1 AND 99),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 3. Guests of a stay (NTAK and VIZA report every guest, not only the booker)

CREATE TABLE IF NOT EXISTS public.reservation_guests (
  reservation_id uuid NOT NULL REFERENCES public.reservations(id) ON DELETE CASCADE,
  guest_id uuid NOT NULL REFERENCES public.guests(id) ON DELETE CASCADE,
  is_primary boolean NOT NULL DEFAULT false,
  -- Tourism-tax status override for this stay (KOTELES or an imN exemption); NULL = automatic.
  ifa_status text CHECK (ifa_status IS NULL OR ifa_status ~ '^(KOTELES|im[1-9][0-9]*)$'),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (reservation_id, guest_id)
);
CREATE INDEX IF NOT EXISTS reservation_guests_guest ON public.reservation_guests(guest_id);

-- The booker is always a stay guest.
CREATE OR REPLACE FUNCTION public.reservation_guests_sync_primary()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  changed boolean := true;
BEGIN
  BEGIN
    IF TG_OP = 'UPDATE' THEN changed := NEW.guest_id IS DISTINCT FROM OLD.guest_id; END IF;
    IF NEW.guest_id IS NOT NULL AND changed THEN
      UPDATE public.reservation_guests SET is_primary = false WHERE reservation_id = NEW.id AND guest_id <> NEW.guest_id AND is_primary;
      INSERT INTO public.reservation_guests (reservation_id, guest_id, is_primary)
      VALUES (NEW.id, NEW.guest_id, true)
      ON CONFLICT (reservation_id, guest_id) DO UPDATE SET is_primary = true;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'reservation_guests_sync_primary: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.reservation_guests_sync_primary() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS reservation_guests_sync_primary ON public.reservations;
CREATE TRIGGER reservation_guests_sync_primary
AFTER INSERT OR UPDATE OF guest_id ON public.reservations
FOR EACH ROW EXECUTE FUNCTION public.reservation_guests_sync_primary();

-- Backfill the 15-month correction window plus future stays.
INSERT INTO public.reservation_guests (reservation_id, guest_id, is_primary)
SELECT r.id, r.guest_id, true
FROM public.reservations r
WHERE r.guest_id IS NOT NULL AND r.check_out_date >= current_date - 460
ON CONFLICT (reservation_id, guest_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. Guest ids: generated once at the first report, then reused (9.1.3)

CREATE TABLE IF NOT EXISTS public.ntak_guest_ids (
  hotel_id text NOT NULL,
  guest_id uuid NOT NULL REFERENCES public.guests(id) ON DELETE CASCADE,
  vendeg_id text NOT NULL CHECK (char_length(vendeg_id) = 31),
  first_used_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hotel_id, guest_id)
);

-- ---------------------------------------------------------------------------
-- 5. Outbox: every message sent to NTAK and what NTAK answered

CREATE TABLE IF NOT EXISTS public.ntak_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL,
  organization_slug text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('test','production')),
  kind text NOT NULL CHECK (kind IN ('closure','booking','event','start_date')),
  ref text NOT NULL,
  uzenet_id uuid,
  request_xml text,
  state text NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued','sending','retry','accepted','rejected','failed','verified','blocked','superseded')),
  ntak_status text CHECK (ntak_status IS NULL OR ntak_status IN ('BEFOGADVA','TELJESEN_SIKERES','VIZSGALANDO','TELJESEN_HIBAS','UJRA_KULDENDO')),
  processing_id uuid,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_http_status integer,
  last_error text,
  expected_start_date date,
  verify_attempts integer NOT NULL DEFAULT 0,
  next_verify_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  verified_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ntak_messages_due ON public.ntak_messages(hotel_id, next_attempt_at) WHERE state IN ('queued','retry');
CREATE INDEX IF NOT EXISTS ntak_messages_verify ON public.ntak_messages(hotel_id, next_verify_at) WHERE state = 'accepted';
CREATE INDEX IF NOT EXISTS ntak_messages_ref ON public.ntak_messages(hotel_id, kind, ref, created_at DESC);
CREATE INDEX IF NOT EXISTS ntak_messages_hour ON public.ntak_messages(hotel_id, sent_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS ntak_messages_uzenet ON public.ntak_messages(uzenet_id) WHERE uzenet_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 6. Daily closure register (one per hotel and day; versions live in ntak_messages)

CREATE TABLE IF NOT EXISTS public.ntak_daily_closures (
  hotel_id text NOT NULL,
  closed_day date NOT NULL,
  organization_slug text NOT NULL,
  state text NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued','sent','accepted','warnings','errors','resend_required','failed','blocked')),
  classification text NOT NULL CHECK (classification IN ('UJ','MODOSITO')),
  protocol_id text CHECK (protocol_id IS NULL OR char_length(protocol_id) <= 25),
  reason text CHECK (reason IS NULL OR char_length(reason) <= 100),
  closed_by uuid,
  closed_at timestamptz NOT NULL DEFAULT now(),
  snapshot jsonb NOT NULL,
  snapshot_hash text NOT NULL,
  message_id uuid REFERENCES public.ntak_messages(id) ON DELETE SET NULL,
  -- NTAK accepted a version of this day: every later version must be MODOSITO.
  accepted_once boolean NOT NULL DEFAULT false,
  -- Source data changed after the day was sent: a correction is due.
  needs_correction boolean NOT NULL DEFAULT false,
  correction_detected_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hotel_id, closed_day)
);

-- ---------------------------------------------------------------------------
-- 7. Queues filled from reservations

CREATE OR REPLACE FUNCTION public.ntak_booking_no(_channex_booking_id text, _pms_reservation_id text, _reservation_number text, _id uuid)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  -- Must match bookingNumber() in supabase/functions/_shared/ntak/ledger.ts (9.1.10).
  SELECT left(COALESCE(NULLIF(_channex_booking_id, ''), NULLIF(_pms_reservation_id, ''), NULLIF(_reservation_number, ''), _id::text), 255)
$$;

CREATE TABLE IF NOT EXISTS public.ntak_booking_queue (
  hotel_id text NOT NULL,
  booking_no text NOT NULL,
  dirty_at timestamptz NOT NULL DEFAULT now(),
  last_payload_hash text,
  last_sent_at timestamptz,
  last_message_id uuid REFERENCES public.ntak_messages(id) ON DELETE SET NULL,
  last_problem text,
  cancelled_sent boolean NOT NULL DEFAULT false,
  PRIMARY KEY (hotel_id, booking_no)
);
CREATE INDEX IF NOT EXISTS ntak_booking_queue_dirty ON public.ntak_booking_queue(hotel_id, dirty_at)
  WHERE last_sent_at IS NULL OR dirty_at > last_sent_at;

CREATE TABLE IF NOT EXISTS public.ntak_event_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL,
  organization_slug text,
  reservation_id uuid NOT NULL REFERENCES public.reservations(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('erkezett','tavozott','lakoegysegetCserelt')),
  -- clock_timestamp: several events in one transaction keep their real order.
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  room_id uuid,
  from_room_id uuid,
  is_correction boolean NOT NULL DEFAULT false,
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','waiting_data','sent','failed','skipped')),
  message_id uuid REFERENCES public.ntak_messages(id) ON DELETE SET NULL,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ntak_event_queue_pending ON public.ntak_event_queue(hotel_id, occurred_at) WHERE state IN ('queued','waiting_data');

CREATE OR REPLACE FUNCTION public.ntak_on_reservation_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cfg public.ntak_settings%ROWTYPE;
  old_status text;
  new_status text := NEW.status::text;
  booking_changed boolean := true;
BEGIN
  BEGIN
    SELECT * INTO cfg FROM public.ntak_settings WHERE hotel_id = NEW.hotel_id AND enabled;
    IF NOT FOUND THEN RETURN NEW; END IF;

    IF TG_OP = 'UPDATE' THEN
      old_status := OLD.status::text;
      booking_changed := NEW.status IS DISTINCT FROM OLD.status OR NEW.check_in_date IS DISTINCT FROM OLD.check_in_date
        OR NEW.check_out_date IS DISTINCT FROM OLD.check_out_date OR NEW.room_id IS DISTINCT FROM OLD.room_id
        OR NEW.room_type_id IS DISTINCT FROM OLD.room_type_id OR NEW.adults IS DISTINCT FROM OLD.adults
        OR NEW.children IS DISTINCT FROM OLD.children OR NEW.total_amount IS DISTINCT FROM OLD.total_amount
        OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.guest_id IS DISTINCT FROM OLD.guest_id
        OR NEW.source IS DISTINCT FROM OLD.source OR NEW.ota_name IS DISTINCT FROM OLD.ota_name;
    END IF;

    -- Advance bookings: anything relevant to a booking that has not ended yet.
    IF NEW.check_out_date >= current_date AND booking_changed THEN
      INSERT INTO public.ntak_booking_queue (hotel_id, booking_no, dirty_at)
      VALUES (NEW.hotel_id, public.ntak_booking_no(NEW.channex_booking_id::text, NEW.pms_reservation_id::text, NEW.reservation_number, NEW.id), now())
      ON CONFLICT (hotel_id, booking_no) DO UPDATE SET dirty_at = now();
    END IF;

    IF TG_OP = 'UPDATE' THEN
      -- Stay events (7.4); wrong events are corrected with the opposite event.
      IF new_status = 'checked_in' AND old_status IS DISTINCT FROM 'checked_in' THEN
        INSERT INTO public.ntak_event_queue (hotel_id, organization_slug, reservation_id, kind, room_id, is_correction)
        VALUES (NEW.hotel_id, cfg.organization_slug, NEW.id, 'erkezett', NEW.room_id, old_status = 'checked_out');
      ELSIF new_status = 'checked_out' AND old_status = 'checked_in' THEN
        INSERT INTO public.ntak_event_queue (hotel_id, organization_slug, reservation_id, kind, room_id)
        VALUES (NEW.hotel_id, cfg.organization_slug, NEW.id, 'tavozott', NEW.room_id);
      ELSIF old_status = 'checked_in' AND new_status IN ('confirmed','pending','no_show','cancelled') THEN
        INSERT INTO public.ntak_event_queue (hotel_id, organization_slug, reservation_id, kind, room_id, is_correction)
        VALUES (NEW.hotel_id, cfg.organization_slug, NEW.id, 'tavozott', COALESCE(OLD.room_id, NEW.room_id), true);
      ELSIF new_status = 'checked_in' AND NEW.room_id IS DISTINCT FROM OLD.room_id AND OLD.room_id IS NOT NULL AND NEW.room_id IS NOT NULL THEN
        INSERT INTO public.ntak_event_queue (hotel_id, organization_slug, reservation_id, kind, room_id, from_room_id)
        VALUES (NEW.hotel_id, cfg.organization_slug, NEW.id, 'lakoegysegetCserelt', NEW.room_id, OLD.room_id);
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'ntak_on_reservation_change: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.ntak_on_reservation_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS ntak_on_reservation_change ON public.reservations;
CREATE TRIGGER ntak_on_reservation_change
AFTER INSERT OR UPDATE ON public.reservations
FOR EACH ROW EXECUTE FUNCTION public.ntak_on_reservation_change();

-- ---------------------------------------------------------------------------
-- 8. Secrets (Vault): universal certificate, its private key, pending CSR key, guest-id salt

CREATE OR REPLACE FUNCTION public.ntak_secret_name(_hotel_id text, _kind text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'ntak_' || _kind || '_' || md5(_hotel_id) $$;

CREATE OR REPLACE FUNCTION public.ntak_put_secret(_hotel_id text, _kind text, _value text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault AS $$
DECLARE
  secret_name text := public.ntak_secret_name(_hotel_id, _kind);
  existing uuid;
BEGIN
  IF _kind NOT IN ('cert','key','pending_key','salt') THEN RAISE EXCEPTION 'NTAK_SECRET_KIND'; END IF;
  SELECT id INTO existing FROM vault.decrypted_secrets WHERE name = secret_name LIMIT 1;
  IF existing IS NULL THEN
    PERFORM vault.create_secret(_value, secret_name, 'NTAK ' || _kind || ' for hotel ' || _hotel_id);
  ELSE
    PERFORM vault.update_secret(existing, _value);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.ntak_get_secret(_hotel_id text, _kind text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, vault AS $$
  SELECT NULLIF(decrypted_secret, '') FROM vault.decrypted_secrets WHERE name = public.ntak_secret_name(_hotel_id, _kind) LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.ntak_put_secret(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ntak_get_secret(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ntak_put_secret(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.ntak_get_secret(text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 9. Row-level security: staff read; writes go through the ntak-pms function

ALTER TABLE public.ntak_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ntak_unit_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ntak_room_type_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservation_guests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ntak_guest_ids ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ntak_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ntak_daily_closures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ntak_booking_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ntak_event_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "PMS staff view NTAK settings" ON public.ntak_settings;
CREATE POLICY "PMS staff view NTAK settings" ON public.ntak_settings FOR SELECT TO authenticated
USING (public.user_can_access_hotel(auth.uid(), hotel_id) AND public.has_pms_access(auth.uid()));

DROP POLICY IF EXISTS "PMS staff view NTAK units" ON public.ntak_unit_profiles;
CREATE POLICY "PMS staff view NTAK units" ON public.ntak_unit_profiles FOR SELECT TO authenticated
USING (public.user_can_access_hotel(auth.uid(), hotel_id) AND public.has_pms_access(auth.uid()));

DROP POLICY IF EXISTS "PMS staff view NTAK room types" ON public.ntak_room_type_units;
CREATE POLICY "PMS staff view NTAK room types" ON public.ntak_room_type_units FOR SELECT TO authenticated
USING (public.user_can_access_hotel(auth.uid(), hotel_id) AND public.has_pms_access(auth.uid()));

DROP POLICY IF EXISTS "PMS staff view NTAK messages" ON public.ntak_messages;
CREATE POLICY "PMS staff view NTAK messages" ON public.ntak_messages FOR SELECT TO authenticated
USING (public.user_can_access_hotel(auth.uid(), hotel_id) AND public.has_pms_access(auth.uid()));

DROP POLICY IF EXISTS "PMS staff view NTAK closures" ON public.ntak_daily_closures;
CREATE POLICY "PMS staff view NTAK closures" ON public.ntak_daily_closures FOR SELECT TO authenticated
USING (public.user_can_access_hotel(auth.uid(), hotel_id) AND public.has_pms_access(auth.uid()));

DROP POLICY IF EXISTS "PMS staff view NTAK booking queue" ON public.ntak_booking_queue;
CREATE POLICY "PMS staff view NTAK booking queue" ON public.ntak_booking_queue FOR SELECT TO authenticated
USING (public.user_can_access_hotel(auth.uid(), hotel_id) AND public.has_pms_access(auth.uid()));

DROP POLICY IF EXISTS "PMS staff view NTAK events" ON public.ntak_event_queue;
CREATE POLICY "PMS staff view NTAK events" ON public.ntak_event_queue FOR SELECT TO authenticated
USING (public.user_can_access_hotel(auth.uid(), hotel_id) AND public.has_pms_access(auth.uid()));

-- Guest ids are pseudonymous but stay server-side (no client policy).

-- The front desk records companions on the stay.
DROP POLICY IF EXISTS "PMS staff manage stay guests" ON public.reservation_guests;
CREATE POLICY "PMS staff manage stay guests" ON public.reservation_guests FOR ALL TO authenticated
USING (public.has_pms_access(auth.uid()) AND public.can_access_reservation(auth.uid(), reservation_id))
WITH CHECK (public.has_pms_access(auth.uid()) AND public.can_access_reservation(auth.uid(), reservation_id));

GRANT SELECT ON public.ntak_settings, public.ntak_unit_profiles, public.ntak_room_type_units, public.ntak_messages,
  public.ntak_daily_closures, public.ntak_booking_queue, public.ntak_event_queue TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reservation_guests TO authenticated;

-- ---------------------------------------------------------------------------
-- 10. Schedule: worker every 5 minutes, only while a hotel is enabled

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ntak-pms-worker-5min') THEN
      PERFORM cron.unschedule('ntak-pms-worker-5min');
    END IF;
    PERFORM cron.schedule('ntak-pms-worker-5min', '2-59/5 * * * *', $cron$
      SELECT net.http_post(
        url := 'https://pcmszqqklkolvvlabohq.supabase.co/functions/v1/ntak-pms',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-worker-secret', public.get_channex_worker_secret()),
        body := jsonb_build_object('action', 'worker'),
        timeout_milliseconds := 150000
      )
      WHERE EXISTS (SELECT 1 FROM public.ntak_settings WHERE enabled);
    $cron$);
  END IF;
END $$;
