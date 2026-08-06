ALTER TABLE public.hotel_revenue_settings
  ADD COLUMN IF NOT EXISTS rate_warn_below_eur numeric NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS rate_critical_below_eur numeric NOT NULL DEFAULT 40,
  ADD COLUMN IF NOT EXISTS rate_max_sane_eur numeric NOT NULL DEFAULT 900,
  ADD COLUMN IF NOT EXISTS occupancy_low_pct integer NOT NULL DEFAULT 40,
  ADD COLUMN IF NOT EXISTS occupancy_high_pct integer NOT NULL DEFAULT 85,
  ADD COLUMN IF NOT EXISTS pickup_strong_threshold integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS rate_alert_emails_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE public.room_types
  ADD COLUMN IF NOT EXISTS name_translations jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.revenue_rate_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL,
  organization_slug text,
  stay_date date NOT NULL,
  obk_id text,
  room_type_name text NOT NULL,
  occupancy integer NOT NULL DEFAULT 2,
  old_price numeric,
  new_price numeric NOT NULL,
  currency text NOT NULL DEFAULT 'EUR',
  status text NOT NULL DEFAULT 'draft',
  push_error text,
  created_by uuid,
  pushed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, stay_date, room_type_name, occupancy, status)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.revenue_rate_drafts TO authenticated;
GRANT ALL ON public.revenue_rate_drafts TO service_role;
ALTER TABLE public.revenue_rate_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Revenue users manage rate drafts for their hotel"
  ON public.revenue_rate_drafts FOR ALL
  TO authenticated
  USING (public.is_revenue_user(auth.uid()) AND public.user_can_access_hotel(auth.uid(), hotel_id))
  WITH CHECK (public.is_revenue_user(auth.uid()) AND public.user_can_access_hotel(auth.uid(), hotel_id));

CREATE TRIGGER update_revenue_rate_drafts_updated_at
  BEFORE UPDATE ON public.revenue_rate_drafts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.revenue_rate_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL,
  organization_slug text,
  stay_date date NOT NULL,
  room_type_name text NOT NULL,
  occupancy integer,
  price numeric NOT NULL,
  severity text NOT NULL DEFAULT 'critical',
  notified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS revenue_rate_alerts_lookup
  ON public.revenue_rate_alerts (hotel_id, stay_date, room_type_name, created_at DESC);

GRANT SELECT ON public.revenue_rate_alerts TO authenticated;
GRANT ALL ON public.revenue_rate_alerts TO service_role;
ALTER TABLE public.revenue_rate_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Revenue users read rate alerts for their hotel"
  ON public.revenue_rate_alerts FOR SELECT
  TO authenticated
  USING (public.is_revenue_user(auth.uid()) AND public.user_can_access_hotel(auth.uid(), hotel_id));