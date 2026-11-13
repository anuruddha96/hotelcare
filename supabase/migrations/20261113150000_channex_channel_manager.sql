-- HotelCare × Channex channel manager — foundation (staging first).
--
-- What this adds
--   * channex_connections      one row per hotel: environment, mode, Hungarian compliance gate
--   * channex_mappings         HotelCare room type -> Channex room type / rate plan UUIDs
--   * channex_availability_dirty / channex_rate_changes   debounced ARI change signals
--   * channex_ari_outbox       batched availability / restriction messages + provider task ids
--   * channex_booking_revisions  durable inbox of OTA booking revisions (webhook + feed)
--   * channex_review_cases     OTA modifications / conflicts that need a person
--   * channex_audit_log        who changed what
--   * reservations.channex_*   link a HotelCare reservation to its OTA booking
--
-- Safe by default
--   * Every hotel starts at mode 'off'. Nothing is sent or ingested.
--   * Staging + live is only allowed for a hotel flagged is_sandbox_hotel, so a staging test
--     booking can never land in a real hotel's calendar.
--   * Production + live is blocked BY THE DATABASE until the Hungarian compliance checklist,
--     Channex certification and owner approval are recorded (constraint channex_production_live_gate).
--   * kill_switch stops every outbound ARI push immediately. Incoming OTA bookings keep flowing
--     (a guest with an OTA confirmation exists whether or not we publish).
--   * Only service-role edge functions write these tables. Staff can read their own hotel's rows.
--   * Card data is never stored (stripped in the edge function before insert). Guest PII inside
--     raw revision payloads is purged 90 days after departure.

-- ------------------------------------------------------------
-- 1. Connection per hotel
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.channex_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL UNIQUE,
  organization_slug text NOT NULL,
  environment text NOT NULL DEFAULT 'staging' CHECK (environment IN ('staging', 'production')),
  mode text NOT NULL DEFAULT 'off' CHECK (mode IN ('off', 'dry_run', 'live')),
  kill_switch boolean NOT NULL DEFAULT false,
  is_sandbox_hotel boolean NOT NULL DEFAULT false,
  channex_property_id uuid UNIQUE,
  channex_group_id uuid,
  channex_webhook_id uuid,
  currency text NOT NULL DEFAULT 'EUR' CHECK (currency ~ '^[A-Z]{3}$'),
  timezone text NOT NULL DEFAULT 'Europe/Budapest',
  primary_occupancy integer NOT NULL DEFAULT 2 CHECK (primary_occupancy BETWEEN 1 AND 20),

  -- Hungarian compliance gate. All must be satisfied before production + live.
  -- NTAK: OTA bookings must reach the hotel's registered szálláshelykezelő szoftver, which reports them.
  ntak_reporting_path text NOT NULL DEFAULT 'unconfirmed'
    CHECK (ntak_reporting_path IN ('unconfirmed', 'hotelcare_registered', 'previo_receives_bookings', 'other_registered_software')),
  -- VIZA: guest ID data comes from the document reader at check-in, never from the OTA.
  viza_document_scan_confirmed boolean NOT NULL DEFAULT false,
  -- 5% accommodation VAT, idegenforgalmi adó and turizmusfejlesztési hozzájárulás handled in invoicing.
  tax_settings_confirmed boolean NOT NULL DEFAULT false,
  -- GDPR Art. 28 data processing agreement with Channex signed.
  dpa_signed boolean NOT NULL DEFAULT false,
  -- Only one system publishes inventory to the OTAs (Previo/YieldPlanet channel connection switched off).
  single_publisher_confirmed boolean NOT NULL DEFAULT false,
  certified_at timestamptz,
  owner_approved_by uuid,
  owner_approved_at timestamptz,

  last_feed_poll_at timestamptz,
  last_feed_ok_at timestamptz,
  last_ari_push_at timestamptz,
  last_error text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT channex_staging_live_sandbox_only CHECK (
    NOT (environment = 'staging' AND mode = 'live') OR is_sandbox_hotel
  ),
  CONSTRAINT channex_production_live_gate CHECK (
    NOT (environment = 'production' AND mode = 'live') OR (
      ntak_reporting_path <> 'unconfirmed'
      AND viza_document_scan_confirmed
      AND tax_settings_confirmed
      AND dpa_signed
      AND single_publisher_confirmed
      AND certified_at IS NOT NULL
      AND owner_approved_at IS NOT NULL
      AND NOT is_sandbox_hotel
    )
  )
);

