-- A sold-out room type/date has one closing sale, not one closing price per
-- possible guest count. Freeze the reservation that consumed the final unit so
-- Revenue shows the real last sold amount and the guest count that bought it.

-- Archive the old occupancy-ladder snapshots. They were generated once per
-- guest level and therefore cannot identify which occupancy actually sold last.
UPDATE public.revenue_soldout_prices
SET released_at = now(), updated_at = now()
WHERE released_at IS NULL;

-- Enforce the invariant at database level: at most one active closing sale for
-- a room type on a stay date.
DROP INDEX IF EXISTS public.revenue_soldout_prices_active_uq;
CREATE UNIQUE INDEX revenue_soldout_prices_active_uq
  ON public.revenue_soldout_prices (hotel_id, room_type_name, stay_date)
  WHERE released_at IS NULL;

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

  CREATE TEMP TABLE _left_now ON COMMIT DROP AS
  WITH days AS (
    SELECT generate_series(v_from, v_to, interval '1 day')::date AS stay_date
  ),
  types AS (
    -- Row-level availability must include real PMS products even when a tenant
    -- intentionally excludes them from the consolidated house denominator.
    -- SLNT apartment products are one example. Group duplicate labels so the
    -- name-keyed reservation/rate model still has one inventory row.
    SELECT name, sum(GREATEST(COALESCE(num_rooms, 0), 0))::int AS num_rooms
    FROM public.room_types
    WHERE hotel_id = _hotel_id
      AND NULLIF(trim(COALESCE(pms_room_id, '')), '') IS NOT NULL
      AND COALESCE(num_rooms, 0) > 0
    GROUP BY name
  ),
  sold AS (
    SELECT room_type_name, stay_date, count(*)::int AS sold
    FROM public.revenue_booking_nights
    WHERE hotel_id = _hotel_id AND stay_date BETWEEN v_from AND v_to
    GROUP BY room_type_name, stay_date
  )
  SELECT t.name AS room_type_name,
         d.stay_date,
         GREATEST(0, t.num_rooms - COALESCE(s.sold, 0)) AS rooms_left
  FROM types t
  CROSS JOIN days d
  LEFT JOIN sold s ON s.room_type_name = t.name AND s.stay_date = d.stay_date;

  -- A cancellation, remapping, or inventory correction reopened the date.
  -- Release any prior closing sale. A later sell-out will create a fresh one.
  UPDATE public.revenue_soldout_prices sp
  SET released_at = now(), updated_at = now()
  WHERE sp.hotel_id = _hotel_id
    AND sp.released_at IS NULL
    AND sp.stay_date BETWEEN v_from AND v_to
    AND NOT EXISTS (
      SELECT 1
      FROM _left_now l
      WHERE l.room_type_name = sp.room_type_name
        AND l.stay_date = sp.stay_date
        AND l.rooms_left = 0
    );

  -- For every room type/date that is truly sold out, the newest active booking
  -- is the reservation that consumed the final available unit. Its nightly
  -- amount is the actual last sold price and its guest count is the sold
  -- occupancy. The reservation price is already normalized to the property's
  -- base currency by the revenue sync.
  WITH last_booking AS (
    SELECT DISTINCT ON (b.room_type_name, b.stay_date)
           b.room_type_name,
           b.stay_date,
           GREATEST(1, COALESCE(b.guests, 1))::int AS occupancy,
           NULLIF(b.nightly_price_eur, 0) AS sold_price,
           b.created_at_pms,
           b.captured_at,
           b.id
    FROM public.revenue_booking_nights b
    JOIN _left_now l
      ON l.room_type_name = b.room_type_name
     AND l.stay_date = b.stay_date
     AND l.rooms_left = 0
    WHERE b.hotel_id = _hotel_id
      AND b.stay_date BETWEEN v_from AND v_to
    ORDER BY b.room_type_name, b.stay_date,
             b.created_at_pms DESC NULLS LAST,
             b.captured_at DESC NULLS LAST,
             b.id DESC
  )
  INSERT INTO public.revenue_soldout_prices (
    hotel_id, organization_slug, room_type_name, stay_date,
    occupancy, price, currency
  )
  SELECT _hotel_id,
         v_org,
         b.room_type_name,
         b.stay_date,
         b.occupancy,
         COALESCE(b.sold_price, fallback.price),
         COALESCE(v_currency, fallback.currency, 'EUR')
  FROM last_booking b
  LEFT JOIN LATERAL (
    SELECT rr.price, rr.currency
    FROM public.revenue_room_type_rates rr
    WHERE rr.hotel_id = _hotel_id
      AND rr.room_type_name = b.room_type_name
      AND rr.stay_date = b.stay_date
    ORDER BY CASE WHEN rr.occupancy = b.occupancy THEN 0 ELSE 1 END,
             abs(rr.occupancy - b.occupancy),
             rr.captured_at DESC NULLS LAST,
             rr.updated_at DESC NULLS LAST
    LIMIT 1
  ) fallback ON true
  WHERE COALESCE(b.sold_price, fallback.price) IS NOT NULL
    AND COALESCE(b.sold_price, fallback.price) > 0
  ON CONFLICT DO NOTHING;

  DROP TABLE IF EXISTS _left_now;
END;
$function$;

-- Rebuild current/future active closing sales immediately so published payloads
-- can be refreshed without waiting for the next scheduled PMS sync.
DO $rebuild$
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
$rebuild$;
