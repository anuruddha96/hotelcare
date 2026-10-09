-- Dark deployment: no cron, UI or production synchronisation is switched to this queue.
-- A separate, explicit cutover is required after full-refresh parity and staging tests.
CREATE TABLE IF NOT EXISTS public.pms_refresh_queue_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  enabled boolean NOT NULL DEFAULT false,
  enabled_at timestamptz,
  enabled_by uuid
);
INSERT INTO public.pms_refresh_queue_settings (id,enabled) VALUES (true,false)
ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.pms_refresh_queue_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pms_refresh_queue_settings FROM anon,authenticated;
GRANT SELECT ON public.pms_refresh_queue_settings TO service_role;

CREATE OR REPLACE FUNCTION public.hc_schedule_pms_refresh_day(p_business_date date)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public, pg_temp AS $$
DECLARE inserted integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE='42501';
  END IF;
  IF p_business_date IS NULL THEN RAISE EXCEPTION 'business date required'; END IF;
  WITH standard_hotels AS (
    SELECT DISTINCT
      c.hotel_id, o.slug::text AS organization_slug,
      'hotel:' || c.hotel_id AS target_key, NULL::uuid AS account_id,
      CASE c.hotel_id
        WHEN 'memories-budapest' THEN 0
        WHEN 'mika-downtown' THEN 1
        WHEN 'ottofiori' THEN 2
        WHEN 'gozsdu-court' THEN 3 ELSE 4 END AS sort_order,
      c.hotel_id AS sort_name
    FROM public.pms_configurations c
    JOIN public.hotel_configurations hc ON hc.hotel_id=c.hotel_id AND hc.is_active=true
    JOIN public.organizations o ON o.id=hc.organization_id AND o.is_active=true
    WHERE c.pms_type='previo' AND c.is_active=true AND c.sync_enabled=true
      AND NOT EXISTS (
        SELECT 1 FROM public.pms_accounts a
        WHERE a.hotel_id=c.hotel_id AND a.is_active=true AND a.sync_paused=false
          AND a.pms_type='previo'
      )
  ), active_accounts AS (
    SELECT DISTINCT
      a.hotel_id, a.organization_slug, 'account:' || a.id::text AS target_key,
      a.id AS account_id, 5 AS sort_order, a.label AS sort_name
    FROM public.pms_accounts a
    JOIN public.organizations o ON o.slug=a.organization_slug AND o.is_active=true
    WHERE a.organization_slug='slnt' AND a.is_active=true AND a.sync_paused=false AND a.pms_type='previo'
  ), ranked AS (
    SELECT targets.*,
      (row_number() OVER (ORDER BY sort_order, sort_name, target_key)-1)::integer AS slot
    FROM (SELECT * FROM standard_hotels UNION ALL SELECT * FROM active_accounts) targets
  )
  INSERT INTO public.pms_refresh_jobs (
    target_key,hotel_id,organization_slug,account_id,business_date,source,status,
    priority,not_before
  )
  SELECT target_key,hotel_id,organization_slug,account_id,p_business_date,'automatic',
         'pending',0,
         ((p_business_date::timestamp + interval '6 hours') AT TIME ZONE 'Europe/Budapest')
           + slot * interval '10 minutes'
  FROM ranked
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS inserted = ROW_COUNT;
  RETURN inserted;
END $$;
REVOKE ALL ON FUNCTION public.hc_schedule_pms_refresh_day(date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hc_schedule_pms_refresh_day(date) TO service_role;

-- Persist the claim and its exact attempt number. Only the active worker can finish it.
CREATE OR REPLACE FUNCTION public.hc_finish_pms_refresh_job(
  p_job_id uuid, p_attempt integer, p_outcome text,
  p_result jsonb DEFAULT NULL, p_error text DEFAULT NULL
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public, pg_temp AS $$
DECLARE updated_rows integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE='42501';
  END IF;
  IF p_outcome NOT IN ('success','partial','failed') THEN
    RAISE EXCEPTION 'Invalid PMS job completion status' USING ERRCODE='22023';
  END IF;
  UPDATE public.pms_refresh_jobs j SET
    status=CASE WHEN p_outcome='failed' AND j.attempts<j.max_attempts
                THEN 'pending' ELSE p_outcome END,
    result=p_result,
    error_message=left(p_error,2000),
    not_before=CASE WHEN p_outcome='failed' AND j.attempts<j.max_attempts
                    THEN now() + make_interval(secs=>least(300,greatest(30,j.attempts*30)))
                    ELSE j.not_before END,
    finished_at=CASE WHEN p_outcome='failed' AND j.attempts<j.max_attempts
                     THEN NULL ELSE now() END,
    lease_expires_at=NULL
  WHERE j.id=p_job_id AND j.status='running' AND j.attempts=p_attempt
    AND j.lease_expires_at>now();
  GET DIAGNOSTICS updated_rows=ROW_COUNT;
  RETURN updated_rows=1;
END $$;
REVOKE ALL ON FUNCTION public.hc_finish_pms_refresh_job(uuid,integer,text,jsonb,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hc_finish_pms_refresh_job(uuid,integer,text,jsonb,text)
  TO service_role;

-- Preserve the global single-running-job lock. Manual work is served first.
-- Enforce >=10-minute separation between automatic starts even when jobs have
-- accumulated while manual requests were being processed.
CREATE OR REPLACE FUNCTION public.hc_claim_next_pms_refresh_job()
RETURNS SETOF public.pms_refresh_jobs LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE selected_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE='42501';
  END IF;
  PERFORM pg_advisory_xact_lock(742601,1);
  UPDATE public.pms_refresh_jobs
  SET status=CASE WHEN attempts>=max_attempts THEN 'failed' ELSE 'pending' END,
      error_message='Worker lease expired',
      finished_at=CASE WHEN attempts>=max_attempts THEN now() ELSE NULL END,
      not_before=CASE WHEN attempts<max_attempts THEN now()+interval '30 seconds'
                      ELSE not_before END,
      lease_expires_at=NULL
  WHERE status='running' AND lease_expires_at<now();
  IF EXISTS (SELECT 1 FROM public.pms_refresh_jobs WHERE status='running') THEN RETURN; END IF;
  SELECT j.id INTO selected_id FROM public.pms_refresh_jobs j
  WHERE j.status='pending' AND j.not_before<=now()
    AND (j.source='manual' OR NOT EXISTS (
      SELECT 1 FROM public.pms_refresh_jobs previous
      WHERE previous.source='automatic'
        AND previous.started_at>now()-interval '10 minutes'
    ))
  ORDER BY j.priority DESC,j.requested_at ASC,j.id ASC
  LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF selected_id IS NULL THEN RETURN; END IF;
  RETURN QUERY UPDATE public.pms_refresh_jobs
    SET status='running',attempts=attempts+1,started_at=now(),
        lease_expires_at=now()+interval '15 minutes',error_message=NULL
    WHERE id=selected_id RETURNING *;
END $$;
REVOKE ALL ON FUNCTION public.hc_claim_next_pms_refresh_job() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hc_claim_next_pms_refresh_job() TO service_role;

COMMENT ON TABLE public.pms_refresh_queue_settings IS
'Fail-closed cutover switch, initially off; first activate only after disabling the legacy morning cron and validating manual/automatic full-refresh parity.';
