-- ============================================================================
-- Native rates & availability for hotels where HotelCare is the PMS
-- (built on 20261113150000_channex_channel_manager).
--
-- The channel manager foundation publishes ARI from change signals:
--   channex_rate_changes (field-level rate/restriction deltas) and
--   channex_availability_dirty (date ranges to recompute), planned and sent by
--   channex-ari-worker with debounce, rate limits, retry and strict ordering.
--
-- For hotels that run on Previo the signals come from the revenue engine.
-- This migration adds the native source for hotels that run on HotelCare:
--   * pms_ari_rates / pms_ari_availability: prices, restrictions and rooms to
--     sell per day, edited in Reception -> Rates & Availability (pms_ari_save).
--   * Row triggers turn each saved change into the same change signals, so a
--     save is published as one Channex request per kind (after the 20 s debounce).
--   * Several rate plans per room type (rate_plans.id -> Channex rate plan).
--   * Full sync reads the native store (500 days, all fields).
--   * Sandbox hotels apply OTA modifications automatically (channex_apply_revision 'modify').
--
-- Gate for this phase: pms_ari_native_hotel() = organization "channex" and
-- hotel_configurations.settings.native_ari = true. RD Hotels, SLNT and all
-- Previo hotels keep their current behaviour.
-- ============================================================================

-- 1. Gate -----------------------------------------------------------------------
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

-- 2. Columns ----------------------------------------------------------------------
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS room_type_id uuid REFERENCES public.room_types(id) ON DELETE SET NULL;
ALTER TABLE public.channex_rate_changes ADD COLUMN IF NOT EXISTS rate_plan_id uuid;
COMMENT ON COLUMN public.channex_rate_changes.rate_plan_id IS
  'HotelCare rate_plans.id for native hotels with several rate plans per room type; NULL = the room type''s single plan.';

