-- Persistent global PMS queue groundwork. No existing scheduler is changed by this migration.
CREATE TABLE IF NOT EXISTS public.pms_refresh_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_key text NOT NULL,
  hotel_id text NOT NULL,
  organization_slug text NOT NULL,
  account_id uuid,
  business_date date NOT NULL,
  source text NOT NULL CHECK (source IN ('automatic','manual')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','success','partial','failed','cancelled')),
  priority integer NOT NULL DEFAULT 0,
  requested_by uuid,
  requested_at timestamptz NOT NULL DEFAULT now(),
  not_before timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  lease_expires_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  result jsonb,
  error_message text,
  CONSTRAINT pms_refresh_jobs_attempts CHECK (attempts >= 0 AND max_attempts BETWEEN 1 AND 10)
);
CREATE INDEX IF NOT EXISTS pms_refresh_jobs_pending_idx ON public.pms_refresh_jobs (priority DESC, requested_at ASC) WHERE status='pending';
CREATE UNIQUE INDEX IF NOT EXISTS pms_refresh_jobs_one_running ON public.pms_refresh_jobs ((true)) WHERE status='running';
CREATE UNIQUE INDEX IF NOT EXISTS pms_refresh_jobs_one_auto_per_day ON public.pms_refresh_jobs (business_date,target_key) WHERE source='automatic';
ALTER TABLE public.pms_refresh_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pms_refresh_jobs FROM anon, authenticated;
-- Only trusted backend code may claim or change jobs. Never expose cross-tenant job data.
CREATE OR REPLACE FUNCTION public.hc_claim_next_pms_refresh_job()
RETURNS SETOF public.pms_refresh_jobs LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE selected_id uuid;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN
   RAISE EXCEPTION 'service role required' USING ERRCODE='42501';
 END IF;
 PERFORM pg_advisory_xact_lock(742601, 1);
 -- Expired leases are retried safely; the worker must verify its lease before writing.
 UPDATE public.pms_refresh_jobs
 SET status=CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END,
     error_message='Worker lease expired', finished_at=CASE WHEN attempts >= max_attempts THEN now() ELSE NULL END,
     lease_expires_at=NULL
 WHERE status='running' AND lease_expires_at < now();
 IF EXISTS (SELECT 1 FROM public.pms_refresh_jobs WHERE status='running') THEN RETURN; END IF;
 SELECT id INTO selected_id FROM public.pms_refresh_jobs
 WHERE status='pending' AND not_before <= now()
 ORDER BY priority DESC, requested_at ASC, id ASC
 LIMIT 1 FOR UPDATE SKIP LOCKED;
 IF selected_id IS NULL THEN RETURN; END IF;
 RETURN QUERY UPDATE public.pms_refresh_jobs
 SET status='running', attempts=attempts+1, started_at=now(),
     lease_expires_at=now()+interval '15 minutes', error_message=NULL
 WHERE id=selected_id RETURNING *;
END $$;
REVOKE ALL ON FUNCTION public.hc_claim_next_pms_refresh_job() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hc_claim_next_pms_refresh_job() TO service_role;
COMMENT ON TABLE public.pms_refresh_jobs IS 'Durable PMS refresh work queue; not active until all workers and manual entry points use the same atomic claim protocol.';
