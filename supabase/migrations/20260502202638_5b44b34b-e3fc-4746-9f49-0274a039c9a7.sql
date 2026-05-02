
-- ===== Room Price Genie parity tables =====

CREATE TABLE IF NOT EXISTS public.room_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL,
  organization_slug text NOT NULL,
  name text NOT NULL,
  pms_room_id text,
  pms_rate_id text,
  num_rooms integer NOT NULL DEFAULT 1,
  is_reference boolean NOT NULL DEFAULT false,
  derivation_mode text NOT NULL DEFAULT 'percent' CHECK (derivation_mode IN ('percent','absolute')),
  derivation_value numeric NOT NULL DEFAULT 0,
  base_price_eur numeric NOT NULL DEFAULT 0,
  min_price_eur numeric NOT NULL DEFAULT 0,
  max_price_eur numeric NOT NULL DEFAULT 9999,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS room_types_hotel_idx ON public.room_types(hotel_id);

CREATE TABLE IF NOT EXISTS public.dow_adjustments (
  hotel_id text NOT NULL,
  organization_slug text NOT NULL,
  dow integer NOT NULL CHECK (dow BETWEEN 0 AND 6),
  percent numeric NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hotel_id, dow)
);

CREATE TABLE IF NOT EXISTS public.monthly_adjustments (
  hotel_id text NOT NULL,
  organization_slug text NOT NULL,
  month integer NOT NULL CHECK (month BETWEEN 1 AND 12),
  percent numeric NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hotel_id, month)
);

CREATE TABLE IF NOT EXISTS public.lead_time_adjustments (
  hotel_id text NOT NULL,
  organization_slug text NOT NULL,
  bucket text NOT NULL CHECK (bucket IN ('6m_plus','3m_plus','1_5_to_3m','4_6w','2_4w','1_2w','4_7d','2_3d','last_day')),
  percent numeric NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hotel_id, bucket)
);

CREATE TABLE IF NOT EXISTS public.occupancy_targets (
  hotel_id text NOT NULL,
  organization_slug text NOT NULL,
  month integer NOT NULL CHECK (month BETWEEN 1 AND 12),
  target_pct integer NOT NULL DEFAULT 80,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hotel_id, month)
);

