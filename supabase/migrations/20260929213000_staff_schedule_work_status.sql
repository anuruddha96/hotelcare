-- Phase 1 housekeeping schedule foundation.
-- Keep staff_schedules.status for the draft/published lifecycle and store the
-- operational meaning of the day separately so Auto Assign can consume it later.

ALTER TABLE public.staff_schedules
ADD COLUMN IF NOT EXISTS work_status text;

UPDATE public.staff_schedules
SET work_status = CASE
  WHEN lower(coalesce(status, '')) = 'off'
    OR (shift_start IS NULL AND shift_end IS NULL)
    THEN 'off'
  ELSE 'working'
END
WHERE work_status IS NULL;

ALTER TABLE public.staff_schedules
ALTER COLUMN work_status SET DEFAULT 'working';

ALTER TABLE public.staff_schedules
ALTER COLUMN work_status SET NOT NULL;

DO $$
BEGIN
  ALTER TABLE public.staff_schedules
    ADD CONSTRAINT staff_schedules_work_status_check
    CHECK (work_status IN ('working', 'off', 'leave', 'sick', 'training'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN public.staff_schedules.work_status IS
  'Operational roster status. Publication lifecycle remains in staff_schedules.status.';

CREATE INDEX IF NOT EXISTS idx_staff_schedules_work_status_date
  ON public.staff_schedules (hotel_id, work_date, work_status);
