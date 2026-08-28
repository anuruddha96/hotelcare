CREATE TABLE IF NOT EXISTS public.revenue_soldout_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL,
  organization_slug text NOT NULL,
  room_type_name text NOT NULL,
  stay_date date NOT NULL,
  occupancy integer NOT NULL,
  price numeric NOT NULL,
  currency text NOT NULL DEFAULT 'EUR',
  captured_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.revenue_soldout_prices TO authenticated;
GRANT ALL ON public.revenue_soldout_prices TO service_role;

ALTER TABLE public.revenue_soldout_prices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff read sold-out prices for their hotels"
ON public.revenue_soldout_prices FOR SELECT TO authenticated
USING (public.user_can_access_hotel(auth.uid(), hotel_id));

CREATE UNIQUE INDEX IF NOT EXISTS revenue_soldout_prices_active_uq
  ON public.revenue_soldout_prices (hotel_id, room_type_name, stay_date, occupancy)
  WHERE released_at IS NULL;

CREATE INDEX IF NOT EXISTS revenue_soldout_prices_lookup
  ON public.revenue_soldout_prices (hotel_id, stay_date);

CREATE TRIGGER revenue_soldout_prices_updated_at
BEFORE UPDATE ON public.revenue_soldout_prices
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Capture / release sold-out closing prices for one hotel.
CREATE OR REPLACE FUNCTION public.capture_revenue_soldout_prices(_hotel_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org text;
  v_from date := (now() AT TIME ZONE 'Europe/Budapest')::date;
  v_to date := v_from + 365;
BEGIN
  SELECT o.slug INTO v_org
  FROM public.hotel_configurations h
  JOIN public.organizations o ON o.id = h.organization_id
  WHERE h.hotel_id = _hotel_id;
  IF v_org IS NULL THEN RETURN; END IF;

  CREATE TEMP TABLE _left_now ON COMMIT DROP AS
  WITH days AS (
    SELECT generate_series(v_from, v_to, interval '1 day')::date AS stay_date
  ),
  types AS (
    SELECT name, COALESCE(num_rooms, 0) AS num_rooms
    FROM public.room_types
    WHERE hotel_id = _hotel_id
      AND COALESCE(is_sellable, true)
      AND COALESCE(counts_toward_inventory, true)
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

  -- Freeze the live price the first time a room type/date has nothing left.
  INSERT INTO public.revenue_soldout_prices (
    hotel_id, organization_slug, room_type_name, stay_date, occupancy, price, currency
  )
  SELECT _hotel_id, v_org, r.room_type_name, r.stay_date, r.occupancy, r.price,
         COALESCE(r.currency, 'EUR')
  FROM (
    SELECT DISTINCT ON (rr.stay_date, rr.room_type_name, rr.occupancy)
           rr.stay_date, rr.room_type_name, rr.occupancy, rr.price, rr.currency
    FROM public.revenue_room_type_rates rr
    JOIN _left_now l
      ON l.room_type_name = rr.room_type_name AND l.stay_date = rr.stay_date
    WHERE rr.hotel_id = _hotel_id
      AND rr.stay_date BETWEEN v_from AND v_to
      AND l.rooms_left = 0
      AND rr.price IS NOT NULL
    ORDER BY rr.stay_date, rr.room_type_name, rr.occupancy,
             rr.captured_at DESC, rr.updated_at DESC
  ) r
  ON CONFLICT DO NOTHING;

  -- A cancellation reopened the date: release the frozen record so a later
  -- sell-out captures a fresh closing price.
  UPDATE public.revenue_soldout_prices sp
  SET released_at = now()
  FROM _left_now l
  WHERE sp.hotel_id = _hotel_id
    AND sp.released_at IS NULL
    AND l.room_type_name = sp.room_type_name
    AND l.stay_date = sp.stay_date
    AND l.rooms_left > 0;

  DROP TABLE IF EXISTS _left_now;
END;
$$;

REVOKE ALL ON FUNCTION public.capture_revenue_soldout_prices(text) FROM public;
GRANT EXECUTE ON FUNCTION public.capture_revenue_soldout_prices(text) TO service_role;
