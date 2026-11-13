-- ============================================================================
-- Channex integration layer (phase 1, certification scope)
--
--   * Native ARI store: pms_ari_availability, pms_ari_rates  (HotelCare is the
--     source of truth for hotels with settings.native_ari = true).
--   * Change capture: row triggers write field-level deltas into
--     channex_ari_outbox. No polling of the database, no timer full-sync.
--   * Availability is recomputed from reservations by trigger, so a booking
--     made at reception immediately produces an availability delta.
--   * channex_sync_log keeps every Channex request with its task ids
--     (needed for the certification form and for the live review).
--   * Booking intake: channex_booking_revisions + channex_apply_booking_revision.
--     Revisions are acknowledged by the worker only after this function commits.
--
-- Safety gate for this phase: only hotels whose organization is "channex" and
-- whose settings.native_ari = true are affected (pms_ari_native_hotel()).
-- RD Hotels, SLNT and the Previo-connected hotels are untouched.
-- ============================================================================

-- 0. Channex connection + mapping tables ------------------------------------
-- These exist in production (created during the October sandbox probe, uuid ids,
-- more columns and CHECK gates) but were never committed as a migration.
-- Create a compatible minimum if missing, then add phase-1 columns.
CREATE TABLE IF NOT EXISTS public.channex_connections (
  hotel_id text PRIMARY KEY,
  organization_slug text NOT NULL,
  environment text NOT NULL DEFAULT 'staging',
  mode text NOT NULL DEFAULT 'off',
  kill_switch boolean NOT NULL DEFAULT true,
  is_sandbox_hotel boolean NOT NULL DEFAULT true,
  channex_property_id uuid UNIQUE,
  currency text,
  timezone text,
  primary_occupancy integer,
  ntak_reporting_path text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.channex_connections
  ADD COLUMN IF NOT EXISTS ari_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bookings_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS property_type text,
  ADD COLUMN IF NOT EXISTS last_full_sync_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_feed_poll_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error text;

CREATE TABLE IF NOT EXISTS public.channex_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL,
  kind text NOT NULL,
  local_id uuid NOT NULL,
  channex_id uuid NOT NULL,
  channex_title text,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, kind, local_id)
);

ALTER TABLE public.channex_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channex_mappings ENABLE ROW LEVEL SECURITY;

-- 1. Native-hotel gate --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pms_ari_native_hotel(_hotel_id text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.hotel_configurations hc
      JOIN public.organizations o ON o.id = hc.organization_id
     WHERE hc.hotel_id = _hotel_id
       AND o.slug = 'channex'
       AND COALESCE((hc.settings->>'native_ari')::boolean, false)
  );
