-- Production-schema prerequisite for housekeeping daily-state integrity.
-- Nullable metadata-only columns; does not rewrite live housekeeping rows.
SET lock_timeout = '1500ms';
SET statement_timeout = '8s';

ALTER TABLE public.room_assignments
  ADD COLUMN IF NOT EXISTS previous_day_context jsonb,
  ADD COLUMN IF NOT EXISTS instruction_snapshot jsonb;
