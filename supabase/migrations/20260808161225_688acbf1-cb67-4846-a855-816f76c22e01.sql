ALTER TABLE public.hotel_revenue_settings
  ADD COLUMN IF NOT EXISTS min_adr numeric,
  ADD COLUMN IF NOT EXISTS pickup_step_1_eur numeric NOT NULL DEFAULT 11,
  ADD COLUMN IF NOT EXISTS pickup_step_2_eur numeric NOT NULL DEFAULT 18,
  ADD COLUMN IF NOT EXISTS pickup_step_3_eur numeric NOT NULL DEFAULT 40,
  ADD COLUMN IF NOT EXISTS pickup_burst_minutes integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS idle_decay_hours integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS idle_decay_eur numeric NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS low_demand_decrease_eur numeric NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS rate_write_method text,
  ADD COLUMN IF NOT EXISTS rate_write_verified_at timestamptz;

CREATE TABLE IF NOT EXISTS public.revenue_demand_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL,
  organization_slug text,
  stay_date date NOT NULL,
  rating text NOT NULL,
  reason text,
  event_name text,
  created_by uuid,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, stay_date)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.revenue_demand_ratings TO authenticated;
GRANT ALL ON public.revenue_demand_ratings TO service_role;
ALTER TABLE public.revenue_demand_ratings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff read demand ratings for their hotel"
  ON public.revenue_demand_ratings FOR SELECT TO authenticated
  USING (public.user_can_access_hotel(auth.uid(), hotel_id));

CREATE POLICY "Revenue users write demand ratings for their hotel"
  ON public.revenue_demand_ratings FOR ALL TO authenticated
  USING (public.is_revenue_user(auth.uid()) AND public.user_can_access_hotel(auth.uid(), hotel_id))
  WITH CHECK (public.is_revenue_user(auth.uid()) AND public.user_can_access_hotel(auth.uid(), hotel_id));

CREATE TABLE IF NOT EXISTS public.revenue_pickup_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL,
  organization_slug text,
  stay_date date NOT NULL,
  trigger_kind text NOT NULL,
  trigger_detail text,
  step_index integer,
  delta_eur numeric NOT NULL DEFAULT 0,
  old_price numeric,
  new_price numeric,
  clamped_by_min_adr boolean NOT NULL DEFAULT false,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.revenue_pickup_actions TO authenticated;
GRANT ALL ON public.revenue_pickup_actions TO service_role;
ALTER TABLE public.revenue_pickup_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff read pickup actions for their hotel"
  ON public.revenue_pickup_actions FOR SELECT TO authenticated
  USING (public.user_can_access_hotel(auth.uid(), hotel_id));

CREATE INDEX IF NOT EXISTS revenue_pickup_actions_hotel_date_idx
  ON public.revenue_pickup_actions (hotel_id, stay_date, occurred_at DESC);

CREATE TRIGGER revenue_demand_ratings_touch
  BEFORE UPDATE ON public.revenue_demand_ratings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();