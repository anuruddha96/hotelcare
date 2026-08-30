ALTER TABLE public.revenue_date_decisions
  DROP CONSTRAINT IF EXISTS revenue_date_decisions_status_chk;

ALTER TABLE public.revenue_date_decisions
  ADD CONSTRAINT revenue_date_decisions_status_chk
  CHECK (status = ANY (ARRAY['shadow'::text, 'queued'::text, 'accepted'::text, 'published'::text, 'confirmed'::text, 'verified'::text, 'partial'::text, 'held'::text, 'failed'::text, 'blocked'::text]));

CREATE INDEX IF NOT EXISTS idx_rate_push_items_run_date_status
  ON public.revenue_rate_push_items (run_id, stay_date, status);