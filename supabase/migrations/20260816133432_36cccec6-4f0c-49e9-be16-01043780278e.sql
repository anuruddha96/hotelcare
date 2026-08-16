
-- 1. Demand events (manual + AI, per organisation, configurable city)
CREATE TABLE IF NOT EXISTS public.demand_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_slug text NOT NULL,
  hotel_id text,
  country text NOT NULL DEFAULT 'Hungary',
  city text NOT NULL DEFAULT 'Budapest',
  title text NOT NULL,
  category text NOT NULL DEFAULT 'other',
  venue text,
  event_date date NOT NULL,
  end_date date,
  expected_impact text NOT NULL DEFAULT 'medium',
  recurs_annually boolean NOT NULL DEFAULT false,
  notes text,
  url text,
  source text NOT NULL DEFAULT 'manual',
  confidence numeric,
  approved boolean NOT NULL DEFAULT true,
  surcharge_eur numeric,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS demand_events_uidx
  ON public.demand_events (organization_slug, city, event_date, lower(title));
CREATE INDEX IF NOT EXISTS demand_events_lookup_idx
  ON public.demand_events (organization_slug, event_date);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.demand_events TO authenticated;
GRANT ALL ON public.demand_events TO service_role;

ALTER TABLE public.demand_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY demand_events_select ON public.demand_events
  FOR SELECT TO authenticated
  USING (public.is_revenue_user(auth.uid())
         AND organization_slug = public.get_user_organization_slug(auth.uid()));

CREATE POLICY demand_events_modify ON public.demand_events
  FOR ALL TO authenticated
  USING (public.is_revenue_user(auth.uid())
         AND organization_slug = public.get_user_organization_slug(auth.uid()))
  WITH CHECK (public.is_revenue_user(auth.uid())
         AND organization_slug = public.get_user_organization_slug(auth.uid()));

DROP TRIGGER IF EXISTS demand_events_touch ON public.demand_events;
CREATE TRIGGER demand_events_touch
  BEFORE UPDATE ON public.demand_events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Automation rule columns for the immediate window, spikes and event surcharge
ALTER TABLE public.revenue_pickup_automation_rules
  ADD COLUMN IF NOT EXISTS immediate_window_days integer NOT NULL DEFAULT 14,
  ADD COLUMN IF NOT EXISTS immediate_markdown_step numeric NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS immediate_sell_mode_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS spike_detection_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS spike_threshold_pct numeric NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS spike_lookback_days integer NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS event_surcharge_eur numeric NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS event_surcharge_auto boolean NOT NULL DEFAULT false;

-- 3. Where a lost room-night was detected (Previo status vs. disappearance diff)
ALTER TABLE public.revenue_cancelled_nights
  ADD COLUMN IF NOT EXISTS detection_source text NOT NULL DEFAULT 'previo_status';

-- 4. Per-property market location for the AI event search
ALTER TABLE public.hotel_revenue_settings
  ADD COLUMN IF NOT EXISTS market_city text,
  ADD COLUMN IF NOT EXISTS market_country text;
