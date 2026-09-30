-- Revenue sold-out cells must show what the final reservation actually paid
-- for that stay date and how many guests were on that reservation.
--
-- The previous transition logic stored the live rate ladder value for the
-- matching occupancy. That is useful as market context, but it is not the same
-- thing as the last SOLD price. revenue_booking_nights.nightly_price_eur is
-- normalized into the property's base currency during PMS sync, while guests
-- carries the occupancy of the reservation itself. Use those two fields as the
-- closing-sale source of truth.

COMMENT ON COLUMN public.revenue_soldout_prices.capture_method IS
  'transition_booking_rate = exact booking-night amount captured on an observed open->sold-out transition; booking_last_sale_backfill = best exact booking record for a date already sold out when transition tracking was introduced; legacy_reconstructed = retired pre-transition estimate.';

-- Correct already-active transition rows that have the closing reservation
-- attached: their reservation_nightly_price is the actual sold amount.
UPDATE public.revenue_soldout_prices sp
SET price = sp.reservation_nightly_price,
    currency = COALESCE(
      (SELECT upper(NULLIF(hrs.base_currency, ''))
       FROM public.hotel_revenue_settings hrs
       WHERE hrs.hotel_id = sp.hotel_id
       LIMIT 1),
      sp.currency,
      'EUR'
    ),
    capture_method = 'transition_booking_rate',
    updated_at = now()
WHERE sp.released_at IS NULL
  AND sp.reservation_nightly_price IS NOT NULL
  AND sp.reservation_nightly_price > 0
  AND sp.capture_method = 'transition_pms_rate';

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

  SELECT upper(COALESCE(NULLIF(base_currency, ''), 'EUR')) INTO v_currency
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

  -- Re-opened inventory releases the prior closing sale. A later transition
  -- back to zero creates a fresh closing-sale record.
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

  -- Find genuine open -> sold-out transitions and identify the reservation
  -- whose count increased in that transition. That reservation is the closing
  -- sale. The booking-night amount is the sold price; do not substitute the
  -- current/highest occupancy rate ladder.
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
    WHERE b.nightly_price_eur IS NOT NULL
      AND b.nightly_price_eur > 0
      AND COALESCE(
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
  closing_sale AS (
    SELECT b.*,
           r.rate_plan_id,
           r.captured_at AS rate_captured_at
    FROM closing_booking b
    LEFT JOIN LATERAL (
      SELECT rr.rate_plan_id, rr.captured_at, rr.updated_at
      FROM public.revenue_room_type_rates rr
      WHERE rr.hotel_id = _hotel_id
        AND rr.stay_date = b.stay_date
        AND rr.occupancy = b.occupancy
        AND (
          (b.obk_id IS NOT NULL AND rr.obk_id = b.obk_id)
          OR
          (b.obk_id IS NULL AND rr.room_type_name = b.room_type_name)
        )
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
         e.reservation_nightly_price,
         v_currency,
         now(),
         'transition_booking_rate',
         e.res_id,
         e.room_key,
         e.obk_id,
         e.rate_plan_id,
         e.created_at_pms,
         e.rate_captured_at,
         e.reservation_nightly_price
  FROM closing_sale e
  ON CONFLICT DO NOTHING;

  -- Persist the completed sync as the baseline for the next transition.
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

-- Dates that were already sold out when transition tracking was introduced do
-- not have an observed >0 -> 0 edge. They do, however, have the PMS booking
-- night that sold last. Backfill those current/future cells from the newest
-- booking record so the UI can show a factual sold price + guest count now.
WITH soldout AS (
  SELECT s.hotel_id, s.room_type_name, s.stay_date
  FROM public.revenue_sellout_state s
  WHERE s.rooms_left = 0
    AND s.stay_date >= (now() AT TIME ZONE 'Europe/Budapest')::date
),
latest_booking AS (
  SELECT DISTINCT ON (b.hotel_id, b.room_type_name, b.stay_date)
         b.hotel_id,
         b.room_type_name,
         b.stay_date,
         b.res_id,
         b.room_key,
         b.obk_id,
         GREATEST(1, COALESCE(b.guests, 1))::int AS occupancy,
         b.nightly_price_eur AS sold_price,
         b.created_at_pms,
         b.captured_at
  FROM soldout s
  JOIN public.revenue_booking_nights b
    ON b.hotel_id = s.hotel_id
   AND b.room_type_name = s.room_type_name
   AND b.stay_date = s.stay_date
  WHERE b.nightly_price_eur IS NOT NULL
    AND b.nightly_price_eur > 0
  ORDER BY b.hotel_id,
           b.room_type_name,
           b.stay_date,
           b.created_at_pms DESC NULLS LAST,
           b.captured_at DESC NULLS LAST,
           b.id DESC
),
missing AS (
  SELECT b.*,
         o.slug AS organization_slug,
         COALESCE(upper(NULLIF(hrs.base_currency, '')), 'EUR') AS base_currency
  FROM latest_booking b
  JOIN public.hotel_configurations hc ON hc.hotel_id = b.hotel_id
  JOIN public.organizations o ON o.id = hc.organization_id
  LEFT JOIN public.hotel_revenue_settings hrs ON hrs.hotel_id = b.hotel_id
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.revenue_soldout_prices sp
    WHERE sp.hotel_id = b.hotel_id
      AND sp.room_type_name = b.room_type_name
      AND sp.stay_date = b.stay_date
      AND sp.released_at IS NULL
  )
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
  source_booking_created_at,
  reservation_nightly_price
)
SELECT hotel_id,
       organization_slug,
       room_type_name,
       stay_date,
       occupancy,
       sold_price,
       base_currency,
       now(),
       'booking_last_sale_backfill',
       res_id,
       room_key,
       obk_id,
       created_at_pms,
       sold_price
FROM missing
ON CONFLICT DO NOTHING;

-- Push corrected sold-out facts into the existing published payloads immediately
-- without changing the recorded PMS sync completion time or operator name.
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
