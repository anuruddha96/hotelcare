CREATE TABLE IF NOT EXISTS public.demand_event_search_runs (
  id uuid primary key default gen_random_uuid(),
  organization_slug text not null,
  hotel_id text,
  city text,
  country text,
  months_scanned integer not null default 0,
  events_found integer not null default 0,
  events_added integer not null default 0,
  source text not null default 'manual',
  run_by uuid,
  run_by_name text,
  error text,
  created_at timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS demand_event_search_runs_org_idx ON public.demand_event_search_runs (organization_slug, created_at DESC);

GRANT SELECT ON public.demand_event_search_runs TO authenticated;
GRANT ALL ON public.demand_event_search_runs TO service_role;

ALTER TABLE public.demand_event_search_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members can view event search runs" ON public.demand_event_search_runs;
CREATE POLICY "Org members can view event search runs"
ON public.demand_event_search_runs
FOR SELECT
TO authenticated
USING (organization_slug = public.get_user_organization_slug(auth.uid()));