$$;
REVOKE ALL ON FUNCTION public.pms_ari_native_hotel(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pms_ari_native_hotel(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.channex_ari_publishing(_hotel_id text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.pms_ari_native_hotel(_hotel_id) AND EXISTS (
    SELECT 1 FROM public.channex_connections c
     WHERE c.hotel_id = _hotel_id
       AND c.ari_enabled
       AND NOT c.kill_switch
       AND c.channex_property_id IS NOT NULL
  );
$$;
REVOKE ALL ON FUNCTION public.channex_ari_publishing(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.channex_ari_publishing(text) TO authenticated, service_role;

-- 2. Native ARI store ---------------------------------------------------------
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS room_type_id uuid REFERENCES public.room_types(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.pms_ari_availability (
  hotel_id text NOT NULL,
  room_type_id uuid NOT NULL REFERENCES public.room_types(id) ON DELETE CASCADE,
  date date NOT NULL,
  total_rooms integer NOT NULL DEFAULT 0 CHECK (total_rooms >= 0),
  booked integer NOT NULL DEFAULT 0 CHECK (booked >= 0),
  out_of_order integer NOT NULL DEFAULT 0 CHECK (out_of_order >= 0),
  sell_limit integer CHECK (sell_limit IS NULL OR sell_limit >= 0),
  availability integer GENERATED ALWAYS AS (
    -- sell_limit = rooms opened for sale (allotment); bookings consume it.
    GREATEST(0, LEAST(COALESCE(sell_limit, total_rooms), total_rooms - out_of_order) - booked)
  ) STORED,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  PRIMARY KEY (room_type_id, date)
);
CREATE INDEX IF NOT EXISTS pms_ari_availability_hotel_date_idx ON public.pms_ari_availability(hotel_id, date);

CREATE TABLE IF NOT EXISTS public.pms_ari_rates (
  hotel_id text NOT NULL,
  rate_plan_id uuid NOT NULL REFERENCES public.rate_plans(id) ON DELETE CASCADE,
  date date NOT NULL,
  rate numeric(12,2) CHECK (rate IS NULL OR rate >= 0),
  min_stay_arrival integer CHECK (min_stay_arrival IS NULL OR min_stay_arrival >= 1),
  min_stay_through integer CHECK (min_stay_through IS NULL OR min_stay_through >= 1),
  max_stay integer CHECK (max_stay IS NULL OR max_stay >= 0),
  closed_to_arrival boolean,
  closed_to_departure boolean,
  stop_sell boolean,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  PRIMARY KEY (rate_plan_id, date)
);
CREATE INDEX IF NOT EXISTS pms_ari_rates_hotel_date_idx ON public.pms_ari_rates(hotel_id, date);

ALTER TABLE public.pms_ari_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pms_ari_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pms_ari_availability_read ON public.pms_ari_availability;
CREATE POLICY pms_ari_availability_read ON public.pms_ari_availability FOR SELECT TO authenticated
  USING (public.can_access_pms_hotel(auth.uid(), hotel_id, NULL));
DROP POLICY IF EXISTS pms_ari_rates_read ON public.pms_ari_rates;
CREATE POLICY pms_ari_rates_read ON public.pms_ari_rates FOR SELECT TO authenticated
  USING (public.can_access_pms_hotel(auth.uid(), hotel_id, NULL));
-- Writes go only through pms_ari_save() (SECURITY DEFINER, validated).

DROP POLICY IF EXISTS channex_connections_read ON public.channex_connections;
CREATE POLICY channex_connections_read ON public.channex_connections FOR SELECT TO authenticated
  USING (public.can_access_pms_hotel(auth.uid(), hotel_id, NULL));
DROP POLICY IF EXISTS channex_mappings_read ON public.channex_mappings;
CREATE POLICY channex_mappings_read ON public.channex_mappings FOR SELECT TO authenticated
  USING (public.can_access_pms_hotel(auth.uid(), hotel_id, NULL));

-- 3. Outbox + sync log --------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.channex_ari_outbox (
  id bigserial PRIMARY KEY,
  hotel_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('availability', 'restrictions')),
  target_id uuid NOT NULL,               -- room_types.id (availability) or rate_plans.id (restrictions)
  date date NOT NULL,
  fields jsonb NOT NULL,                 -- only the fields that changed
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'superseded')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  batch_id uuid,
  sync_log_id uuid,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS channex_ari_outbox_pending_idx
  ON public.channex_ari_outbox(hotel_id, kind, next_attempt_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS channex_ari_outbox_key_idx
  ON public.channex_ari_outbox(kind, target_id, date) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS public.channex_sync_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL,
  kind text NOT NULL,          -- availability | restrictions | property | room_type | rate_plan | booking_feed | booking_ack | webhook
  request_type text NOT NULL,  -- delta | full_sync | bootstrap | feed | ack | probe
  ok boolean NOT NULL DEFAULT false,
  http_status integer,
  task_ids text[] NOT NULL DEFAULT '{}',
  warnings jsonb,
  value_count integer,
  outbox_count integer,
  date_from date,
  date_to date,
  request_body jsonb,          -- ARI only; never guest data
  response_body jsonb,
  error text,
  duration_ms integer,
  trigger_source text,         -- ui | cron | webhook | full_sync | retry
  triggered_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS channex_sync_log_hotel_idx ON public.channex_sync_log(hotel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS channex_sync_log_rate_idx ON public.channex_sync_log(hotel_id, kind, created_at) WHERE http_status IS NOT NULL;

ALTER TABLE public.channex_ari_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channex_sync_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS channex_ari_outbox_read ON public.channex_ari_outbox;
CREATE POLICY channex_ari_outbox_read ON public.channex_ari_outbox FOR SELECT TO authenticated
  USING (public.can_access_pms_hotel(auth.uid(), hotel_id, NULL));
DROP POLICY IF EXISTS channex_sync_log_read ON public.channex_sync_log;
CREATE POLICY channex_sync_log_read ON public.channex_sync_log FOR SELECT TO authenticated
  USING (public.can_access_pms_hotel(auth.uid(), hotel_id, NULL));

-- Enqueue helper: merges into an existing pending row for the same key so
-- several quick edits of one cell become one value, and fields changed earlier
-- but not yet sent are preserved.
CREATE OR REPLACE FUNCTION public.channex_enqueue_ari(_hotel_id text, _kind text, _target uuid, _date date, _fields jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  r record;
  v_fields jsonb := '{}'::jsonb;
BEGIN
  IF _fields IS NULL OR _fields = '{}'::jsonb THEN RETURN; END IF;
  FOR r IN
    SELECT id, fields FROM public.channex_ari_outbox
     WHERE kind = _kind AND target_id = _target AND date = _date AND status = 'pending'
     ORDER BY id FOR UPDATE
  LOOP
    v_fields := v_fields || r.fields;
    UPDATE public.channex_ari_outbox SET status = 'superseded' WHERE id = r.id;
  END LOOP;
  INSERT INTO public.channex_ari_outbox (hotel_id, kind, target_id, date, fields)
  VALUES (_hotel_id, _kind, _target, _date, v_fields || _fields);
END;
$$;
REVOKE ALL ON FUNCTION public.channex_enqueue_ari(text, text, uuid, date, jsonb) FROM PUBLIC, anon, authenticated;

-- 4. Change-capture triggers --------------------------------------------------
CREATE OR REPLACE FUNCTION public.pms_ari_availability_capture()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.availability IS NOT DISTINCT FROM OLD.availability THEN
    RETURN NEW;
  END IF;
  -- A newly tracked day that is simply "all rooms free" is what the full sync
  -- already sent; only real deviations are published.
  IF TG_OP = 'INSERT' AND NEW.availability = NEW.total_rooms AND NEW.sell_limit IS NULL THEN
    RETURN NEW;
  END IF;
  IF public.channex_ari_publishing(NEW.hotel_id) THEN
    PERFORM public.channex_enqueue_ari(NEW.hotel_id, 'availability', NEW.room_type_id, NEW.date,
                                       jsonb_build_object('availability', NEW.availability));
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tr_pms_ari_availability_capture ON public.pms_ari_availability;
CREATE TRIGGER tr_pms_ari_availability_capture
AFTER INSERT OR UPDATE ON public.pms_ari_availability
FOR EACH ROW EXECUTE FUNCTION public.pms_ari_availability_capture();

CREATE OR REPLACE FUNCTION public.pms_ari_rates_capture()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v jsonb := '{}'::jsonb;
BEGIN
  IF NOT public.channex_ari_publishing(NEW.hotel_id) THEN RETURN NEW; END IF;
  IF NEW.rate IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.rate IS DISTINCT FROM OLD.rate) THEN
    v := v || jsonb_build_object('rate', to_char(NEW.rate, 'FM999999990.00')); END IF;
  IF NEW.min_stay_arrival IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.min_stay_arrival IS DISTINCT FROM OLD.min_stay_arrival) THEN
    v := v || jsonb_build_object('min_stay_arrival', NEW.min_stay_arrival); END IF;
  IF NEW.min_stay_through IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.min_stay_through IS DISTINCT FROM OLD.min_stay_through) THEN
    v := v || jsonb_build_object('min_stay_through', NEW.min_stay_through); END IF;
  IF NEW.max_stay IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.max_stay IS DISTINCT FROM OLD.max_stay) THEN
    v := v || jsonb_build_object('max_stay', NEW.max_stay); END IF;
  IF NEW.closed_to_arrival IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.closed_to_arrival IS DISTINCT FROM OLD.closed_to_arrival) THEN
    v := v || jsonb_build_object('closed_to_arrival', NEW.closed_to_arrival); END IF;
  IF NEW.closed_to_departure IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.closed_to_departure IS DISTINCT FROM OLD.closed_to_departure) THEN
    v := v || jsonb_build_object('closed_to_departure', NEW.closed_to_departure); END IF;
  IF NEW.stop_sell IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.stop_sell IS DISTINCT FROM OLD.stop_sell) THEN
    v := v || jsonb_build_object('stop_sell', NEW.stop_sell); END IF;
  PERFORM public.channex_enqueue_ari(NEW.hotel_id, 'restrictions', NEW.rate_plan_id, NEW.date, v);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tr_pms_ari_rates_capture ON public.pms_ari_rates;
