ALTER TABLE public.room_minibar_usage
  ADD COLUMN IF NOT EXISTS cleared_by uuid,
  ADD COLUMN IF NOT EXISTS cleared_at timestamptz,
  ADD COLUMN IF NOT EXISTS cleared_note text;

CREATE INDEX IF NOT EXISTS idx_room_minibar_usage_room_cleared
  ON public.room_minibar_usage (room_id, is_cleared, usage_date DESC);