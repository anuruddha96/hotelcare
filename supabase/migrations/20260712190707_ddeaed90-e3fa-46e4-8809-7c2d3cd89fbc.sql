
-- 1) pms_snapshots: last-known normalized snapshot per hotel/business_date
CREATE TABLE IF NOT EXISTS public.pms_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL,
  business_date date NOT NULL,
  source text NOT NULL,           -- 'xlsx' | 'api'
  content_hash text NOT NULL,
  rooms jsonb NOT NULL,           -- NormalizedRoom[]
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  UNIQUE (hotel_id, business_date)
);

GRANT SELECT ON public.pms_snapshots TO authenticated;
GRANT ALL ON public.pms_snapshots TO service_role;

ALTER TABLE public.pms_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Hotel staff can view pms snapshots"
  ON public.pms_snapshots
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (
          p.role IN ('admin','top_management')
          OR (
            p.role IN ('manager','housekeeping_manager','front_office')
            AND (
              p.assigned_hotel = pms_snapshots.hotel_id
              OR p.assigned_hotel = public.get_hotel_name_from_id(pms_snapshots.hotel_id)
            )
          )
        )
    )
  );

CREATE INDEX IF NOT EXISTS pms_snapshots_hotel_date_idx
  ON public.pms_snapshots (hotel_id, business_date DESC);

-- 2) Extend pms_change_events with diff-classifier fields
ALTER TABLE public.pms_change_events
  ADD COLUMN IF NOT EXISTS category text,       -- 'safe' | 'risky' | 'noop'
  ADD COLUMN IF NOT EXISTS change_kind text,    -- pmsDiff.ts ChangeKind
  ADD COLUMN IF NOT EXISTS auto_applied boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS pms_change_events_category_idx
  ON public.pms_change_events (hotel_id, category, acknowledged_at);