CREATE TRIGGER tr_pms_ari_rates_capture
AFTER INSERT OR UPDATE ON public.pms_ari_rates
FOR EACH ROW EXECUTE FUNCTION public.pms_ari_rates_capture();

-- 5. Availability from reservations ------------------------------------------
-- Resolves a reservation's room type: explicit room_type_id, then the assigned
-- room's type name, then the requested type name.
CREATE OR REPLACE FUNCTION public.pms_ari_refresh_availability(_hotel_id text, _from date, _to date)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF NOT public.pms_ari_native_hotel(_hotel_id) OR _from IS NULL OR _to IS NULL OR _to <= _from THEN
    RETURN 0;
  END IF;
  IF _to - _from > 750 THEN _to := _from + 750; END IF;

  WITH rt AS (
    SELECT id, name, num_rooms FROM public.room_types
     WHERE hotel_id = _hotel_id AND is_sellable AND counts_toward_inventory
  ), days AS (
    SELECT d::date AS date FROM generate_series(_from, _to - 1, interval '1 day') d
  ), res AS (
    SELECT r.check_in_date, r.check_out_date,
           COALESCE(r.room_type_id,
                    (SELECT rt2.id FROM rt rt2 JOIN public.rooms ro ON ro.id = r.room_id
                      WHERE rt2.name = ro.room_type LIMIT 1),
                    (SELECT rt3.id FROM rt rt3 WHERE rt3.name = r.room_type_requested LIMIT 1)) AS room_type_id
      FROM public.reservations r
     WHERE r.hotel_id = _hotel_id
       AND r.status IN ('pending', 'confirmed', 'checked_in')
       AND r.pms_missing_since IS NULL
       AND r.check_in_date < _to AND r.check_out_date > _from
  ), calc AS (
    SELECT rt.id AS room_type_id, days.date, rt.num_rooms AS total_rooms,
           (SELECT count(*) FROM res WHERE res.room_type_id = rt.id
              AND res.check_in_date <= days.date AND res.check_out_date > days.date)::int AS booked
      FROM rt CROSS JOIN days
  )
  INSERT INTO public.pms_ari_availability AS a (hotel_id, room_type_id, date, total_rooms, booked)
  SELECT _hotel_id, room_type_id, date, total_rooms, booked FROM calc
  ON CONFLICT (room_type_id, date) DO UPDATE
     SET total_rooms = EXCLUDED.total_rooms, booked = EXCLUDED.booked, updated_at = now()
   WHERE (a.total_rooms, a.booked) IS DISTINCT FROM (EXCLUDED.total_rooms, EXCLUDED.booked);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.pms_ari_refresh_availability(text, date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pms_ari_refresh_availability(text, date, date) TO service_role;

CREATE OR REPLACE FUNCTION public.pms_ari_reservation_changed()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_hotel text := COALESCE(NEW.hotel_id, OLD.hotel_id);
  v_from date;
  v_to date;
BEGIN
  IF v_hotel IS NULL OR NOT public.pms_ari_native_hotel(v_hotel) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  v_from := LEAST(COALESCE(NEW.check_in_date, OLD.check_in_date), COALESCE(OLD.check_in_date, NEW.check_in_date));
  v_to := GREATEST(COALESCE(NEW.check_out_date, OLD.check_out_date), COALESCE(OLD.check_out_date, NEW.check_out_date));
  PERFORM public.pms_ari_refresh_availability(v_hotel, v_from, v_to);
  IF TG_OP = 'UPDATE' AND OLD.hotel_id IS DISTINCT FROM NEW.hotel_id AND OLD.hotel_id IS NOT NULL THEN
    PERFORM public.pms_ari_refresh_availability(OLD.hotel_id, OLD.check_in_date, OLD.check_out_date);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
DROP TRIGGER IF EXISTS tr_pms_ari_reservation_changed ON public.reservations;
CREATE TRIGGER tr_pms_ari_reservation_changed
AFTER INSERT OR DELETE OR UPDATE OF check_in_date, check_out_date, status, room_id, room_type_id,
                                   room_type_requested, hotel_id, pms_missing_since
ON public.reservations
FOR EACH ROW EXECUTE FUNCTION public.pms_ari_reservation_changed();

-- 6. Save RPC used by the reception Rates & Availability screen -------------
-- _changes = {
--   "availability": [{"room_type_id": uuid, "date_from": "YYYY-MM-DD", "date_to": "YYYY-MM-DD" (inclusive),
--                     "weekdays": [1..7] optional ISO weekdays,
--                     "availability": int (rooms left to sell) | "sell_limit": int|null (allotment), "out_of_order": int}],
--   "rates":        [{"rate_plan_id": uuid, "date_from", "date_to", "weekdays",
--                     "rate", "min_stay_arrival", "min_stay_through", "max_stay",
--                     "closed_to_arrival", "closed_to_departure", "stop_sell"}]
-- }
-- Only the keys present in an item are changed; everything else is preserved.
-- One call = one transaction = one outbox burst = one Channex request per kind.
CREATE OR REPLACE FUNCTION public.pms_ari_save(_hotel_id text, _changes jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_item jsonb;
  v_from date;
  v_to date;
  v_days int[];
  v_rates int := 0;
  v_avail int := 0;
  v_n int;
  v_min date := NULL;
  v_max date := NULL;
BEGIN
  IF v_uid IS NULL OR NOT public.can_access_pms_hotel(v_uid, _hotel_id, NULL) THEN
    RAISE EXCEPTION 'Not allowed for this hotel' USING ERRCODE = '42501';
  END IF;
  IF NOT public.pms_ari_native_hotel(_hotel_id) THEN
    RAISE EXCEPTION 'Rates and availability for this hotel are managed in the connected PMS (Previo)' USING ERRCODE = '22023';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(_changes->'rates', '[]'::jsonb)) LOOP
    v_from := (v_item->>'date_from')::date;
    v_to := COALESCE((v_item->>'date_to')::date, v_from);
    IF v_from IS NULL OR v_to < v_from OR v_to - v_from > 730 THEN
      RAISE EXCEPTION 'Invalid date range %..%', v_from, v_to USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.rate_plans WHERE id = (v_item->>'rate_plan_id')::uuid AND hotel_id = _hotel_id) THEN
      RAISE EXCEPTION 'Rate plan does not belong to this hotel' USING ERRCODE = '22023';
    END IF;
    v_days := CASE WHEN jsonb_typeof(v_item->'weekdays') = 'array'
                   THEN ARRAY(SELECT jsonb_array_elements_text(v_item->'weekdays')::int) END;

    INSERT INTO public.pms_ari_rates AS t (hotel_id, rate_plan_id, date, rate, min_stay_arrival, min_stay_through,
                                           max_stay, closed_to_arrival, closed_to_departure, stop_sell, updated_by)
    SELECT _hotel_id, (v_item->>'rate_plan_id')::uuid, d::date,
           (v_item->>'rate')::numeric, (v_item->>'min_stay_arrival')::int, (v_item->>'min_stay_through')::int,
           (v_item->>'max_stay')::int, (v_item->>'closed_to_arrival')::boolean,
           (v_item->>'closed_to_departure')::boolean, (v_item->>'stop_sell')::boolean, v_uid
      FROM generate_series(v_from, v_to, interval '1 day') d
     WHERE v_days IS NULL OR extract(isodow FROM d)::int = ANY (v_days)
    ON CONFLICT (rate_plan_id, date) DO UPDATE SET
      rate                = CASE WHEN v_item ? 'rate'                THEN EXCLUDED.rate                ELSE t.rate END,
      min_stay_arrival    = CASE WHEN v_item ? 'min_stay_arrival'    THEN EXCLUDED.min_stay_arrival    ELSE t.min_stay_arrival END,
      min_stay_through    = CASE WHEN v_item ? 'min_stay_through'    THEN EXCLUDED.min_stay_through    ELSE t.min_stay_through END,
      max_stay            = CASE WHEN v_item ? 'max_stay'            THEN EXCLUDED.max_stay            ELSE t.max_stay END,
      closed_to_arrival   = CASE WHEN v_item ? 'closed_to_arrival'   THEN EXCLUDED.closed_to_arrival   ELSE t.closed_to_arrival END,
      closed_to_departure = CASE WHEN v_item ? 'closed_to_departure' THEN EXCLUDED.closed_to_departure ELSE t.closed_to_departure END,
      stop_sell           = CASE WHEN v_item ? 'stop_sell'           THEN EXCLUDED.stop_sell           ELSE t.stop_sell END,
      updated_by = v_uid, updated_at = now();
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_rates := v_rates + v_n;
  END LOOP;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(_changes->'availability', '[]'::jsonb)) LOOP
    v_from := (v_item->>'date_from')::date;
    v_to := COALESCE((v_item->>'date_to')::date, v_from);
    IF v_from IS NULL OR v_to < v_from OR v_to - v_from > 730 THEN
      RAISE EXCEPTION 'Invalid date range %..%', v_from, v_to USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.room_types WHERE id = (v_item->>'room_type_id')::uuid AND hotel_id = _hotel_id) THEN
      RAISE EXCEPTION 'Room type does not belong to this hotel' USING ERRCODE = '22023';
    END IF;
    v_days := CASE WHEN jsonb_typeof(v_item->'weekdays') = 'array'
                   THEN ARRAY(SELECT jsonb_array_elements_text(v_item->'weekdays')::int) END;
    PERFORM public.pms_ari_refresh_availability(_hotel_id, v_from, v_to + 1);
    UPDATE public.pms_ari_availability a SET
      -- "availability" = rooms left to sell as typed at reception; stored as an allotment so
      -- later bookings keep reducing it (availability 8, one booking -> 7).
      sell_limit   = CASE WHEN v_item ? 'availability' THEN (v_item->>'availability')::int + a.booked
                          WHEN v_item ? 'sell_limit'   THEN (v_item->>'sell_limit')::int
                          ELSE a.sell_limit END,
      out_of_order = CASE WHEN v_item ? 'out_of_order' THEN COALESCE((v_item->>'out_of_order')::int, 0) ELSE a.out_of_order END,
      updated_by = v_uid, updated_at = now()
     WHERE a.room_type_id = (v_item->>'room_type_id')::uuid
       AND a.date BETWEEN v_from AND v_to
       AND (v_days IS NULL OR extract(isodow FROM a.date)::int = ANY (v_days));
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_avail := v_avail + v_n;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'rate_days', v_rates, 'availability_days', v_avail,
                            'publishing', public.channex_ari_publishing(_hotel_id));