-- 3. Native store -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pms_ari_availability (
  hotel_id text NOT NULL,
  room_type_id uuid NOT NULL REFERENCES public.room_types(id) ON DELETE CASCADE,
  date date NOT NULL,
  total_rooms integer NOT NULL DEFAULT 0 CHECK (total_rooms >= 0),
  booked integer NOT NULL DEFAULT 0 CHECK (booked >= 0),
  out_of_order integer NOT NULL DEFAULT 0 CHECK (out_of_order >= 0),
  sell_limit integer CHECK (sell_limit IS NULL OR sell_limit >= 0),
  -- sell_limit = rooms opened for sale (allotment); bookings consume it.
  availability integer GENERATED ALWAYS AS (
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
REVOKE INSERT, UPDATE, DELETE ON public.pms_ari_availability, public.pms_ari_rates FROM anon, authenticated;

-- 4. Availability store from reservations ------------------------------------------
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

-- Keeps the store current for the grid. Publishing itself is signalled by
-- tr_reservations_channex_availability (foundation migration).
CREATE OR REPLACE FUNCTION public.pms_ari_reservation_changed()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_hotel text := COALESCE(NEW.hotel_id, OLD.hotel_id);
BEGIN
  IF v_hotel IS NULL OR NOT public.pms_ari_native_hotel(v_hotel) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  PERFORM set_config('hotelcare.ari_store_refresh', 'on', true);
  PERFORM public.pms_ari_refresh_availability(v_hotel,
    LEAST(COALESCE(NEW.check_in_date, OLD.check_in_date), COALESCE(OLD.check_in_date, NEW.check_in_date)),
    GREATEST(COALESCE(NEW.check_out_date, OLD.check_out_date), COALESCE(OLD.check_out_date, NEW.check_out_date)));
  IF TG_OP = 'UPDATE' AND OLD.hotel_id IS DISTINCT FROM NEW.hotel_id AND OLD.hotel_id IS NOT NULL THEN
    PERFORM public.pms_ari_refresh_availability(OLD.hotel_id, OLD.check_in_date, OLD.check_out_date);
  END IF;
  PERFORM set_config('hotelcare.ari_store_refresh', 'off', true);
  RETURN COALESCE(NEW, OLD);
END;
$$;
DROP TRIGGER IF EXISTS tr_pms_ari_reservation_changed ON public.reservations;
CREATE TRIGGER tr_pms_ari_reservation_changed
AFTER INSERT OR DELETE OR UPDATE OF check_in_date, check_out_date, status, room_id, room_type_id,
                                   room_type_requested, hotel_id, pms_missing_since
ON public.reservations
FOR EACH ROW EXECUTE FUNCTION public.pms_ari_reservation_changed();

-- 5. Saved changes -> channel manager change signals --------------------------------
CREATE OR REPLACE FUNCTION public.pms_ari_rates_capture()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v jsonb := '{}'::jsonb;
  v_conn public.channex_connections%ROWTYPE;
  v_plan record;
BEGIN
  SELECT * INTO v_conn FROM public.channex_connections WHERE hotel_id = NEW.hotel_id AND mode <> 'off';
  IF NOT FOUND OR NOT public.pms_ari_native_hotel(NEW.hotel_id) THEN RETURN NEW; END IF;
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
  IF v = '{}'::jsonb THEN RETURN NEW; END IF;

  SELECT room_type_id, currency INTO v_plan FROM public.rate_plans WHERE id = NEW.rate_plan_id;
  IF v_plan.room_type_id IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.channex_rate_changes (hotel_id, room_type_id, rate_plan_id, stay_date, currency, patch, source)
  VALUES (NEW.hotel_id, v_plan.room_type_id, NEW.rate_plan_id, NEW.date,
          upper(COALESCE(v_plan.currency, v_conn.currency)), v, 'hotelcare_native');
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tr_pms_ari_rates_capture ON public.pms_ari_rates;
CREATE TRIGGER tr_pms_ari_rates_capture
AFTER INSERT OR UPDATE ON public.pms_ari_rates
FOR EACH ROW EXECUTE FUNCTION public.pms_ari_rates_capture();

CREATE OR REPLACE FUNCTION public.pms_ari_availability_capture()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.availability IS NOT DISTINCT FROM OLD.availability THEN RETURN NEW; END IF;
  -- A newly tracked day with all rooms free is what the full sync already sent.
  IF TG_OP = 'INSERT' AND NEW.availability = NEW.total_rooms AND NEW.sell_limit IS NULL THEN RETURN NEW; END IF;
  -- Store refreshes caused by reservations are already signalled by the reservation trigger,
  -- and refreshes during planning / full sync must not create new signals.
  IF current_setting('hotelcare.ari_store_refresh', true) = 'on' THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.channex_connections WHERE hotel_id = NEW.hotel_id AND mode <> 'off') THEN RETURN NEW; END IF;
  IF NEW.date < (now() AT TIME ZONE 'Europe/Budapest')::date THEN RETURN NEW; END IF;
  INSERT INTO public.channex_availability_dirty (hotel_id, date_from, date_to, reason)
  VALUES (NEW.hotel_id, NEW.date, NEW.date, 'hotelcare_rooms_to_sell');
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tr_pms_ari_availability_capture ON public.pms_ari_availability;
CREATE TRIGGER tr_pms_ari_availability_capture
AFTER INSERT OR UPDATE ON public.pms_ari_availability
FOR EACH ROW EXECUTE FUNCTION public.pms_ari_availability_capture();

-- 6. Channel manager read functions: native branch --------------------------------
CREATE OR REPLACE FUNCTION public.channex_room_type_availability(p_hotel_id text, p_from date, p_to date)
RETURNS TABLE (room_type_id uuid, channex_room_type_id uuid, stay_date date, sellable integer, booked integer, availability integer)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  IF public.pms_ari_native_hotel(p_hotel_id) THEN
    PERFORM set_config('hotelcare.ari_store_refresh', 'on', true);
    PERFORM public.pms_ari_refresh_availability(p_hotel_id, p_from, p_to + 1);
    PERFORM set_config('hotelcare.ari_store_refresh', 'off', true);
    RETURN QUERY
      SELECT a.room_type_id, m.channex_id, a.date, a.total_rooms, a.booked, a.availability
        FROM public.pms_ari_availability a
        JOIN public.channex_mappings m ON m.hotel_id = a.hotel_id AND m.kind = 'room_type' AND m.local_id = a.room_type_id
       WHERE a.hotel_id = p_hotel_id AND a.date BETWEEN p_from AND p_to
       ORDER BY a.room_type_id, a.date;
    RETURN;
  END IF;

  RETURN QUERY
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
END;
$$;
REVOKE ALL ON FUNCTION public.channex_room_type_availability(text, date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.channex_room_type_availability(text, date, date) TO service_role;

-- Full sync source. Now one row per Channex rate plan (rate_plan_id set for native hotels),
-- with all restriction fields. Previo hotels: unchanged behaviour (latest revenue price).
DROP FUNCTION IF EXISTS public.channex_full_sync_rates(text, date, date);
CREATE FUNCTION public.channex_full_sync_rates(p_hotel_id text, p_from date, p_to date)
RETURNS TABLE (room_type_id uuid, rate_plan_id uuid, stay_date date, price numeric, currency text, min_stay integer,
               min_stay_through integer, max_stay integer, closed_to_arrival boolean, closed_to_departure boolean, stop_sell boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  IF public.pms_ari_native_hotel(p_hotel_id) THEN
    RETURN QUERY
      SELECT rp.room_type_id, rp.id, d::date,
             COALESCE(r.rate, rp.base_rate)::numeric,
             upper(COALESCE(rp.currency, c.currency)),
             COALESCE(r.min_stay_arrival, GREATEST(COALESCE(rp.min_stay, 1), 1)),
             COALESCE(r.min_stay_through, 1),
             COALESCE(r.max_stay, COALESCE(rp.max_stay, 0)),
             COALESCE(r.closed_to_arrival, false),
             COALESCE(r.closed_to_departure, false),
             COALESCE(r.stop_sell, false)
        FROM public.channex_connections c
        JOIN public.channex_mappings m ON m.hotel_id = c.hotel_id AND m.kind = 'rate_plan'
        JOIN public.rate_plans rp ON rp.id = m.local_id AND rp.hotel_id = c.hotel_id AND COALESCE(rp.is_active, true)
        CROSS JOIN generate_series(p_from, p_to, interval '1 day') d
        LEFT JOIN public.pms_ari_rates r ON r.rate_plan_id = rp.id AND r.date = d::date
       WHERE c.hotel_id = p_hotel_id
         AND COALESCE(r.rate, rp.base_rate) > 0
       ORDER BY rp.id, d;
    RETURN;
  END IF;

  RETURN QUERY
    SELECT DISTINCT ON (rt.id, r.stay_date)
           rt.id, NULL::uuid, r.stay_date, r.price, upper(r.currency), r.min_stay,
           NULL::integer, NULL::integer, r.closed_to_arrival, r.closed_to_departure, NULL::boolean
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
END;
$$;
REVOKE ALL ON FUNCTION public.channex_full_sync_rates(text, date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.channex_full_sync_rates(text, date, date) TO service_role;

-- 7. Reception RPCs ---------------------------------------------------------------
-- _changes = {
--   "availability": [{"room_type_id", "date_from", "date_to" (inclusive), "weekdays": [1..7] optional,
--                     "availability": rooms left to sell | "sell_limit": allotment | null, "out_of_order": int}],
--   "rates":        [{"rate_plan_id", "date_from", "date_to", "weekdays", "rate", "min_stay_arrival",
--                     "min_stay_through", "max_stay", "closed_to_arrival", "closed_to_departure", "stop_sell"}]
-- }
-- Only keys present in an item change; everything else is preserved. One call = one transaction.
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
    PERFORM set_config('hotelcare.ari_store_refresh', 'on', true);
    PERFORM public.pms_ari_refresh_availability(_hotel_id, v_from, v_to + 1);
    PERFORM set_config('hotelcare.ari_store_refresh', 'off', true);
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
    'publishing', EXISTS (SELECT 1 FROM public.channex_connections WHERE hotel_id = _hotel_id AND mode = 'live' AND NOT kill_switch));
END;
$$;
REVOKE ALL ON FUNCTION public.pms_ari_save(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pms_ari_save(text, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.pms_ari_grid(_hotel_id text, _from date, _to date)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_access_pms_hotel(auth.uid(), _hotel_id, NULL) THEN
    RAISE EXCEPTION 'Not allowed for this hotel' USING ERRCODE = '42501';
  END IF;
  IF _to - _from > 62 THEN _to := _from + 62; END IF;
  PERFORM set_config('hotelcare.ari_store_refresh', 'on', true);
  PERFORM public.pms_ari_refresh_availability(_hotel_id, _from, _to + 1);
  PERFORM set_config('hotelcare.ari_store_refresh', 'off', true);
  RETURN jsonb_build_object(
    'native', public.pms_ari_native_hotel(_hotel_id),
    'publishing', EXISTS (SELECT 1 FROM public.channex_connections WHERE hotel_id = _hotel_id AND mode = 'live' AND NOT kill_switch),
    'mode', (SELECT mode FROM public.channex_connections WHERE hotel_id = _hotel_id),
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
    'pending_outbox',
      (SELECT count(*) FROM public.channex_rate_changes WHERE hotel_id = _hotel_id AND processed_at IS NULL)
    + (SELECT count(*) FROM public.channex_availability_dirty WHERE hotel_id = _hotel_id AND processed_at IS NULL)
    + (SELECT count(*) FROM public.channex_ari_outbox WHERE hotel_id = _hotel_id AND status IN ('pending', 'sending'))
  );
END;
$$;
REVOKE ALL ON FUNCTION public.pms_ari_grid(text, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pms_ari_grid(text, date, date) TO authenticated;

-- 8. Booking apply: per-room source ids (multi-room bookings) + sandbox 'modify' ---------
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
  v_keep integer[] := '{}';
  v_cancelled uuid[];
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
          'channex',
          -- one value per room: uq_reservations_hotel_source_ref is unique per hotel/source
          COALESCE(v_rev.ota_reservation_code, v_rev.channex_booking_id)
            || CASE WHEN (v_room->>'room_index')::integer > 0 THEN '-' || (v_room->>'room_index') ELSE '' END,
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

  ELSIF p_action = 'modify' THEN
    -- Sandbox hotels only (decided in the edge function): apply a fully mapped OTA modification
    -- to rooms that are not checked in yet. Anything else becomes a review case.
    IF NOT EXISTS (SELECT 1 FROM public.reservations WHERE channex_booking_id = v_rev.channex_booking_id AND hotel_id = v_rev.hotel_id) THEN
      INSERT INTO public.channex_review_cases (hotel_id, revision_row_id, reason, details)
      VALUES (v_rev.hotel_id, p_revision_row, 'modification_for_unknown_booking', COALESCE(p_review_details, '{}'::jsonb))
      ON CONFLICT (revision_row_id) DO NOTHING;
      UPDATE public.channex_booking_revisions SET state = 'review', updated_at = now() WHERE id = p_revision_row;
      RETURN jsonb_build_object('state', 'review');
    END IF;
    IF EXISTS (SELECT 1 FROM public.reservations WHERE channex_booking_id = v_rev.channex_booking_id AND hotel_id = v_rev.hotel_id
                AND (actual_check_in IS NOT NULL OR status IN ('checked_in', 'checked_out'))) THEN
      SELECT COALESCE(array_agg(id), '{}') INTO v_ids FROM public.reservations
       WHERE channex_booking_id = v_rev.channex_booking_id AND hotel_id = v_rev.hotel_id;
      INSERT INTO public.channex_review_cases (hotel_id, revision_row_id, reservation_ids, reason, details)
      VALUES (v_rev.hotel_id, p_revision_row, v_ids, 'ota_modification_after_check_in', COALESCE(p_review_details, '{}'::jsonb))
      ON CONFLICT (revision_row_id) DO NOTHING;
      UPDATE public.channex_booking_revisions SET state = 'review', reservation_ids = v_ids, updated_at = now() WHERE id = p_revision_row;
      RETURN jsonb_build_object('state', 'review', 'reservation_ids', to_jsonb(v_ids));
    END IF;

    SELECT guest_id INTO v_guest FROM public.reservations
     WHERE channex_booking_id = v_rev.channex_booking_id AND hotel_id = v_rev.hotel_id AND guest_id IS NOT NULL LIMIT 1;
    IF v_guest IS NOT NULL THEN
      UPDATE public.guests SET
        email = COALESCE(NULLIF(p_guest->>'email', ''), email),
        phone = COALESCE(NULLIF(p_guest->>'phone', ''), phone),
        updated_at = now()
       WHERE id = v_guest;
    END IF;

    FOR v_room IN SELECT * FROM jsonb_array_elements(COALESCE(p_rooms, '[]'::jsonb)) LOOP
      v_keep := v_keep || (v_room->>'room_index')::integer;
      UPDATE public.reservations SET
        room_id = CASE WHEN room_type_requested IS DISTINCT FROM v_room->>'room_type_name' THEN NULL ELSE room_id END,
        room_type_requested = v_room->>'room_type_name',
        check_in_date = (v_room->>'check_in_date')::date,
        check_out_date = (v_room->>'check_out_date')::date,
        adults = GREATEST(COALESCE((v_room->>'adults')::integer, 1), 1),
        children = GREATEST(COALESCE((v_room->>'children')::integer, 0), 0),
        rate_per_night = COALESCE((v_room->>'rate_per_night')::numeric, 0),
        total_amount = COALESCE((v_room->>'total_amount')::numeric, 0),
        currency = COALESCE(NULLIF(v_room->>'currency', ''), currency),
        ota_taxes = v_room->'ota_taxes',
        special_requests = COALESCE(NULLIF(v_room->>'notes', ''), special_requests),
        status = 'confirmed', cancelled_at = NULL, cancellation_reason = NULL,
        updated_at = now()
       WHERE channex_booking_id = v_rev.channex_booking_id AND hotel_id = v_rev.hotel_id
         AND channex_room_index = (v_room->>'room_index')::integer
      RETURNING id INTO v_res;
      IF v_res IS NULL THEN
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
          'channex',
          COALESCE(v_rev.ota_reservation_code, v_rev.channex_booking_id)
            || CASE WHEN (v_room->>'room_index')::integer > 0 THEN '-' || (v_room->>'room_index') ELSE '' END,
          trim(COALESCE(p_guest->>'first_name', '') || ' ' || COALESCE(p_guest->>'last_name', '')),
          v_rev.channex_booking_id, (v_room->>'room_index')::integer, v_rev.ota_name, v_rev.ota_reservation_code,
          NULLIF(p_guest->>'payment_collect', ''), v_room->'ota_taxes', NULLIF(v_room->>'notes', '')
        )
        RETURNING id INTO v_res;
      END IF;
      v_ids := v_ids || v_res;
      v_res := NULL;
    END LOOP;

    -- Rooms the OTA removed from the booking.
    WITH upd AS (
      UPDATE public.reservations
         SET status = 'cancelled', cancelled_at = COALESCE(cancelled_at, now()),
             cancellation_reason = 'Room removed on ' || COALESCE(v_rev.ota_name, 'OTA') || ' (via Channex)', updated_at = now()
       WHERE channex_booking_id = v_rev.channex_booking_id AND hotel_id = v_rev.hotel_id
         AND NOT (channex_room_index = ANY (v_keep)) AND status <> 'cancelled'
      RETURNING id
    )
    SELECT COALESCE(array_agg(id), '{}') INTO v_cancelled FROM upd;
    v_ids := v_ids || v_cancelled;

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
