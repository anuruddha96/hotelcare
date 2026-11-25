-- Production-schema prerequisite for housekeeping daily-state integrity.
-- Nullable metadata-only columns; does not rewrite live housekeeping rows.
SET lock_timeout = '1500ms';
SET statement_timeout = '8s';

ALTER TABLE public.housekeeping_room_snapshots
  ADD COLUMN IF NOT EXISTS final_state jsonb,
  ADD COLUMN IF NOT EXISTS finalized_at timestamptz;
