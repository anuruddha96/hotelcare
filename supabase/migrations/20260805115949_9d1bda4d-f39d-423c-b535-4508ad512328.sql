CREATE TABLE public.revenue_room_type_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL,
  organization_slug text NOT NULL,
  stay_date date NOT NULL,
  obk_id text NOT NULL,
  room_type_name text,
  rate_plan_id text NOT NULL DEFAULT 'base',
  occupancy integer NOT NULL DEFAULT 2,
  price numeric NOT NULL,
  currency text NOT NULL DEFAULT 'EUR',
  min_stay integer,
  closed_to_arrival boolean NOT NULL DEFAULT false,
  closed_to_departure boolean NOT NULL DEFAULT false,
  source text NOT NULL DEFAULT 'previo',
  captured_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, stay_date, obk_id, rate_plan_id, occupancy)
);

GRANT SELECT ON public.revenue_room_type_rates TO authenticated;
GRANT ALL ON public.revenue_room_type_rates TO service_role;
ALTER TABLE public.revenue_room_type_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org staff can read revenue rates"
  ON public.revenue_room_type_rates FOR SELECT TO authenticated
  USING (public.user_can_access_hotel(auth.uid(), hotel_id) OR public.is_revenue_user(auth.uid()));

CREATE TABLE public.revenue_booking_nights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL,
  organization_slug text NOT NULL,
  stay_date date NOT NULL,
  res_id text NOT NULL,
  obk_id text,
  room_type_name text,
  obj_id text,
  status_id integer NOT NULL DEFAULT 0,
  created_at_pms timestamptz,
  nightly_price_eur numeric,
  guests integer,
  captured_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, res_id, stay_date)
);
CREATE INDEX idx_revenue_booking_nights_hotel_date ON public.revenue_booking_nights (hotel_id, stay_date);
CREATE INDEX idx_revenue_booking_nights_created ON public.revenue_booking_nights (hotel_id, created_at_pms);

GRANT SELECT ON public.revenue_booking_nights TO authenticated;
GRANT ALL ON public.revenue_booking_nights TO service_role;
ALTER TABLE public.revenue_booking_nights ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org staff can read revenue booking nights"
  ON public.revenue_booking_nights FOR SELECT TO authenticated
  USING (public.user_can_access_hotel(auth.uid(), hotel_id) OR public.is_revenue_user(auth.uid()));

CREATE TABLE public.revenue_daily_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL,
  organization_slug text NOT NULL,
  stay_date date NOT NULL,
  captured_date date NOT NULL,
  rooms_sold integer NOT NULL DEFAULT 0,
  rooms_available integer NOT NULL DEFAULT 0,
  occupancy_pct numeric NOT NULL DEFAULT 0,
  revenue_eur numeric NOT NULL DEFAULT 0,
  adr_eur numeric,
  new_bookings integer NOT NULL DEFAULT 0,
  captured_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, stay_date, captured_date)
);
CREATE INDEX idx_revenue_daily_snapshots_lookup ON public.revenue_daily_snapshots (hotel_id, captured_date, stay_date);

GRANT SELECT ON public.revenue_daily_snapshots TO authenticated;
GRANT ALL ON public.revenue_daily_snapshots TO service_role;
ALTER TABLE public.revenue_daily_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org staff can read revenue daily snapshots"
  ON public.revenue_daily_snapshots FOR SELECT TO authenticated
  USING (public.user_can_access_hotel(auth.uid(), hotel_id) OR public.is_revenue_user(auth.uid()));

CREATE TRIGGER trg_revenue_room_type_rates_updated
  BEFORE UPDATE ON public.revenue_room_type_rates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();