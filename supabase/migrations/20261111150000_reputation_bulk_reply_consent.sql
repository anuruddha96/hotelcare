-- Record specific explicit authorization for new Google auto-reply activations.
-- Previously enabled venues remain unchanged until their owner updates their policy.
ALTER TABLE public.google_business_locations
  ADD COLUMN IF NOT EXISTS auto_reply_consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_reply_authorized_by uuid;

-- Bulk-approved review responses have a separate audit trail from unattended auto-replies.
ALTER TABLE public.google_reviews DROP CONSTRAINT IF EXISTS google_reviews_reply_origin_check;
ALTER TABLE public.google_reviews
  ADD CONSTRAINT google_reviews_reply_origin_check
  CHECK (reply_origin IN ('unknown', 'manager', 'bulk', 'automatic', 'google'));

CREATE INDEX IF NOT EXISTS google_reviews_recent_org_location_idx
  ON public.google_reviews (organization_id, review_create_time DESC, google_location_id)
  WHERE reply_status <> 'published';