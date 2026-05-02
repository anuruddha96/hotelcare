-- Daily rates per hotel/date (current price seen in PMS) for the calendar grid
CREATE TABLE IF NOT EXISTS public.daily_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL,
  organization_slug text NOT NULL,
  stay_date date NOT NULL,
  rate_eur numeric NOT NULL,
  occupancy_pct numeric,
  source text NOT NULL DEFAULT 'manual',
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, stay_date)
);
CREATE INDEX IF NOT EXISTS idx_daily_rates_hotel_date ON public.daily_rates (hotel_id, stay_date);
ALTER TABLE public.daily_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "daily_rates_select" ON public.daily_rates;
CREATE POLICY "daily_rates_select" ON public.daily_rates FOR SELECT
  USING (is_revenue_user(auth.uid()) AND organization_slug = get_user_organization_slug(auth.uid()));

DROP POLICY IF EXISTS "daily_rates_modify" ON public.daily_rates;
CREATE POLICY "daily_rates_modify" ON public.daily_rates FOR ALL
  USING (is_revenue_user(auth.uid()) AND organization_slug = get_user_organization_slug(auth.uid()))
  WITH CHECK (is_revenue_user(auth.uid()) AND organization_slug = get_user_organization_slug(auth.uid()));

-- Local events affecting demand (holidays, conferences, etc.)
CREATE TABLE IF NOT EXISTS public.hotel_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL,
  organization_slug text NOT NULL,
  event_date date NOT NULL,
  end_date date,
  title text NOT NULL,
  category text NOT NULL DEFAULT 'event',
  impact text NOT NULL DEFAULT 'medium',
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hotel_events_hotel_date ON public.hotel_events (hotel_id, event_date);
ALTER TABLE public.hotel_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "events_select" ON public.hotel_events;
CREATE POLICY "events_select" ON public.hotel_events FOR SELECT
  USING (is_revenue_user(auth.uid()) AND organization_slug = get_user_organization_slug(auth.uid()));

DROP POLICY IF EXISTS "events_modify" ON public.hotel_events;
CREATE POLICY "events_modify" ON public.hotel_events FOR ALL
  USING (is_revenue_user(auth.uid()) AND organization_slug = get_user_organization_slug(auth.uid()))
  WITH CHECK (is_revenue_user(auth.uid()) AND organization_slug = get_user_organization_slug(auth.uid()));

-- Min-stay restrictions per hotel/date
CREATE TABLE IF NOT EXISTS public.min_stay_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL,
  organization_slug text NOT NULL,
  stay_date date NOT NULL,
  min_nights integer NOT NULL DEFAULT 1,
  notes text,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, stay_date)
);
CREATE INDEX IF NOT EXISTS idx_min_stay_hotel_date ON public.min_stay_rules (hotel_id, stay_date);
ALTER TABLE public.min_stay_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "min_stay_select" ON public.min_stay_rules;
CREATE POLICY "min_stay_select" ON public.min_stay_rules FOR SELECT
  USING (is_revenue_user(auth.uid()) AND organization_slug = get_user_organization_slug(auth.uid()));

DROP POLICY IF EXISTS "min_stay_modify" ON public.min_stay_rules;
CREATE POLICY "min_stay_modify" ON public.min_stay_rules FOR ALL
  USING (is_revenue_user(auth.uid()) AND organization_slug = get_user_organization_slug(auth.uid()))
  WITH CHECK (is_revenue_user(auth.uid()) AND organization_slug = get_user_organization_slug(auth.uid()));