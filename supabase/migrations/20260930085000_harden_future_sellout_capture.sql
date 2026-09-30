-- Harden sold-out capture so the Revenue calendar never reconstructs a
-- "last sold" price from a reservation-average after the fact.
--
-- From this migration onward a closing price is written ONLY when HotelCare
-- observes a real inventory transition from rooms-left > 0 to rooms-left = 0.
-- The displayed price is the live Previo rate for the guest count that caused
-- that transition, captured in the same completed revenue sync. Existing
-- reconstructed rows are retained for audit but released from the live payload.

ALTER TABLE public.revenue_soldout_prices
  ADD COLUMN IF NOT EXISTS capture_method text NOT NULL DEFAULT 'legacy_reconstructed',
  ADD COLUMN IF NOT EXISTS source_res_id text,
  ADD COLUMN IF NOT EXISTS source_room_key text,
  ADD COLUMN IF NOT EXISTS source_obk_id text,
  ADD COLUMN IF NOT EXISTS source_rate_plan_id text,
  ADD COLUMN IF NOT EXISTS source_booking_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS source_rate_captured_at timestamptz,
  ADD COLUMN IF NOT EXISTS reservation_nightly_price numeric;

COMMENT ON COLUMN public.revenue_soldout_prices.capture_method IS
  'transition_pms_rate = exact future capture at open->sold-out transition; legacy_reconstructed = pre-migration estimate.';

-- Persistent previous-publish state. Reservation counts are stored per res_id
-- (not room_key, which Previo can change) so a moved/extended/multi-room booking
-- can be identified as the inventory increment that closed the date.
CREATE TABLE IF NOT EXISTS public.revenue_sellout_state (
  hotel_id text NOT NULL,
  room_type_name text NOT NULL,
  stay_date date NOT NULL,
  rooms_left integer NOT NULL CHECK (rooms_left >= 0),
  reservation_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hotel_id, room_type_name, stay_date)
);

ALTER TABLE public.revenue_sellout_state ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS revenue_sellout_state_hotel_date_idx
  ON public.revenue_sellout_state (hotel_id, stay_date);

-- All active rows created before this migration were reconstructed from the
-- newest reservation average, which is not the same thing as the PMS rate that
-- was published when the final room sold. Stop presenting them as exact facts.
UPDATE public.revenue_soldout_prices
SET released_at = COALESCE(released_at, now()),
    updated_at = now(),
    capture_method = 'legacy_reconstructed'
WHERE released_at IS NULL
  AND capture_method <> 'transition_pms_rate';

