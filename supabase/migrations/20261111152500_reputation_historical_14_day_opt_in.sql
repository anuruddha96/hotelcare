-- Time-boxed one-time opt-in for historical positive Google review catch-up.
-- This does NOT turn on automatic replies for future reviews.
ALTER TABLE public.google_business_locations
 ADD COLUMN IF NOT EXISTS auto_backfill_active boolean NOT NULL DEFAULT false,
 ADD COLUMN IF NOT EXISTS auto_backfill_authorized_at timestamptz,
 ADD COLUMN IF NOT EXISTS auto_backfill_authorized_by uuid,
 ADD COLUMN IF NOT EXISTS auto_backfill_cutoff timestamptz,
 ADD COLUMN IF NOT EXISTS auto_backfill_upper_bound timestamptz;
ALTER TABLE public.google_reviews
 ADD COLUMN IF NOT EXISTS auto_reply_kind text;
ALTER TABLE public.google_reviews DROP CONSTRAINT IF EXISTS google_reviews_auto_reply_kind_check;
ALTER TABLE public.google_reviews ADD CONSTRAINT google_reviews_auto_reply_kind_check
 CHECK (auto_reply_kind IS NULL OR auto_reply_kind IN ('new_positive','historical_14d'));