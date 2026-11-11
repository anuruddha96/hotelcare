-- Google supplies full verified review statistics with each page; store separately
-- from the partial set of review rows cached by HotelCare.
ALTER TABLE public.google_business_locations
  ADD COLUMN IF NOT EXISTS google_total_review_count integer,
  ADD COLUMN IF NOT EXISTS google_average_rating numeric(3,2),
  ADD COLUMN IF NOT EXISTS google_review_stats_updated_at timestamptz;
CREATE TABLE IF NOT EXISTS public.google_reputation_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  google_location_id uuid NOT NULL REFERENCES public.google_business_locations(id) ON DELETE CASCADE,
  google_review_name text NOT NULL,
  review_id uuid REFERENCES public.google_reviews(id) ON DELETE SET NULL,
  star_rating smallint NOT NULL CHECK (star_rating BETWEEN 1 AND 3),
  review_excerpt text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved')),
  detected_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid,
  resolved_at timestamptz,
  UNIQUE (organization_id, google_review_name)
);
CREATE INDEX IF NOT EXISTS google_reputation_alerts_org_status_idx
  ON public.google_reputation_alerts(organization_id,status,detected_at DESC);
ALTER TABLE public.google_reputation_alerts ENABLE ROW LEVEL SECURITY;
-- No direct grants/policies for browser clients; trusted Edge Function checks
-- org membership and privileged manager role before service-role access.
REVOKE ALL ON public.google_reputation_alerts FROM anon, authenticated;