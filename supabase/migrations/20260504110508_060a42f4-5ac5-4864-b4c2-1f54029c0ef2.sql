
-- Phase 1: Previo connection scaffolding
-- Add safety + tracking fields to pms_configurations
ALTER TABLE public.pms_configurations
  ADD COLUMN IF NOT EXISTS credentials_secret_name TEXT,
  ADD COLUMN IF NOT EXISTS auto_sync_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS connection_mode TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS last_test_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_test_status TEXT,
  ADD COLUMN IF NOT EXISTS last_test_error TEXT;

-- Constrain connection_mode
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pms_configurations_connection_mode_check'
  ) THEN
    ALTER TABLE public.pms_configurations
      ADD CONSTRAINT pms_configurations_connection_mode_check
      CHECK (connection_mode IN ('manual','scheduled'));
  END IF;
END $$;

-- Rate snapshots pulled from Previo, used by RMS pickup engine
CREATE TABLE IF NOT EXISTS public.previo_rate_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id TEXT NOT NULL,
  organization_slug TEXT NOT NULL,
  stay_date DATE NOT NULL,
  rate_plan_id TEXT NOT NULL,
  room_kind_id TEXT NOT NULL,
  rate_eur NUMERIC(10,2),
  availability INTEGER,
  restrictions JSONB DEFAULT '{}'::jsonb,
  source TEXT NOT NULL DEFAULT 'previo',
  pulled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT previo_rate_snapshots_unique UNIQUE (hotel_id, stay_date, rate_plan_id, room_kind_id)
);

CREATE INDEX IF NOT EXISTS idx_previo_rate_snapshots_hotel_date
  ON public.previo_rate_snapshots(hotel_id, stay_date);

ALTER TABLE public.previo_rate_snapshots ENABLE ROW LEVEL SECURITY;

-- Read: admin/top_management or users assigned to this hotel within same org
DROP POLICY IF EXISTS "previo_rate_snapshots_read" ON public.previo_rate_snapshots;
CREATE POLICY "previo_rate_snapshots_read"
  ON public.previo_rate_snapshots
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.organization_slug = previo_rate_snapshots.organization_slug
        AND (
          p.role IN ('admin','top_management')
          OR p.assigned_hotel = previo_rate_snapshots.hotel_id
          OR p.assigned_hotel = public.get_hotel_name_from_id(previo_rate_snapshots.hotel_id)
        )
    )
  );

-- Writes are service-role only (no insert/update policy => RLS denies for normal users)
