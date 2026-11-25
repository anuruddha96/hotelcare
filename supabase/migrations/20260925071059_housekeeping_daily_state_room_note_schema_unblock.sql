-- Production-schema prerequisite for housekeeping daily-state integrity.
-- Generic business-date marker used to protect same-day human room notes.
SET lock_timeout = '1500ms';
SET statement_timeout = '8s';

ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS operational_note_date date;
