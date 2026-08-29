ALTER TABLE public.revenue_automation_notifications
  ADD COLUMN automation_run_id uuid NULL
  REFERENCES public.revenue_automation_runs(id) ON DELETE SET NULL;

CREATE INDEX idx_rev_auto_notif_run
  ON public.revenue_automation_notifications (automation_run_id)
  WHERE automation_run_id IS NOT NULL;