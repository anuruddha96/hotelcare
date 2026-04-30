-- ====== ENUMS ======
CREATE TYPE public.rate_recommendation_status AS ENUM ('pending','approved','pushed','overridden','expired');
CREATE TYPE public.rate_change_source AS ENUM ('engine','manual','bulk','previo_push');
CREATE TYPE public.revenue_alert_type AS ENUM ('abnormal_pickup','floor_breached','engine_error');

-- ====== HELPER: role check (admin or top_management) ======
CREATE OR REPLACE FUNCTION public.is_revenue_user(_uid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = _uid AND role IN ('admin','top_management')
  );
$$;

-- ====== hotel_revenue_settings ======
CREATE TABLE public.hotel_revenue_settings (
  hotel_id text PRIMARY KEY,
  organization_slug text NOT NULL,
  floor_price_eur numeric(10,2) NOT NULL DEFAULT 60,
  max_daily_change_eur numeric(10,2) NOT NULL DEFAULT 40,
  weekday_decrease_eur numeric(10,2) NOT NULL DEFAULT 3,
  weekend_decrease_eur numeric(10,2) NOT NULL DEFAULT 2,
  abnormal_pickup_threshold int NOT NULL DEFAULT 9,
  pickup_increase_tiers jsonb NOT NULL DEFAULT '[
    {"min":3,"max":3,"increase":10},
    {"min":4,"max":5,"increase":17},
    {"min":6,"max":8,"increase":22},
    {"min":9,"max":9999,"increase":30}
  ]'::jsonb,
  decrease_interval_hours int NOT NULL DEFAULT 12,
  skip_within_days int NOT NULL DEFAULT 2,
  is_engine_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.hotel_revenue_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "revenue_users_view_settings" ON public.hotel_revenue_settings
  FOR SELECT USING (
    public.is_revenue_user(auth.uid())
    AND organization_slug = public.get_user_organization_slug(auth.uid())
  );
CREATE POLICY "revenue_users_modify_settings" ON public.hotel_revenue_settings
  FOR ALL USING (
    public.is_revenue_user(auth.uid())
    AND organization_slug = public.get_user_organization_slug(auth.uid())
  ) WITH CHECK (
    public.is_revenue_user(auth.uid())
    AND organization_slug = public.get_user_organization_slug(auth.uid())
  );

-- ====== pickup_snapshots ======
CREATE TABLE public.pickup_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL,
  organization_slug text NOT NULL,
  stay_date date NOT NULL,
  bookings_current int NOT NULL DEFAULT 0,
  bookings_last_year int NOT NULL DEFAULT 0,
  delta int NOT NULL DEFAULT 0,
  captured_at timestamptz NOT NULL DEFAULT now(),
  uploaded_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'xlsx_upload'
);
CREATE INDEX idx_pickup_hotel_date_time ON public.pickup_snapshots(hotel_id, stay_date, captured_at DESC);

ALTER TABLE public.pickup_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "revenue_users_view_pickup" ON public.pickup_snapshots
  FOR SELECT USING (
    public.is_revenue_user(auth.uid())
    AND organization_slug = public.get_user_organization_slug(auth.uid())
  );
CREATE POLICY "revenue_users_insert_pickup" ON public.pickup_snapshots
  FOR INSERT WITH CHECK (
    public.is_revenue_user(auth.uid())
    AND organization_slug = public.get_user_organization_slug(auth.uid())
  );

-- ====== rate_recommendations ======
CREATE TABLE public.rate_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL,
  organization_slug text NOT NULL,
  stay_date date NOT NULL,
  current_rate_eur numeric(10,2),
  recommended_rate_eur numeric(10,2) NOT NULL,
  delta_eur numeric(10,2) NOT NULL,
  reason text,
  status public.rate_recommendation_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  pushed_at timestamptz
);
CREATE INDEX idx_rate_recs_hotel_date ON public.rate_recommendations(hotel_id, stay_date);
CREATE INDEX idx_rate_recs_status ON public.rate_recommendations(status);

ALTER TABLE public.rate_recommendations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "revenue_users_all_recs" ON public.rate_recommendations
  FOR ALL USING (
    public.is_revenue_user(auth.uid())
    AND organization_slug = public.get_user_organization_slug(auth.uid())
  ) WITH CHECK (
    public.is_revenue_user(auth.uid())
    AND organization_slug = public.get_user_organization_slug(auth.uid())
  );

