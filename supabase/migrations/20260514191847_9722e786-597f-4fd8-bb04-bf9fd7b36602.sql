
ALTER TYPE public.revenue_alert_type ADD VALUE IF NOT EXISTS 'pickup_surge';
ALTER TYPE public.rate_change_source ADD VALUE IF NOT EXISTS 'autopilot';

ALTER TABLE public.hotel_revenue_settings
  ADD COLUMN IF NOT EXISTS auto_apply boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_push_to_pms boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS surge_threshold integer NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS surge_window_minutes integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS surge_increase_eur integer NOT NULL DEFAULT 25,
  ADD COLUMN IF NOT EXISTS decay_window_days integer NOT NULL DEFAULT 90,
  ADD COLUMN IF NOT EXISTS autopilot_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.rate_recommendations
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS auto_generated boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_pushed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS source_kind text;

CREATE TABLE IF NOT EXISTS public.booking_velocity_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL,
  organization_slug text NOT NULL,
  stay_date date NOT NULL,
  detected_at timestamptz NOT NULL DEFAULT now(),
  arrivals_in_window integer NOT NULL,
  window_minutes integer NOT NULL DEFAULT 60,
  recommended_increase_eur integer NOT NULL,
  acted boolean NOT NULL DEFAULT false,
  rate_recommendation_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bve_hotel_date ON public.booking_velocity_events (hotel_id, stay_date, detected_at DESC);

ALTER TABLE public.booking_velocity_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "bve_select_admins" ON public.booking_velocity_events;
CREATE POLICY "bve_select_admins" ON public.booking_velocity_events FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin','top_management','manager','housekeeping_manager','front_office')
        AND (p.role IN ('admin','top_management') OR p.organization_slug = booking_velocity_events.organization_slug)
    )
  );

CREATE TABLE IF NOT EXISTS public.autopilot_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL,
  organization_slug text NOT NULL,
  stay_date date NOT NULL,
  decision_type text NOT NULL,
  before_rate_eur numeric,
  after_rate_eur numeric,
  delta_eur numeric,
  reason text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_apd_hotel_created ON public.autopilot_decisions (hotel_id, created_at DESC);
ALTER TABLE public.autopilot_decisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "apd_select_admins" ON public.autopilot_decisions;
CREATE POLICY "apd_select_admins" ON public.autopilot_decisions FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role IN ('admin','top_management')
    )
  );
