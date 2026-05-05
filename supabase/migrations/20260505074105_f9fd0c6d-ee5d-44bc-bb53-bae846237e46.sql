
-- Occupancy snapshots (append-only history)
CREATE TABLE IF NOT EXISTS public.occupancy_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL,
  organization_slug text NOT NULL,
  stay_date date NOT NULL,
  occupancy_pct numeric,
  rooms_sold integer,
  captured_at timestamptz NOT NULL DEFAULT now(),
  snapshot_label text,
  uploaded_by uuid,
  source text DEFAULT 'xlsx_upload'
);
CREATE INDEX IF NOT EXISTS idx_occ_hotel_date ON public.occupancy_snapshots(hotel_id, stay_date, captured_at DESC);
ALTER TABLE public.occupancy_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "occ read for revenue roles"
ON public.occupancy_snapshots FOR SELECT
TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role IN ('admin','top_management','manager','housekeeping_manager')
      AND p.organization_slug = occupancy_snapshots.organization_slug)
);

-- Market events (AI-suggested + manual)
CREATE TABLE IF NOT EXISTS public.market_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city text NOT NULL DEFAULT 'budapest',
  event_date date NOT NULL,
  end_date date,
  title text NOT NULL,
  category text,
  venue text,
  expected_impact text DEFAULT 'medium',
  url text,
  source text DEFAULT 'ai_suggested',
  confidence numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (city, event_date, title)
);
CREATE INDEX IF NOT EXISTS idx_market_events_date ON public.market_events(city, event_date);
ALTER TABLE public.market_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "market events read authenticated"
ON public.market_events FOR SELECT
TO authenticated
USING (true);