-- ====== rate_history ======
CREATE TABLE public.rate_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL,
  organization_slug text NOT NULL,
  stay_date date NOT NULL,
  old_rate_eur numeric(10,2),
  new_rate_eur numeric(10,2) NOT NULL,
  source public.rate_change_source NOT NULL,
  changed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  notes text
);
CREATE INDEX idx_rate_hist_hotel_date ON public.rate_history(hotel_id, stay_date, changed_at DESC);

ALTER TABLE public.rate_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "revenue_users_view_history" ON public.rate_history
  FOR SELECT USING (
    public.is_revenue_user(auth.uid())
    AND organization_slug = public.get_user_organization_slug(auth.uid())
  );
CREATE POLICY "revenue_users_insert_history" ON public.rate_history
  FOR INSERT WITH CHECK (
    public.is_revenue_user(auth.uid())
    AND organization_slug = public.get_user_organization_slug(auth.uid())
  );

-- ====== revenue_alerts ======
CREATE TABLE public.revenue_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL,
  organization_slug text NOT NULL,
  stay_date date,
  alert_type public.revenue_alert_type NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  acknowledged_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  acknowledged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_revenue_alerts_unack ON public.revenue_alerts(organization_slug) WHERE acknowledged_at IS NULL;

ALTER TABLE public.revenue_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "revenue_users_all_alerts" ON public.revenue_alerts
  FOR ALL USING (
    public.is_revenue_user(auth.uid())
    AND organization_slug = public.get_user_organization_slug(auth.uid())
  ) WITH CHECK (
    public.is_revenue_user(auth.uid())
    AND organization_slug = public.get_user_organization_slug(auth.uid())
  );

-- ====== hotel_breakfast_codes ======
CREATE TABLE public.hotel_breakfast_codes (
  hotel_id text PRIMARY KEY,
  organization_slug text NOT NULL,
  code text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.hotel_breakfast_codes ENABLE ROW LEVEL SECURITY;
-- Only admins of the same org can manage codes; no public SELECT (edge fn uses service role)
CREATE POLICY "admins_manage_breakfast_codes" ON public.hotel_breakfast_codes
  FOR ALL USING (
    public.get_user_role(auth.uid()) = 'admin'
    AND organization_slug = public.get_user_organization_slug(auth.uid())
  ) WITH CHECK (
    public.get_user_role(auth.uid()) = 'admin'
    AND organization_slug = public.get_user_organization_slug(auth.uid())
  );

-- ====== breakfast_roster ======
CREATE TABLE public.breakfast_roster (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL,
  organization_slug text NOT NULL,
  stay_date date NOT NULL,
  room_number text NOT NULL,
  guest_names text[] NOT NULL DEFAULT '{}',
  pax int NOT NULL DEFAULT 0,
  breakfast_count int NOT NULL DEFAULT 0,
  lunch_count int NOT NULL DEFAULT 0,
  dinner_count int NOT NULL DEFAULT 0,
  all_inclusive_count int NOT NULL DEFAULT 0,
  source_notes text,
  uploaded_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(hotel_id, stay_date, room_number)
);
CREATE INDEX idx_roster_lookup ON public.breakfast_roster(hotel_id, stay_date, room_number);

ALTER TABLE public.breakfast_roster ENABLE ROW LEVEL SECURITY;
-- Managers / admins of same org can upload & view; public lookup uses service role
CREATE POLICY "managers_view_roster" ON public.breakfast_roster
  FOR SELECT USING (
    public.get_user_role(auth.uid()) IN ('admin','manager','housekeeping_manager','reception','front_office','top_management')
    AND organization_slug = public.get_user_organization_slug(auth.uid())
  );
CREATE POLICY "managers_modify_roster" ON public.breakfast_roster
  FOR ALL USING (
    public.get_user_role(auth.uid()) IN ('admin','manager','housekeeping_manager','reception','front_office')
    AND organization_slug = public.get_user_organization_slug(auth.uid())
  ) WITH CHECK (
    public.get_user_role(auth.uid()) IN ('admin','manager','housekeeping_manager','reception','front_office')
    AND organization_slug = public.get_user_organization_slug(auth.uid())
  );

-- ====== Triggers ======
CREATE TRIGGER trg_revenue_settings_updated
  BEFORE UPDATE ON public.hotel_revenue_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_breakfast_codes_updated
  BEFORE UPDATE ON public.hotel_breakfast_codes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-expire stale recommendations (called by engine; also a helper function)
CREATE OR REPLACE FUNCTION public.expire_stale_recommendations()
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  UPDATE public.rate_recommendations
  SET status = 'expired'
  WHERE status = 'pending'
    AND created_at < now() - interval '24 hours';
$$;