COMMENT ON TABLE public.channex_connections IS
  'Channex channel manager connection per hotel. mode off|dry_run|live; production live is gated by the Hungarian compliance checklist (see constraint channex_production_live_gate).';

-- ------------------------------------------------------------
-- 2. ID mapping (one Channex rate plan per HotelCare room type to start)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.channex_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL REFERENCES public.channex_connections(hotel_id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('room_type', 'rate_plan')),
  local_id uuid NOT NULL,
  channex_id uuid NOT NULL,
  channex_title text,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, kind, local_id),
  UNIQUE (kind, channex_id)
);

-- ------------------------------------------------------------
-- 3. Change signals (debounced by the ARI worker)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.channex_availability_dirty (
  id bigserial PRIMARY KEY,
  hotel_id text NOT NULL,
  date_from date NOT NULL,
  date_to date NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  CHECK (date_to >= date_from)
);
CREATE INDEX IF NOT EXISTS channex_availability_dirty_open_idx
  ON public.channex_availability_dirty (hotel_id, created_at) WHERE processed_at IS NULL;

CREATE TABLE IF NOT EXISTS public.channex_rate_changes (
  id bigserial PRIMARY KEY,
  hotel_id text NOT NULL,
  room_type_id uuid NOT NULL,
  stay_date date NOT NULL,
  currency text NOT NULL,
  -- Only the fields that changed: {"rate":"123.40"} or {"min_stay_arrival":2} ... Major-unit decimal strings.
  patch jsonb NOT NULL,
  source text NOT NULL,
  source_ref uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  skipped_reason text
);
CREATE INDEX IF NOT EXISTS channex_rate_changes_open_idx
  ON public.channex_rate_changes (hotel_id, created_at) WHERE processed_at IS NULL;

-- ------------------------------------------------------------
-- 4. Outbound ARI messages
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.channex_ari_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('availability', 'restrictions')),
  mode text NOT NULL CHECK (mode IN ('dry_run', 'live')),
  environment text NOT NULL CHECK (environment IN ('staging', 'production')),
  is_full_sync boolean NOT NULL DEFAULT false,
  values jsonb NOT NULL,
  value_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent', 'sent_with_warnings', 'dry_run', 'failed', 'blocked')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  task_ids jsonb,
  warnings jsonb,
  readback jsonb,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS channex_ari_outbox_due_idx
  ON public.channex_ari_outbox (hotel_id, next_attempt_at) WHERE status = 'pending';

-- ------------------------------------------------------------
-- 5. Inbound booking revisions (durable before ACK)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.channex_booking_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revision_id text NOT NULL UNIQUE,
  channex_booking_id text,
  channex_property_id text,
  hotel_id text,
  environment text NOT NULL CHECK (environment IN ('staging', 'production')),
  revision_status text CHECK (revision_status IN ('new', 'modified', 'cancelled')),
  ota_name text,
  ota_reservation_code text,
  arrival_date date,
  departure_date date,
  payload jsonb,
  received_via text NOT NULL CHECK (received_via IN ('webhook', 'feed', 'recovery')),
  state text NOT NULL DEFAULT 'received'
    CHECK (state IN ('received', 'applied', 'review', 'unknown_property', 'dry_run', 'failed')),
  reservation_ids uuid[] NOT NULL DEFAULT '{}',
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  acked_at timestamptz,
  ack_error text,
  pii_purged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS channex_booking_revisions_unacked_idx
  ON public.channex_booking_revisions (created_at) WHERE acked_at IS NULL;