END;
$$;
REVOKE ALL ON FUNCTION public.pms_ari_save(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pms_ari_save(text, jsonb) TO authenticated;

-- Grid read: refreshes availability for the window, then returns both stores.
CREATE OR REPLACE FUNCTION public.pms_ari_grid(_hotel_id text, _from date, _to date)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_access_pms_hotel(auth.uid(), _hotel_id, NULL) THEN
    RAISE EXCEPTION 'Not allowed for this hotel' USING ERRCODE = '42501';
  END IF;
  IF _to - _from > 62 THEN _to := _from + 62; END IF;
  PERFORM public.pms_ari_refresh_availability(_hotel_id, _from, _to + 1);
  RETURN jsonb_build_object(
    'native', public.pms_ari_native_hotel(_hotel_id),
    'publishing', public.channex_ari_publishing(_hotel_id),
    'room_types', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name, 'num_rooms', num_rooms) ORDER BY sort_order, name)
                              FROM public.room_types WHERE hotel_id = _hotel_id AND is_sellable), '[]'::jsonb),
    'rate_plans', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name, 'room_type_id', room_type_id,
                                                                'base_rate', base_rate, 'currency', currency, 'code', code)
                                              ORDER BY sort_order, name)
                              FROM public.rate_plans WHERE hotel_id = _hotel_id AND COALESCE(is_active, true)), '[]'::jsonb),
    'availability', COALESCE((SELECT jsonb_agg(to_jsonb(a) - 'hotel_id' - 'updated_by')
                                FROM public.pms_ari_availability a
                               WHERE a.hotel_id = _hotel_id AND a.date BETWEEN _from AND _to), '[]'::jsonb),
    'rates', COALESCE((SELECT jsonb_agg(to_jsonb(r) - 'hotel_id' - 'updated_by')
                         FROM public.pms_ari_rates r
                        WHERE r.hotel_id = _hotel_id AND r.date BETWEEN _from AND _to), '[]'::jsonb),
    'pending_outbox', (SELECT count(*) FROM public.channex_ari_outbox WHERE hotel_id = _hotel_id AND status IN ('pending', 'sending'))
  );
