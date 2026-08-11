ALTER TABLE public.revenue_rate_drafts
  ADD COLUMN IF NOT EXISTS actual_previo_price numeric,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_checked_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_revenue_rate_drafts_reconcile
  ON public.revenue_rate_drafts (hotel_id, confirmation_status, stay_date)
  WHERE confirmation_status IN ('sending', 'sent', 'checking', 'different');

COMMENT ON COLUMN public.revenue_rate_drafts.actual_previo_price IS 'Most recent authoritative price read back from Previo for this requested cell.';
COMMENT ON COLUMN public.revenue_rate_drafts.confirmed_at IS 'Time the requested price was authoritatively confirmed from Previo.';
COMMENT ON COLUMN public.revenue_rate_drafts.last_checked_at IS 'Time Previo was last checked while reconciling this requested price.';