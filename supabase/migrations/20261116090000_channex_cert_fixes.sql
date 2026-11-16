-- Channex certification fixes (re-certification after the 2026-11-16 review):
--
-- 1. Availability change signals become room-type scoped, so an edit to one
--    room type's dates publishes ONLY those (room type, date) cells instead of
--    every room type across the union span ("Multiple Date Availability
--    Update" failure: covered 15 days / both rooms, expected 7-8 days / one).
--    room_type_id NULL still means "all room types" (safe fallback).
-- 2. HotelCare's single "Min stay" is written to BOTH min_stay_arrival and
--    min_stay_through (Channex supports both; the review warned when only
--    arrival was sent).
-- 3. The full-sync source emits every active mapped rate plan for every date,
--    even when no price is known ("Full Data Update" failure: restrictions
--    had no data for 2 of 4 rate plans). Price stays NULL-able; the sender
--    includes the rate field only when a positive price exists.

-- 1a. Column ----------------------------------------------------------------
ALTER TABLE public.channex_availability_dirty
  ADD COLUMN IF NOT EXISTS room_type_id uuid;
COMMENT ON COLUMN public.channex_availability_dirty.room_type_id IS
  'Local room_types.id the signal is scoped to; NULL = all room types of the hotel.';

-- 1b. Rooms-to-sell edits carry their room type ------------------------------
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
  INSERT INTO public.channex_availability_dirty (hotel_id, room_type_id, date_from, date_to, reason)
  VALUES (NEW.hotel_id, NEW.room_type_id, NEW.date, NEW.date, 'hotelcare_rooms_to_sell');
  RETURN NEW;
END;
$$;

-- 1c. Reservation changes carry their room type when it is determinable ------
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
  v_type_new uuid;
  v_type_old uuid;
  v_room_type uuid;
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

  -- Scope the signal to the reservation's room type where it can be resolved;
  -- a move between room types (or an unresolvable type) publishes all types.
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    v_type_new := COALESCE(NEW.room_type_id,
      (SELECT rt.id FROM public.rooms ro JOIN public.room_types rt
         ON rt.hotel_id = v_hotel AND rt.name = ro.room_type
        WHERE ro.id = NEW.room_id LIMIT 1),
      (SELECT rt.id FROM public.room_types rt
        WHERE rt.hotel_id = v_hotel AND rt.name = NEW.room_type_requested LIMIT 1));
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    v_type_old := COALESCE(OLD.room_type_id,
      (SELECT rt.id FROM public.rooms ro JOIN public.room_types rt
         ON rt.hotel_id = v_hotel AND rt.name = ro.room_type
        WHERE ro.id = OLD.room_id LIMIT 1),
      (SELECT rt.id FROM public.room_types rt
        WHERE rt.hotel_id = v_hotel AND rt.name = OLD.room_type_requested LIMIT 1));
  END IF;
  v_room_type := CASE
    WHEN TG_OP = 'INSERT' THEN v_type_new
    WHEN TG_OP = 'DELETE' THEN v_type_old
    WHEN v_type_new IS NOT DISTINCT FROM v_type_old THEN v_type_new
    ELSE NULL
  END;

  INSERT INTO public.channex_availability_dirty (hotel_id, room_type_id, date_from, date_to, reason)
  VALUES (v_hotel, v_room_type, v_from, v_to, 'reservation_' || lower(TG_OP));
  RETURN COALESCE(NEW, OLD);
END;
$$;
REVOKE ALL ON FUNCTION public.channex_mark_availability_dirty() FROM PUBLIC, anon, authenticated;

-- 2. pms_ari_save: one "Min stay" fills both Channex min-stay fields ---------
-- Only the min-stay handling changes; everything else is preserved verbatim.
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

    -- Channex supports min_stay_arrival AND min_stay_through. HotelCare's UI
    -- exposes one "Min stay": when only min_stay_arrival arrives, the same
    -- value is written to min_stay_through so both are always published.
    INSERT INTO public.pms_ari_rates AS t (hotel_id, rate_plan_id, date, rate, min_stay_arrival, min_stay_through,
                                           max_stay, closed_to_arrival, closed_to_departure, stop_sell, updated_by)
    SELECT _hotel_id, (v_item->>'rate_plan_id')::uuid, d::date,
           (v_item->>'rate')::numeric, (v_item->>'min_stay_arrival')::int,
           COALESCE((v_item->>'min_stay_through')::int, (v_item->>'min_stay_arrival')::int),
           (v_item->>'max_stay')::int, (v_item->>'closed_to_arrival')::boolean,
           (v_item->>'closed_to_departure')::boolean, (v_item->>'stop_sell')::boolean, v_uid
      FROM generate_series(v_from, v_to, interval '1 day') d
     WHERE v_days IS NULL OR extract(isodow FROM d)::int = ANY (v_days)
    ON CONFLICT (rate_plan_id, date) DO UPDATE SET
      rate                = CASE WHEN v_item ? 'rate'                THEN EXCLUDED.rate                ELSE t.rate END,
      min_stay_arrival    = CASE WHEN v_item ? 'min_stay_arrival'    THEN EXCLUDED.min_stay_arrival    ELSE t.min_stay_arrival END,
      min_stay_through    = CASE WHEN (v_item ? 'min_stay_through') OR (v_item ? 'min_stay_arrival')
                                 THEN EXCLUDED.min_stay_through      ELSE t.min_stay_through END,
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

-- 3. Full sync covers EVERY active mapped rate plan --------------------------
-- Native branch: no price filter decides inclusion any more; price may be
-- NULL and the sender adds the rate field only when a positive price exists.
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
             COALESCE(r.min_stay_through, r.min_stay_arrival, GREATEST(COALESCE(rp.min_stay, 1), 1)),
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