END;
$$;
REVOKE ALL ON FUNCTION public.pms_ari_grid(text, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pms_ari_grid(text, date, date) TO authenticated;

-- 7. Worker claim (service role) ----------------------------------------------
CREATE OR REPLACE FUNCTION public.channex_claim_ari(_hotel_id text, _kind text, _limit integer DEFAULT 20000)
RETURNS SETOF public.channex_ari_outbox
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_batch uuid := gen_random_uuid();
BEGIN
  -- A worker that died mid-send leaves rows in 'sending'; give them back after 5 minutes.
  UPDATE public.channex_ari_outbox SET status = 'pending', next_attempt_at = now()
   WHERE hotel_id = _hotel_id AND kind = _kind AND status = 'sending'
     AND next_attempt_at < now() - interval '5 minutes';
  RETURN QUERY
  UPDATE public.channex_ari_outbox o
     SET status = 'sending', batch_id = v_batch, attempts = o.attempts + 1, next_attempt_at = now()
   WHERE o.id IN (
     SELECT id FROM public.channex_ari_outbox
      WHERE hotel_id = _hotel_id AND kind = _kind AND status = 'pending' AND next_attempt_at <= now()
      ORDER BY id
      LIMIT _limit
      FOR UPDATE SKIP LOCKED)
  RETURNING o.*;
END;
$$;
REVOKE ALL ON FUNCTION public.channex_claim_ari(text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.channex_claim_ari(text, text, integer) TO service_role;

-- 8. Booking intake ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.channex_booking_revisions (
  revision_id text PRIMARY KEY,
  booking_id text NOT NULL,
  property_id text NOT NULL,
  hotel_id text NOT NULL,
  status text NOT NULL,                  -- new | modified | cancelled
  ota_name text,
  ota_reservation_code text,
  arrival_date date,
  departure_date date,
  payload jsonb NOT NULL,                -- full revision; card data is stripped before storing
  received_via text NOT NULL DEFAULT 'feed',
  received_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz,
  apply_error text,
  reservation_ids uuid[] NOT NULL DEFAULT '{}',
  review_required boolean NOT NULL DEFAULT false,
  review_reason text,
  reviewed_at timestamptz,
  reviewed_by uuid,
  acked_at timestamptz,
  ack_error text
);
CREATE INDEX IF NOT EXISTS channex_booking_revisions_booking_idx ON public.channex_booking_revisions(booking_id, received_at);
CREATE INDEX IF NOT EXISTS channex_booking_revisions_unacked_idx ON public.channex_booking_revisions(hotel_id) WHERE acked_at IS NULL;

CREATE TABLE IF NOT EXISTS public.channex_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event text,
  property_id text,
  hotel_id text,
  revision_id text,
  booking_id text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  error text
);

ALTER TABLE public.channex_booking_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channex_webhook_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS channex_booking_revisions_read ON public.channex_booking_revisions;
CREATE POLICY channex_booking_revisions_read ON public.channex_booking_revisions FOR SELECT TO authenticated
  USING (public.can_access_pms_hotel(auth.uid(), hotel_id, NULL));

-- Applies one booking revision atomically. Each booked room becomes one
-- HotelCare reservation row (source = 'channex', source_reservation_id = room key).
-- Rows already checked in at HotelCare are never changed: the revision is kept
-- as a review case for the front office instead.
CREATE OR REPLACE FUNCTION public.channex_apply_booking_revision(_hotel_id text, _revision jsonb, _received_via text DEFAULT 'feed')
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  a jsonb := COALESCE(_revision->'attributes', _revision);
  v_rev text := COALESCE(_revision->>'id', a->>'id');
  v_booking text := a->>'booking_id';
  v_status text := lower(COALESCE(a->>'status', 'new'));
  v_property text := a->>'property_id';
  v_org text;
  v_conn record;
  v_guest uuid;
  v_room jsonb;
  v_idx int;
  v_key text;
  v_keys text[] := '{}';
  v_rt uuid;
  v_rp uuid;
  v_in date;
  v_out date;
  v_amount numeric;
  v_existing record;
  v_res_id uuid;
  v_ids uuid[] := '{}';
  v_review text[] := '{}';
  v_ota text := COALESCE(NULLIF(a->>'ota_name', ''), 'Channex');
  v_customer jsonb := COALESCE(a->'customer', '{}'::jsonb);
  v_payload jsonb;
BEGIN
  IF v_rev IS NULL OR v_booking IS NULL THEN
    RAISE EXCEPTION 'Revision without id or booking_id';
  END IF;
  SELECT * INTO v_conn FROM public.channex_connections WHERE hotel_id = _hotel_id;
  IF NOT FOUND OR v_conn.channex_property_id::text IS DISTINCT FROM v_property THEN
    RAISE EXCEPTION 'Revision property % does not belong to hotel %', v_property, _hotel_id;
  END IF;
  IF NOT public.pms_ari_native_hotel(_hotel_id) THEN
    RAISE EXCEPTION 'Hotel % is not a native HotelCare hotel', _hotel_id;
  END IF;

  -- Idempotency: a revision is applied once.
  IF EXISTS (SELECT 1 FROM public.channex_booking_revisions WHERE revision_id = v_rev AND applied_at IS NOT NULL) THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'revision_id', v_rev);
  END IF;

  SELECT o.slug INTO v_org FROM public.hotel_configurations hc JOIN public.organizations o ON o.id = hc.organization_id
   WHERE hc.hotel_id = _hotel_id;

  -- Never store card data.
  v_payload := _revision #- '{attributes,guarantee}' #- '{guarantee}';

  -- Guest: reuse the guest of an earlier revision of the same booking, else create.
  SELECT guest_id INTO v_guest FROM public.reservations
   WHERE hotel_id = _hotel_id AND source = 'channex' AND pms_reservation_id = v_booking AND guest_id IS NOT NULL
   LIMIT 1;
  IF v_guest IS NULL THEN
    INSERT INTO public.guests (first_name, last_name, email, phone, country, nationality, hotel_id, organization_slug, notes)
    VALUES (COALESCE(NULLIF(v_customer->>'name', ''), 'Guest'),
            COALESCE(NULLIF(v_customer->>'surname', ''), v_booking),
            NULLIF(v_customer->>'mail', ''), NULLIF(v_customer->>'phone', ''),
            NULLIF(v_customer->>'country', ''), NULLIF(v_customer->>'country', ''),
            _hotel_id, v_org, 'Created from ' || v_ota || ' booking ' || COALESCE(a->>'ota_reservation_code', v_booking))
    RETURNING id INTO v_guest;
  ELSE
    UPDATE public.guests SET
      email = COALESCE(NULLIF(v_customer->>'mail', ''), email),
      phone = COALESCE(NULLIF(v_customer->>'phone', ''), phone),
      updated_at = now()
     WHERE id = v_guest;
  END IF;

  IF v_status <> 'cancelled' THEN
    FOR v_room, v_idx IN SELECT value, ordinality::int FROM jsonb_array_elements(COALESCE(a->'rooms', '[]'::jsonb)) WITH ORDINALITY LOOP
      v_key := COALESCE(NULLIF(v_room->>'booking_room_id', ''), v_booking || ':' || v_idx);
      v_keys := v_keys || v_key;
      SELECT local_id::uuid INTO v_rt FROM public.channex_mappings
       WHERE hotel_id = _hotel_id AND kind = 'room_type' AND channex_id::text = v_room->>'room_type_id';
      SELECT local_id::uuid INTO v_rp FROM public.channex_mappings
       WHERE hotel_id = _hotel_id AND kind = 'rate_plan' AND channex_id::text = v_room->>'rate_plan_id';
      IF v_rt IS NULL THEN
        v_review := array_append(v_review, ('Unmapped Channex room type ' || COALESCE(v_room->>'room_type_id', '?'))::text);
      END IF;
      v_in := COALESCE((v_room->>'checkin_date')::date, (a->>'arrival_date')::date);
      v_out := COALESCE((v_room->>'checkout_date')::date, (a->>'departure_date')::date);
      v_amount := NULLIF(v_room->>'amount', '')::numeric;

      SELECT id, actual_check_in, check_in_date, check_out_date, room_type_id INTO v_existing
        FROM public.reservations
       WHERE hotel_id = _hotel_id AND source = 'channex' AND source_reservation_id = v_key;

      IF v_existing.id IS NOT NULL AND v_existing.actual_check_in IS NOT NULL THEN
        IF (v_existing.check_in_date, v_existing.check_out_date, v_existing.room_type_id) IS DISTINCT FROM (v_in, v_out, v_rt) THEN
          v_review := array_append(v_review, ('Booking changed after check-in (room ' || v_key || ')')::text);
        END IF;
        v_ids := v_ids || v_existing.id;
        CONTINUE;
      END IF;

      IF v_existing.id IS NOT NULL THEN
        UPDATE public.reservations SET
          check_in_date = v_in, check_out_date = v_out,
          adults = COALESCE((v_room->'occupancy'->>'adults')::int, adults),
          children = COALESCE((v_room->'occupancy'->>'children')::int, 0),
          room_type_id = v_rt,
          room_type_requested = (SELECT name FROM public.room_types WHERE id = v_rt),
          room_id = CASE WHEN v_existing.room_type_id IS DISTINCT FROM v_rt THEN NULL ELSE room_id END,
          total_amount = v_amount,
          rate_per_night = CASE WHEN v_amount IS NOT NULL AND v_out > v_in THEN round(v_amount / (v_out - v_in), 2) END,
          currency = COALESCE(a->>'currency', currency),
          status = 'confirmed', cancelled_at = NULL, cancellation_reason = NULL,
          pms_rate_plan_id = v_rp::text, pms_channel = v_ota,
          pms_voucher = a->>'ota_reservation_code',
          special_requests = NULLIF(a->>'notes', ''),
          guest_id = v_guest,
          pms_guest_name = trim(COALESCE(v_customer->>'name', '') || ' ' || COALESCE(v_customer->>'surname', '')),
          updated_at = now()
        WHERE id = v_existing.id
        RETURNING id INTO v_res_id;
      ELSE
        INSERT INTO public.reservations (
          hotel_id, organization_slug, guest_id, check_in_date, check_out_date, adults, children,
          room_type_id, room_type_requested, total_amount, rate_per_night, currency, status, source,
          source_reservation_id, pms_reservation_id, pms_room_reservation_id, pms_rate_plan_id,
          pms_channel, pms_voucher, special_requests, pms_guest_name, payment_status)
        VALUES (
          _hotel_id, v_org, v_guest, v_in, v_out,
          COALESCE((v_room->'occupancy'->>'adults')::int, 1), COALESCE((v_room->'occupancy'->>'children')::int, 0),
          v_rt, (SELECT name FROM public.room_types WHERE id = v_rt), v_amount,
          CASE WHEN v_amount IS NOT NULL AND v_out > v_in THEN round(v_amount / (v_out - v_in), 2) END,
          COALESCE(a->>'currency', v_conn.currency), 'confirmed', 'channex',
          v_key, v_booking, v_key, v_rp::text, v_ota, a->>'ota_reservation_code', NULLIF(a->>'notes', ''),
          trim(COALESCE(v_customer->>'name', '') || ' ' || COALESCE(v_customer->>'surname', '')), 'unpaid')
        RETURNING id INTO v_res_id;
      END IF;
      v_ids := v_ids || v_res_id;
    END LOOP;
  END IF;

  -- Rooms no longer in the booking (or the whole booking when cancelled).
  FOR v_existing IN
    SELECT id, actual_check_in FROM public.reservations
     WHERE hotel_id = _hotel_id AND source = 'channex' AND pms_reservation_id = v_booking
       AND status NOT IN ('cancelled', 'checked_out')
       AND (v_status = 'cancelled' OR NOT (source_reservation_id = ANY (v_keys)))
  LOOP
    IF v_existing.actual_check_in IS NOT NULL THEN
      v_review := array_append(v_review, 'Cancellation for a guest already checked in'::text);
      CONTINUE;
    END IF;
    UPDATE public.reservations SET status = 'cancelled', cancelled_at = now(),
           cancellation_reason = 'Cancelled via ' || v_ota, updated_at = now()
     WHERE id = v_existing.id;
    v_ids := v_ids || v_existing.id;
  END LOOP;

  INSERT INTO public.channex_booking_revisions (revision_id, booking_id, property_id, hotel_id, status, ota_name,
         ota_reservation_code, arrival_date, departure_date, payload, received_via, applied_at, reservation_ids,
         review_required, review_reason)
  VALUES (v_rev, v_booking, v_property, _hotel_id, v_status, v_ota, a->>'ota_reservation_code',
          (a->>'arrival_date')::date, (a->>'departure_date')::date, v_payload, _received_via, now(), v_ids,
          cardinality(v_review) > 0, NULLIF(array_to_string(v_review, '; '), ''))
  ON CONFLICT (revision_id) DO UPDATE SET applied_at = now(), apply_error = NULL, reservation_ids = EXCLUDED.reservation_ids,
         review_required = EXCLUDED.review_required, review_reason = EXCLUDED.review_reason, payload = EXCLUDED.payload;

  RETURN jsonb_build_object('ok', true, 'revision_id', v_rev, 'booking_id', v_booking, 'status', v_status,
                            'reservation_ids', to_jsonb(v_ids), 'review_required', cardinality(v_review) > 0,
                            'review_reason', array_to_string(v_review, '; '));
