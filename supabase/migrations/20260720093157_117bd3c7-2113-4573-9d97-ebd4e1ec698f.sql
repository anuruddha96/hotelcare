
ALTER TABLE public.room_assignments
  ADD COLUMN IF NOT EXISTS dnd_attempt_count smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dnd_first_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS dnd_retry_unlocked_at timestamptz;

ALTER TABLE public.dnd_photos
  ADD COLUMN IF NOT EXISTS attempt_number smallint NOT NULL DEFAULT 1;

UPDATE public.room_assignments
SET status = 'dnd_pending_retry'::assignment_status,
    dnd_attempt_count = 1,
    dnd_first_attempt_at = COALESCE(dnd_marked_at, completed_at, now())
WHERE is_dnd = true
  AND status = 'completed'
  AND supervisor_approved_at IS NULL
  AND assignment_date = CURRENT_DATE
  AND dnd_attempt_count = 0;
