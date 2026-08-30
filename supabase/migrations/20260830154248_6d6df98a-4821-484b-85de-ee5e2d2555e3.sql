ALTER TABLE public.revenue_rate_push_runs
  ADD COLUMN IF NOT EXISTS automation_run_id uuid REFERENCES public.revenue_automation_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS date_manifest jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.revenue_rate_push_items
  ADD COLUMN IF NOT EXISTS decision_id uuid REFERENCES public.revenue_date_decisions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_rate_push_runs_automation_run
  ON public.revenue_rate_push_runs (automation_run_id)
  WHERE automation_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rate_push_items_decision
  ON public.revenue_rate_push_items (decision_id)
  WHERE decision_id IS NOT NULL;

GRANT SELECT, INSERT ON public.revenue_rate_push_runs TO authenticated;
GRANT ALL ON public.revenue_rate_push_runs TO service_role;
GRANT SELECT, INSERT ON public.revenue_rate_push_items TO authenticated;
GRANT ALL ON public.revenue_rate_push_items TO service_role;