CREATE OR REPLACE FUNCTION public.capture_revenue_soldout_prices(_hotel_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org text;
  v_currency text;
  v_from date := (now() AT TIME ZONE 'Europe/Budapest')::date;
  v_to date := v_from + 365;
BEGIN
  SELECT o.slug INTO v_org
  FROM public.hotel_configurations h
  JOIN public.organizations o ON o.id = h.organization_id
  WHERE h.hotel_id = _hotel_id;
  IF v_org IS NULL THEN RETURN; END IF;

  SELECT upper(COALESCE(base_currency, 'EUR')) INTO v_currency
  FROM public.hotel_revenue_settings
  WHERE hotel_id = _hotel_id;
  v_currency := COALESCE(v_currency, 'EUR');

  DROP TABLE IF EXISTS pg_temp._sellout_now;
  CREATE TEMP TABLE _sellout_now ON COMMIT DROP AS
  WITH days AS (
    SELECT generate_series(v_from, v_to, interval '1 day')::date AS stay_date
  ),
  types AS (
    SELECT name AS room_type_name,
           sum(GREATEST(COALESCE(num_rooms, 0), 0))::int AS num_rooms
    FROM public.room_types
    WHERE hotel_id = _hotel_id
      AND NULLIF(trim(COALESCE(pms_room_id, '')), '') IS NOT NULL
      AND COALESCE(num_rooms, 0) > 0
    GROUP BY name
  ),
  by_res AS (
    SELECT room_type_name,
           stay_date,
           COALESCE(res_id, '__null__') AS res_id_key,
           count(*)::int AS room_count
    FROM public.revenue_booking_nights
    WHERE hotel_id = _hotel_id
      AND stay_date BETWEEN v_from AND v_to
    GROUP BY room_type_name, stay_date, COALESCE(res_id, '__null__')
  ),
  sold AS (
    SELECT room_type_name,
           stay_date,
           sum(room_count)::int AS sold,
           jsonb_object_agg(res_id_key, room_count) AS reservation_counts
    FROM by_res
    GROUP BY room_type_name, stay_date
  )
  SELECT t.room_type_name,
         d.stay_date,
         t.num_rooms,
         COALESCE(s.sold, 0)::int AS sold,
         GREATEST(0, t.num_rooms - COALESCE(s.sold, 0))::int AS rooms_left,
         COALESCE(s.reservation_counts, '{}'::jsonb) AS reservation_counts
  FROM types t
  CROSS JOIN days d
  LEFT JOIN sold s
    ON s.room_type_name = t.room_type_name
   AND s.stay_date = d.stay_date;

  -- If inventory reopened, the old closing snapshot is no longer the current
  -- sell-out event. Preserve it historically and allow a later re-sell-out to
  -- create a new exact snapshot.
  UPDATE public.revenue_soldout_prices sp
  SET released_at = now(), updated_at = now()
  WHERE sp.hotel_id = _hotel_id
    AND sp.released_at IS NULL
    AND sp.stay_date BETWEEN v_from AND v_to
    AND NOT EXISTS (
      SELECT 1
      FROM _sellout_now n
      WHERE n.room_type_name = sp.room_type_name
        AND n.stay_date = sp.stay_date
        AND n.rooms_left = 0
    );

  -- Capture only a REAL transition that we observed between two completed
  -- published states. A brand-new baseline that is already sold out is never
  -- guessed/reconstructed.
  WITH transitions AS (
    SELECT n.room_type_name,
           n.stay_date,
           n.reservation_counts AS current_counts,
           p.reservation_counts AS previous_counts
    FROM _sellout_now n
    JOIN public.revenue_sellout_state p
      ON p.hotel_id = _hotel_id
     AND p.room_type_name = n.room_type_name
     AND p.stay_date = n.stay_date
    WHERE p.rooms_left > 0
      AND n.rooms_left = 0
  ),
  closing_booking AS (
    SELECT DISTINCT ON (t.room_type_name, t.stay_date)
           t.room_type_name,
           t.stay_date,
           b.res_id,
           b.room_key,
           b.obk_id,
           GREATEST(1, COALESCE(b.guests, 1))::int AS occupancy,
           b.created_at_pms,
           b.captured_at AS booking_captured_at,
           b.nightly_price_eur AS reservation_nightly_price,
           b.id
    FROM transitions t
    JOIN public.revenue_booking_nights b
      ON b.hotel_id = _hotel_id
     AND b.room_type_name = t.room_type_name
     AND b.stay_date = t.stay_date
    WHERE COALESCE(
            NULLIF(t.current_counts ->> COALESCE(b.res_id, '__null__'), '')::int,
            0
          )
          >
          COALESCE(
            NULLIF(t.previous_counts ->> COALESCE(b.res_id, '__null__'), '')::int,
            0
          )
    ORDER BY t.room_type_name,
             t.stay_date,
             b.created_at_pms DESC NULLS LAST,
             b.captured_at DESC NULLS LAST,
             b.id DESC
  ),
  exact_closing_rate AS (
    SELECT b.*,
           r.price,
           COALESCE(NULLIF(upper(r.currency), ''), v_currency) AS currency,
           r.rate_plan_id,
           r.captured_at AS rate_captured_at
    FROM closing_booking b
    JOIN LATERAL (
      SELECT rr.price,
             rr.currency,
             rr.rate_plan_id,
             rr.captured_at,
             rr.updated_at
      FROM public.revenue_room_type_rates rr
      WHERE rr.hotel_id = _hotel_id
        AND rr.stay_date = b.stay_date
        AND rr.occupancy = b.occupancy
        AND (
          (b.obk_id IS NOT NULL AND rr.obk_id = b.obk_id)
          OR
          (b.obk_id IS NULL AND rr.room_type_name = b.room_type_name)
        )
        AND rr.price IS NOT NULL
        AND rr.price > 0
      ORDER BY rr.captured_at DESC NULLS LAST,
               rr.updated_at DESC NULLS LAST
      LIMIT 1
    ) r ON true
  )
  INSERT INTO public.revenue_soldout_prices (
    hotel_id,
    organization_slug,
    room_type_name,
    stay_date,
    occupancy,
    price,
    currency,
    captured_at,
    capture_method,
    source_res_id,
    source_room_key,
    source_obk_id,
    source_rate_plan_id,
    source_booking_created_at,
    source_rate_captured_at,
    reservation_nightly_price
  )
  SELECT _hotel_id,
         v_org,
         e.room_type_name,
         e.stay_date,
         e.occupancy,
         e.price,
         e.currency,
         now(),
         'transition_pms_rate',
         e.res_id,
         e.room_key,
         e.obk_id,
         e.rate_plan_id,
         e.created_at_pms,
         e.rate_captured_at,
         e.reservation_nightly_price
  FROM exact_closing_rate e
  ON CONFLICT DO NOTHING;

  -- This becomes the comparison baseline for the NEXT completed revenue sync.
  INSERT INTO public.revenue_sellout_state (
    hotel_id, room_type_name, stay_date, rooms_left, reservation_counts, updated_at
  )
  SELECT _hotel_id,
         n.room_type_name,
         n.stay_date,
         n.rooms_left,
         n.reservation_counts,
         now()
  FROM _sellout_now n
  ON CONFLICT (hotel_id, room_type_name, stay_date) DO UPDATE SET
    rooms_left = EXCLUDED.rooms_left,
    reservation_counts = EXCLUDED.reservation_counts,
    updated_at = now();

  DELETE FROM public.revenue_sellout_state s
  WHERE s.hotel_id = _hotel_id
    AND (
      s.stay_date < v_from
      OR s.stay_date > v_to
      OR NOT EXISTS (
        SELECT 1
        FROM _sellout_now n
        WHERE n.room_type_name = s.room_type_name
          AND n.stay_date = s.stay_date
      )
    );

  DROP TABLE IF EXISTS pg_temp._sellout_now;
END;
$function$;

-- Seed a trustworthy baseline for every configured property without creating
-- any reconstructed closing prices. From the next genuine open->sold-out move
-- onward, capture_revenue_soldout_prices records the exact PMS rate + occupancy.
DO $baseline$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT DISTINCT hotel_id
    FROM public.room_types
    WHERE hotel_id IS NOT NULL
  LOOP
    PERFORM public.capture_revenue_soldout_prices(r.hotel_id);
  END LOOP;
END;
$baseline$;

-- Remove legacy sold-out amounts from already-published JSON immediately while
-- preserving each property's real last-sync timestamp/name.
DO $refresh$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT hotel_id, sync_completed_at, sync_completed_by_name
    FROM public.revenue_published_payloads
  LOOP
    PERFORM public.refresh_revenue_published_payload(
      r.hotel_id,
      r.sync_completed_at,
      r.sync_completed_by_name
    );
  END LOOP;
END;
$refresh$;