CREATE INDEX IF NOT EXISTS channex_booking_revisions_hotel_idx
  ON public.channex_booking_revisions (hotel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS channex_booking_revisions_booking_idx
  ON public.channex_booking_revisions (channex_booking_id);

CREATE TABLE IF NOT EXISTS public.channex_review_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL,
  revision_row_id uuid NOT NULL UNIQUE REFERENCES public.channex_booking_revisions(id) ON DELETE CASCADE,
  reservation_ids uuid[] NOT NULL DEFAULT '{}',
  reason text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  resolution_note text,
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS channex_review_cases_open_idx
  ON public.channex_review_cases (hotel_id, created_at) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS public.channex_audit_log (
  id bigserial PRIMARY KEY,
  hotel_id text,
  actor uuid,
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS channex_audit_log_hotel_idx ON public.channex_audit_log (hotel_id, created_at DESC);

-- ------------------------------------------------------------
-- 6. Reservation link to the OTA booking
-- ------------------------------------------------------------
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS channex_booking_id text,
  ADD COLUMN IF NOT EXISTS channex_room_index integer,
  ADD COLUMN IF NOT EXISTS ota_name text,
  ADD COLUMN IF NOT EXISTS ota_reservation_code text,
  ADD COLUMN IF NOT EXISTS payment_collect text,
  ADD COLUMN IF NOT EXISTS ota_taxes jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS reservations_channex_booking_room_uidx
  ON public.reservations (channex_booking_id, channex_room_index)
  WHERE channex_booking_id IS NOT NULL;

COMMENT ON COLUMN public.reservations.ota_taxes IS
  'Taxes/fees as reported by the OTA (e.g. whether city tax is included). Informational: HotelCare invoicing remains the source for VAT, IFA and TFH.';

-- ------------------------------------------------------------
-- 7. Row level security: read own hotel, write via service role only
-- ------------------------------------------------------------
ALTER TABLE public.channex_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channex_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channex_availability_dirty ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channex_rate_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channex_ari_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channex_booking_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channex_review_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channex_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read Channex connection of own hotel" ON public.channex_connections;
CREATE POLICY "Read Channex connection of own hotel" ON public.channex_connections
  FOR SELECT TO authenticated USING (public.user_can_access_hotel(auth.uid(), hotel_id));

DROP POLICY IF EXISTS "Read Channex mappings of own hotel" ON public.channex_mappings;
CREATE POLICY "Read Channex mappings of own hotel" ON public.channex_mappings
  FOR SELECT TO authenticated USING (public.user_can_access_hotel(auth.uid(), hotel_id));

DROP POLICY IF EXISTS "Read Channex outbox of own hotel" ON public.channex_ari_outbox;
CREATE POLICY "Read Channex outbox of own hotel" ON public.channex_ari_outbox
  FOR SELECT TO authenticated USING (public.user_can_access_hotel(auth.uid(), hotel_id));

-- Revisions contain guest data: PMS roles of the same hotel only.
DROP POLICY IF EXISTS "PMS staff read Channex revisions of own hotel" ON public.channex_booking_revisions;
CREATE POLICY "PMS staff read Channex revisions of own hotel" ON public.channex_booking_revisions
  FOR SELECT TO authenticated
  USING (hotel_id IS NOT NULL AND public.has_pms_access(auth.uid()) AND public.user_can_access_hotel(auth.uid(), hotel_id));

DROP POLICY IF EXISTS "PMS staff read Channex review cases of own hotel" ON public.channex_review_cases;
CREATE POLICY "PMS staff read Channex review cases of own hotel" ON public.channex_review_cases
  FOR SELECT TO authenticated
  USING (public.has_pms_access(auth.uid()) AND public.user_can_access_hotel(auth.uid(), hotel_id));

DROP POLICY IF EXISTS "Read Channex audit of own hotel" ON public.channex_audit_log;
CREATE POLICY "Read Channex audit of own hotel" ON public.channex_audit_log
  FOR SELECT TO authenticated
  USING (hotel_id IS NOT NULL AND public.user_can_access_hotel(auth.uid(), hotel_id));

-- No INSERT/UPDATE/DELETE policies: only service-role edge functions write.
REVOKE INSERT, UPDATE, DELETE ON public.channex_connections, public.channex_mappings,
  public.channex_availability_dirty, public.channex_rate_changes, public.channex_ari_outbox,
  public.channex_booking_revisions, public.channex_review_cases, public.channex_audit_log
  FROM anon, authenticated;
REVOKE ALL ON public.channex_availability_dirty, public.channex_rate_changes FROM anon, authenticated;

-- ------------------------------------------------------------
-- 8. Change signals from HotelCare
-- ------------------------------------------------------------

-- Any booking change for a connected hotel marks its stay dates dirty (availability only).
CREATE OR REPLACE FUNCTION public.channex_mark_availability_dirty()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hotel text := COALESCE(NEW.hotel_id, OLD.hotel_id);
  v_from date;
  v_to date;
BEGIN
  IF v_hotel IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.channex_connections c WHERE c.hotel_id = v_hotel AND c.mode <> 'off'
  ) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.check_in_date IS NOT DISTINCT FROM OLD.check_in_date
     AND NEW.check_out_date IS NOT DISTINCT FROM OLD.check_out_date
     AND NEW.room_id IS NOT DISTINCT FROM OLD.room_id
     AND NEW.room_type_requested IS NOT DISTINCT FROM OLD.room_type_requested THEN
    RETURN NEW;
  END IF;

  v_from := LEAST(COALESCE(NEW.check_in_date, OLD.check_in_date), COALESCE(OLD.check_in_date, NEW.check_in_date));
  v_to := GREATEST(COALESCE(NEW.check_out_date, OLD.check_out_date), COALESCE(OLD.check_out_date, NEW.check_out_date)) - 1;
  IF v_to < v_from THEN v_to := v_from; END IF;
  -- Past nights are never published.
  v_from := GREATEST(v_from, (now() AT TIME ZONE 'Europe/Budapest')::date);
  IF v_to < v_from THEN RETURN COALESCE(NEW, OLD); END IF;

  INSERT INTO public.channex_availability_dirty (hotel_id, date_from, date_to, reason)
  VALUES (v_hotel, v_from, v_to, 'reservation_' || lower(TG_OP));
  RETURN COALESCE(NEW, OLD);
END;
$$;
REVOKE ALL ON FUNCTION public.channex_mark_availability_dirty() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tr_reservations_channex_availability ON public.reservations;
CREATE TRIGGER tr_reservations_channex_availability
  AFTER INSERT OR UPDATE OR DELETE ON public.reservations
  FOR EACH ROW EXECUTE FUNCTION public.channex_mark_availability_dirty();

-- Revenue engine rate decisions for a connected hotel become Channex rate deltas.
-- Only the primary occupancy price is sent (one per-room rate plan per room type).
CREATE OR REPLACE FUNCTION public.channex_capture_rate_push_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conn public.channex_connections%ROWTYPE;
  v_room_type uuid;
BEGIN
  SELECT * INTO v_conn FROM public.channex_connections WHERE hotel_id = NEW.hotel_id AND mode <> 'off';
  IF NOT FOUND OR NEW.target_price IS NULL OR NEW.target_price <= 0 THEN
    RETURN NEW;
  END IF;
  IF NEW.occupancy IS NOT NULL AND NEW.occupancy <> v_conn.primary_occupancy THEN
    RETURN NEW;
  END IF;
  SELECT rt.id INTO v_room_type
  FROM public.room_types rt
  WHERE rt.hotel_id = NEW.hotel_id AND rt.name = NEW.room_type_name
  LIMIT 1;
  IF v_room_type IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.channex_rate_changes (hotel_id, room_type_id, stay_date, currency, patch, source, source_ref)
  VALUES (
    NEW.hotel_id, v_room_type, NEW.stay_date, upper(COALESCE(NEW.currency, v_conn.currency)),
    jsonb_build_object('rate', trim(to_char(round(NEW.target_price, 2), 'FM9999999990.00'))),
    'revenue_rate_push_item', NEW.id
  );
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.channex_capture_rate_push_item() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tr_revenue_rate_push_items_channex ON public.revenue_rate_push_items;
CREATE TRIGGER tr_revenue_rate_push_items_channex
  AFTER INSERT ON public.revenue_rate_push_items
  FOR EACH ROW EXECUTE FUNCTION public.channex_capture_rate_push_item();

-- ------------------------------------------------------------
-- 9. Availability per mapped room type and night
--    sellable rooms of the type minus active bookings; never below 0 (overbooked => 0)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.channex_room_type_availability(p_hotel_id text, p_from date, p_to date)
RETURNS TABLE (room_type_id uuid, channex_room_type_id uuid, stay_date date, sellable integer, booked integer, availability integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH types AS (
    SELECT rt.id, rt.name, CASE WHEN rt.is_sellable THEN rt.num_rooms ELSE 0 END AS sellable, m.channex_id
    FROM public.room_types rt
    JOIN public.channex_mappings m ON m.hotel_id = rt.hotel_id AND m.kind = 'room_type' AND m.local_id = rt.id
    WHERE rt.hotel_id = p_hotel_id
  ),
  nights AS (
    SELECT d::date AS stay_date FROM generate_series(p_from, p_to, interval '1 day') d
  ),
  active AS (
    SELECT r.check_in_date, r.check_out_date, COALESCE(NULLIF(rm.room_type, ''), r.room_type_requested) AS type_name
    FROM public.reservations r
    LEFT JOIN public.rooms rm ON rm.id = r.room_id
    WHERE r.hotel_id = p_hotel_id
      AND r.status IN ('pending', 'confirmed', 'checked_in')
      AND r.check_in_date <= p_to
      AND r.check_out_date > p_from
  )
  SELECT t.id, t.channex_id, n.stay_date, t.sellable,
         COUNT(a.*)::integer AS booked,
         GREATEST(t.sellable - COUNT(a.*)::integer, 0) AS availability
  FROM types t
  CROSS JOIN nights n
  LEFT JOIN active a
    ON a.type_name = t.name AND a.check_in_date <= n.stay_date AND a.check_out_date > n.stay_date
  GROUP BY t.id, t.channex_id, n.stay_date, t.sellable
  ORDER BY t.id, n.stay_date;
$$;
REVOKE ALL ON FUNCTION public.channex_room_type_availability(text, date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.channex_room_type_availability(text, date, date) TO service_role;

-- Current price + restrictions per mapped room type and night (full sync source).
-- Latest captured base-plan price at the hotel's primary occupancy. Nights without a known
-- price are simply not returned: a full sync never invents a rate.
CREATE OR REPLACE FUNCTION public.channex_full_sync_rates(p_hotel_id text, p_from date, p_to date)
RETURNS TABLE (room_type_id uuid, stay_date date, price numeric, currency text, min_stay integer,
               closed_to_arrival boolean, closed_to_departure boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT ON (rt.id, r.stay_date)
         rt.id, r.stay_date, r.price, upper(r.currency), r.min_stay, r.closed_to_arrival, r.closed_to_departure
  FROM public.channex_connections c
  JOIN public.channex_mappings m ON m.hotel_id = c.hotel_id AND m.kind = 'rate_plan'
  JOIN public.room_types rt ON rt.id = m.local_id AND rt.hotel_id = c.hotel_id
  JOIN public.revenue_room_type_rates r
    ON r.hotel_id = c.hotel_id AND r.room_type_name = rt.name
   AND r.rate_plan_id = 'base' AND r.occupancy = c.primary_occupancy
  WHERE c.hotel_id = p_hotel_id
    AND r.stay_date BETWEEN p_from AND p_to
    AND r.price > 0
  ORDER BY rt.id, r.stay_date, r.captured_at DESC;
$$;
REVOKE ALL ON FUNCTION public.channex_full_sync_rates(text, date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.channex_full_sync_rates(text, date, date) TO service_role;

-- ------------------------------------------------------------
-- 10. Apply a booking revision atomically (called by the edge function after mapping)
--     p_action: 'new' | 'cancelled' | 'review'
--     p_guest:  {first_name,last_name,email,phone,country}   (no ID document: VIZA is captured at check-in)
--     p_rooms:  [{room_index, room_type_name, check_in_date, check_out_date, adults, children,
--                 total_amount, rate_per_night, currency}]
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.channex_apply_revision(
  p_revision_row uuid,
  p_action text,
  p_guest jsonb,
  p_rooms jsonb,
  p_review_reason text DEFAULT NULL,
  p_review_details jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rev public.channex_booking_revisions%ROWTYPE;
  v_conn public.channex_connections%ROWTYPE;
  v_guest uuid;
  v_room jsonb;
  v_res uuid;
  v_ids uuid[] := '{}';
BEGIN
  SELECT * INTO v_rev FROM public.channex_booking_revisions WHERE id = p_revision_row FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'revision row not found'; END IF;
  IF v_rev.state IN ('applied', 'review') THEN
    RETURN jsonb_build_object('state', v_rev.state, 'reservation_ids', to_jsonb(v_rev.reservation_ids), 'duplicate', true);
  END IF;
  IF v_rev.hotel_id IS NULL THEN RAISE EXCEPTION 'revision has no HotelCare hotel'; END IF;

  SELECT * INTO v_conn FROM public.channex_connections WHERE hotel_id = v_rev.hotel_id;
  IF NOT FOUND OR v_conn.mode <> 'live' THEN RAISE EXCEPTION 'hotel is not live on Channex'; END IF;
  IF v_conn.channex_property_id::text IS DISTINCT FROM v_rev.channex_property_id THEN
    RAISE EXCEPTION 'property ownership mismatch';
  END IF;

  IF p_action = 'new' THEN
    -- Duplicate delivery of a booking we already hold: link and stop.
    SELECT array_agg(id ORDER BY channex_room_index) INTO v_ids
    FROM public.reservations WHERE channex_booking_id = v_rev.channex_booking_id;
    IF v_ids IS NULL OR array_length(v_ids, 1) IS NULL THEN
      v_ids := '{}';
      INSERT INTO public.guests (hotel_id, organization_slug, first_name, last_name, email, phone, country, notes)
      VALUES (
        v_rev.hotel_id, v_conn.organization_slug,
        COALESCE(NULLIF(p_guest->>'first_name', ''), 'OTA'),
        COALESCE(NULLIF(p_guest->>'last_name', ''), 'Guest'),
        NULLIF(p_guest->>'email', ''), NULLIF(p_guest->>'phone', ''), NULLIF(p_guest->>'country', ''),
        'Created from ' || COALESCE(v_rev.ota_name, 'OTA') || ' booking via Channex. ID document must be scanned at check-in (VIZA).'
      )
      RETURNING id INTO v_guest;

      FOR v_room IN SELECT * FROM jsonb_array_elements(COALESCE(p_rooms, '[]'::jsonb)) LOOP
        INSERT INTO public.reservations (
          hotel_id, organization_slug, guest_id, room_type_requested, status,
          check_in_date, check_out_date, adults, children, rate_per_night, total_amount, currency,
          payment_status, source, source_reservation_id, pms_guest_name,
          channex_booking_id, channex_room_index, ota_name, ota_reservation_code, payment_collect, ota_taxes,
          special_requests
        ) VALUES (
          v_rev.hotel_id, v_conn.organization_slug, v_guest, v_room->>'room_type_name', 'confirmed',
          (v_room->>'check_in_date')::date, (v_room->>'check_out_date')::date,
          GREATEST(COALESCE((v_room->>'adults')::integer, 1), 1), GREATEST(COALESCE((v_room->>'children')::integer, 0), 0),
          COALESCE((v_room->>'rate_per_night')::numeric, 0), COALESCE((v_room->>'total_amount')::numeric, 0),
          COALESCE(NULLIF(v_room->>'currency', ''), v_conn.currency),
          CASE WHEN p_guest->>'payment_collect' = 'ota' THEN 'paid_to_ota' ELSE 'unpaid' END,
          'channex', v_rev.ota_reservation_code,
          trim(COALESCE(p_guest->>'first_name', '') || ' ' || COALESCE(p_guest->>'last_name', '')),
          v_rev.channex_booking_id, (v_room->>'room_index')::integer, v_rev.ota_name, v_rev.ota_reservation_code,
          NULLIF(p_guest->>'payment_collect', ''), v_room->'ota_taxes',
          NULLIF(v_room->>'notes', '')
        )
        RETURNING id INTO v_res;
        v_ids := v_ids || v_res;
      END LOOP;
    END IF;

    -- Booked and blocking the calendar, but something needs a person (e.g. unmapped OTA room).
    IF p_review_reason IS NOT NULL THEN
      INSERT INTO public.channex_review_cases (hotel_id, revision_row_id, reservation_ids, reason, details)
      VALUES (v_rev.hotel_id, p_revision_row, v_ids, p_review_reason, COALESCE(p_review_details, '{}'::jsonb))
      ON CONFLICT (revision_row_id) DO NOTHING;
      UPDATE public.channex_booking_revisions
        SET state = 'review', reservation_ids = v_ids, last_error = NULL, updated_at = now()
        WHERE id = p_revision_row;
      RETURN jsonb_build_object('state', 'review', 'reservation_ids', to_jsonb(v_ids));
    END IF;

    UPDATE public.channex_booking_revisions
      SET state = 'applied', reservation_ids = v_ids, last_error = NULL, updated_at = now()
      WHERE id = p_revision_row;
    RETURN jsonb_build_object('state', 'applied', 'reservation_ids', to_jsonb(v_ids));

  ELSIF p_action = 'cancelled' THEN
    WITH upd AS (
      UPDATE public.reservations
        SET status = 'cancelled', cancelled_at = COALESCE(cancelled_at, now()),
            cancellation_reason = COALESCE(cancellation_reason, 'Cancelled on ' || COALESCE(v_rev.ota_name, 'OTA') || ' (via Channex)'),
            updated_at = now()
        WHERE channex_booking_id = v_rev.channex_booking_id AND hotel_id = v_rev.hotel_id
        RETURNING id
    )
    SELECT COALESCE(array_agg(id), '{}') INTO v_ids FROM upd;

    IF array_length(v_ids, 1) IS NULL THEN
      -- We never held this booking: a person must check it (it may have arrived before go-live).
      INSERT INTO public.channex_review_cases (hotel_id, revision_row_id, reason, details)
      VALUES (v_rev.hotel_id, p_revision_row, 'cancellation_for_unknown_booking', COALESCE(p_review_details, '{}'::jsonb))
      ON CONFLICT (revision_row_id) DO NOTHING;
      UPDATE public.channex_booking_revisions SET state = 'review', updated_at = now() WHERE id = p_revision_row;
      RETURN jsonb_build_object('state', 'review');
    END IF;

    UPDATE public.channex_booking_revisions
      SET state = 'applied', reservation_ids = v_ids, last_error = NULL, updated_at = now()
      WHERE id = p_revision_row;
    RETURN jsonb_build_object('state', 'applied', 'reservation_ids', to_jsonb(v_ids));

  ELSIF p_action = 'review' THEN
    SELECT COALESCE(array_agg(id), '{}') INTO v_ids
    FROM public.reservations WHERE channex_booking_id = v_rev.channex_booking_id AND hotel_id = v_rev.hotel_id;
    INSERT INTO public.channex_review_cases (hotel_id, revision_row_id, reservation_ids, reason, details)
    VALUES (v_rev.hotel_id, p_revision_row, v_ids, COALESCE(p_review_reason, 'needs_review'), COALESCE(p_review_details, '{}'::jsonb))
    ON CONFLICT (revision_row_id) DO NOTHING;
    UPDATE public.channex_booking_revisions
      SET state = 'review', reservation_ids = v_ids, updated_at = now()
      WHERE id = p_revision_row;
    RETURN jsonb_build_object('state', 'review', 'reservation_ids', to_jsonb(v_ids));
  END IF;

  RAISE EXCEPTION 'unknown action %', p_action;
END;
$$;
REVOKE ALL ON FUNCTION public.channex_apply_revision(uuid, text, jsonb, jsonb, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.channex_apply_revision(uuid, text, jsonb, jsonb, text, jsonb) TO service_role;

-- ------------------------------------------------------------
-- 11. GDPR: purge guest data from raw OTA payloads 90 days after departure
--     (reservation and guest records follow HotelCare's normal retention)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.channex_purge_revision_pii()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count integer;
BEGIN
  UPDATE public.channex_booking_revisions
    SET payload = jsonb_build_object(
          'purged', true,
          'status', payload->'status',
          'ota_name', payload->'ota_name',
          'arrival_date', payload->'arrival_date',
          'departure_date', payload->'departure_date',
          'amount', payload->'amount',
          'currency', payload->'currency'
        ),
        pii_purged_at = now(), updated_at = now()
    WHERE pii_purged_at IS NULL
      AND state IN ('applied', 'review', 'unknown_property', 'dry_run')
      AND COALESCE(departure_date, created_at::date) < current_date - 90
      AND NOT EXISTS (
        SELECT 1 FROM public.channex_review_cases rc
        WHERE rc.revision_row_id = channex_booking_revisions.id AND rc.status = 'open'
      );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.channex_purge_revision_pii() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 12. Secrets (Vault) for worker and webhook authentication
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'channex_worker_secret') THEN
    PERFORM vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'channex_worker_secret',
      'HotelCare Channex worker cron secret', NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'channex_webhook_secret') THEN
    PERFORM vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'channex_webhook_secret',
      'Shared secret sent by Channex in a custom webhook header', NULL);
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.get_channex_worker_secret()
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = public, vault AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'channex_worker_secret' LIMIT 1;
$$;
CREATE OR REPLACE FUNCTION public.get_channex_webhook_secret()
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = public, vault AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'channex_webhook_secret' LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.get_channex_worker_secret() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_channex_webhook_secret() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_channex_worker_secret() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_channex_webhook_secret() TO service_role;

-- ------------------------------------------------------------
-- 13. Schedules (cheap when idle: guarded by EXISTS)
--     * ARI worker every minute while there is work (debounce = signals older than 20 s)
--     * Booking feed backstop every 5 minutes while any hotel is connected
--       (6 chances inside Channex's 30-minute un-acked window)
--     * Daily PII purge at 03:17 Budapest
-- ------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN

    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'channex-ari-worker-1min') THEN
      PERFORM cron.unschedule('channex-ari-worker-1min');
    END IF;
    PERFORM cron.schedule('channex-ari-worker-1min', '* * * * *', $cron$
      SELECT net.http_post(
        url := 'https://pcmszqqklkolvvlabohq.supabase.co/functions/v1/channex-ari-worker',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-worker-secret', public.get_channex_worker_secret()),
        body := jsonb_build_object('trigger', 'cron'),
        timeout_milliseconds := 60000
      )
      WHERE EXISTS (SELECT 1 FROM public.channex_availability_dirty WHERE processed_at IS NULL)
         OR EXISTS (SELECT 1 FROM public.channex_rate_changes WHERE processed_at IS NULL)
         OR EXISTS (SELECT 1 FROM public.channex_ari_outbox WHERE status = 'pending' AND next_attempt_at <= now());
    $cron$);

    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'channex-booking-feed-5min') THEN
      PERFORM cron.unschedule('channex-booking-feed-5min');
    END IF;
    PERFORM cron.schedule('channex-booking-feed-5min', '2-59/5 * * * *', $cron$
      SELECT net.http_post(
        url := 'https://pcmszqqklkolvvlabohq.supabase.co/functions/v1/channex-booking-worker',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-worker-secret', public.get_channex_worker_secret()),
        body := jsonb_build_object('trigger', 'cron'),
        timeout_milliseconds := 60000
      )
      WHERE EXISTS (SELECT 1 FROM public.channex_connections WHERE mode <> 'off');
    $cron$);

    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'channex-purge-pii-daily') THEN
      PERFORM cron.unschedule('channex-purge-pii-daily');
    END IF;
    PERFORM cron.schedule('channex-purge-pii-daily', '17 2 * * *', $cron$ SELECT public.channex_purge_revision_pii(); $cron$);
  END IF;
END
$$;