CREATE TABLE IF NOT EXISTS public.occupancy_strategy (
  hotel_id text PRIMARY KEY,
  organization_slug text NOT NULL,
  median_booking_window integer NOT NULL DEFAULT 14,
  aggressiveness text NOT NULL DEFAULT 'medium' CHECK (aggressiveness IN ('low','medium','high')),
  close_out_last_day_pct numeric NOT NULL DEFAULT 0,
  shoulder_discount_pct numeric NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.yielding_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL,
  organization_slug text NOT NULL,
  name text NOT NULL,
  room_type_id uuid REFERENCES public.room_types(id) ON DELETE CASCADE,
  min_pct numeric NOT NULL DEFAULT -10,
  max_pct numeric NOT NULL DEFAULT 10,
  aggressiveness text NOT NULL DEFAULT 'low' CHECK (aggressiveness IN ('low','medium','high')),
  colour text NOT NULL DEFAULT 'orange',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS yielding_tags_hotel_idx ON public.yielding_tags(hotel_id);

CREATE TABLE IF NOT EXISTS public.min_stay_settings (
  hotel_id text PRIMARY KEY,
  organization_slug text NOT NULL,
  min_floor integer NOT NULL DEFAULT 1,
  allow_override_fixed boolean NOT NULL DEFAULT false,
  room_type_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.surge_settings (
  hotel_id text PRIMARY KEY,
  organization_slug text NOT NULL,
  threshold_bookings integer NOT NULL DEFAULT 100,
  window_hours integer NOT NULL DEFAULT 24,
  only_after_days integer NOT NULL DEFAULT 1000,
  recipients uuid[] NOT NULL DEFAULT '{}'::uuid[],
  send_email boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.surge_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL,
  organization_slug text NOT NULL,
  stay_date date NOT NULL,
  bookings_in_window integer NOT NULL,
  triggered_at timestamptz NOT NULL DEFAULT now(),
  notified_at timestamptz
);
CREATE INDEX IF NOT EXISTS surge_events_hotel_idx ON public.surge_events(hotel_id, triggered_at DESC);

CREATE TABLE IF NOT EXISTS public.benchmark_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL,
  organization_slug text NOT NULL,
  market_id text,
  metric text NOT NULL,
  day date NOT NULL,
  value numeric,
  comparison_value numeric,
  captured_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS benchmark_snapshots_hotel_day_idx ON public.benchmark_snapshots(hotel_id, day);

CREATE TABLE IF NOT EXISTS public.pms_rate_plan_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL,
  organization_slug text NOT NULL,
  room_type_id uuid REFERENCES public.room_types(id) ON DELETE CASCADE,
  pms_rate_plan_id text NOT NULL,
  channel text NOT NULL DEFAULT 'previo',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pms_rate_plan_mappings_hotel_idx ON public.pms_rate_plan_mappings(hotel_id);

CREATE TABLE IF NOT EXISTS public.hotel_data_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL,
  organization_slug text NOT NULL,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('pickup','occupancy','rate','events','benchmark')),
  transport text NOT NULL CHECK (transport IN ('http_url','sftp','email_inbox','manual')),
  url text,
  auth_headers jsonb DEFAULT '{}'::jsonb,
  schedule_cron text DEFAULT '0 6 * * *',
  is_active boolean NOT NULL DEFAULT true,
  last_run_at timestamptz,
  last_status text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hotel_data_sources_hotel_idx ON public.hotel_data_sources(hotel_id);

CREATE TABLE IF NOT EXISTS public.revenue_ingest_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid REFERENCES public.hotel_data_sources(id) ON DELETE CASCADE,
  hotel_id text NOT NULL,
  organization_slug text NOT NULL,
  status text NOT NULL,
  rows_ingested integer DEFAULT 0,
  error text,
  duration_ms integer,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS revenue_ingest_runs_hotel_idx ON public.revenue_ingest_runs(hotel_id, started_at DESC);

ALTER TABLE public.hotel_revenue_settings ADD COLUMN IF NOT EXISTS engine_uses_room_setup boolean NOT NULL DEFAULT false;

-- ===== RLS =====
ALTER TABLE public.room_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dow_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monthly_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_time_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.occupancy_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.occupancy_strategy ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.yielding_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.min_stay_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.surge_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.surge_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.benchmark_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pms_rate_plan_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hotel_data_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.revenue_ingest_runs ENABLE ROW LEVEL SECURITY;

-- Generic policy creator pattern: admin / top_management within same org
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['room_types','dow_adjustments','monthly_adjustments','lead_time_adjustments',
    'occupancy_targets','occupancy_strategy','yielding_tags','min_stay_settings','surge_settings','surge_events',
    'benchmark_snapshots','pms_rate_plan_mappings','hotel_data_sources','revenue_ingest_runs'])
  LOOP
    EXECUTE format($p$
      DROP POLICY IF EXISTS "rev_admin_read_%1$s" ON public.%1$I;
      CREATE POLICY "rev_admin_read_%1$s" ON public.%1$I FOR SELECT TO authenticated
        USING (organization_slug = public.get_user_organization_slug(auth.uid())
               AND public.get_user_role(auth.uid()) IN ('admin','top_management','manager','housekeeping_manager'));
      DROP POLICY IF EXISTS "rev_admin_write_%1$s" ON public.%1$I;
      CREATE POLICY "rev_admin_write_%1$s" ON public.%1$I FOR ALL TO authenticated
        USING (organization_slug = public.get_user_organization_slug(auth.uid())
               AND public.get_user_role(auth.uid()) IN ('admin','top_management'))
        WITH CHECK (organization_slug = public.get_user_organization_slug(auth.uid())
               AND public.get_user_role(auth.uid()) IN ('admin','top_management'));
    $p$, t);
  END LOOP;
END $$;