END;
$$;
REVOKE ALL ON FUNCTION public.channex_apply_booking_revision(text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.channex_apply_booking_revision(text, jsonb, text) TO service_role;

-- 9. Worker / webhook secrets -----------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'channex_integration_worker_secret') THEN
    PERFORM vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'channex_integration_worker_secret');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'channex_webhook_secret') THEN
    PERFORM vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'channex_webhook_secret');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.get_channex_integration_secrets()
RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = public, vault
AS $$
  SELECT jsonb_build_object(
    'worker', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'channex_integration_worker_secret' LIMIT 1),
    'webhook', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'channex_webhook_secret' LIMIT 1));
$$;
REVOKE ALL ON FUNCTION public.get_channex_integration_secrets() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_channex_integration_secrets() TO service_role;

-- 10. Schedules -------------------------------------------------------------
--   * ARI worker every minute: drains whatever the UI-triggered push did not
--     (retries after 429/5xx, edits made while a send was in flight).
--     This is a queue drain, not a sync: with an empty outbox it sends nothing.
--   * Booking feed every 10 minutes: backstop for missed webhooks.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'channex-ari-drain-1min') THEN
      PERFORM cron.unschedule('channex-ari-drain-1min');
    END IF;
    PERFORM cron.schedule('channex-ari-drain-1min', '* * * * *', $cron$
      SELECT net.http_post(
        url := 'https://pcmszqqklkolvvlabohq.supabase.co/functions/v1/channex-ari-worker',
        headers := jsonb_build_object('Content-Type', 'application/json',
                                      'x-worker-secret', public.get_channex_integration_secrets()->>'worker'),
        body := jsonb_build_object('action', 'drain', 'trigger', 'cron'),
        timeout_milliseconds := 55000) AS request_id;
    $cron$);

    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'channex-booking-feed-10min') THEN
      PERFORM cron.unschedule('channex-booking-feed-10min');
    END IF;
    PERFORM cron.schedule('channex-booking-feed-10min', '7-59/10 * * * *', $cron$
      SELECT net.http_post(
        url := 'https://pcmszqqklkolvvlabohq.supabase.co/functions/v1/channex-booking-worker',
        headers := jsonb_build_object('Content-Type', 'application/json',
                                      'x-worker-secret', public.get_channex_integration_secrets()->>'worker'),
        body := jsonb_build_object('action', 'poll', 'trigger', 'cron'),
        timeout_milliseconds := 55000) AS request_id;
    $cron$);
  END IF;
END $$;
