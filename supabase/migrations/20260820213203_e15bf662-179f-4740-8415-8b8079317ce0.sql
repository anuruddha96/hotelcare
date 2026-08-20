ALTER TABLE public.demand_event_search_runs
  ADD COLUMN IF NOT EXISTS month text;
CREATE INDEX IF NOT EXISTS demand_event_search_runs_slot_idx
  ON public.demand_event_search_runs (organization_slug, city, month, created_at DESC);