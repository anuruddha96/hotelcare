ALTER TABLE public.revenue_engine_config
  ADD COLUMN IF NOT EXISTS publisher_lock_token uuid;

-- Strict global publisher lease. Only ONE worker may own it at a time; an
-- existing lease is only taken over when it is stale. Same-hotel re-entry is
-- deliberately gone: the continuation path releases before the next slice.
CREATE OR REPLACE FUNCTION public.claim_publisher_lease(p_hotel text, p_token uuid, p_stale_minutes integer DEFAULT 15)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_ok boolean;
BEGIN
  UPDATE public.revenue_engine_config
     SET publisher_lock_hotel = p_hotel,
         publisher_lock_at = now(),
         publisher_lock_token = p_token
   WHERE id = 'global'
     AND (publisher_lock_at IS NULL
          OR publisher_lock_token IS NULL
          OR publisher_lock_at < now() - make_interval(mins => GREATEST(1, p_stale_minutes)))
  RETURNING true INTO v_ok;
  RETURN COALESCE(v_ok, false);
END;
$function$;

-- Only the owner of the current lease may release it, so an old slow worker
-- cannot free a newer worker's lease.
CREATE OR REPLACE FUNCTION public.release_publisher_lease(p_token uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.revenue_engine_config
     SET publisher_lock_hotel = NULL, publisher_lock_at = NULL, publisher_lock_token = NULL
   WHERE id = 'global' AND publisher_lock_token = p_token;
END;
$function$;

-- Legacy entrypoints kept for older deployed callers, now strict as well.
CREATE OR REPLACE FUNCTION public.claim_publisher_lock(p_hotel text, p_stale_minutes integer DEFAULT 15)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN public.claim_publisher_lease(p_hotel, gen_random_uuid(), p_stale_minutes);
END;
$function$;

CREATE OR REPLACE FUNCTION public.release_publisher_lock(p_hotel text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.revenue_engine_config
     SET publisher_lock_hotel = NULL, publisher_lock_at = NULL, publisher_lock_token = NULL
   WHERE id = 'global' AND publisher_lock_hotel = p_hotel;
END;
$function$;

-- Global publishing queue: one unfinished run at a time, most urgent first.
-- Manual user changes (10) beat pickup increases (20), reconciliation (30) and
-- no-pickup markdowns (40). A processing run whose worker died is retried.
CREATE OR REPLACE FUNCTION public.claim_next_push_run(p_stale_minutes integer DEFAULT 10)
RETURNS TABLE(run_id uuid, hotel_id text, priority integer, run_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_row public.revenue_rate_push_runs%ROWTYPE;
BEGIN
  SELECT * INTO v_row
    FROM public.revenue_rate_push_runs r
   WHERE (r.status = 'queued'
          OR (r.status = 'processing'
              AND COALESCE(r.started_at, r.created_at) < now() - make_interval(mins => GREATEST(1, p_stale_minutes))))
     AND EXISTS (
       SELECT 1 FROM public.revenue_rate_drafts d
        WHERE d.push_run_id = r.id AND d.status IN ('draft','failed') AND d.superseded_at IS NULL
     )
   ORDER BY COALESCE(r.priority, 50) ASC, r.created_at ASC
   FOR UPDATE SKIP LOCKED
   LIMIT 1;

  IF v_row.id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.revenue_rate_push_runs
     SET status = 'processing', started_at = now()
   WHERE id = v_row.id;

  RETURN QUERY SELECT v_row.id, v_row.hotel_id, COALESCE(v_row.priority, 50), v_row.status;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_publisher_lease(text, uuid, integer) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.release_publisher_lease(uuid) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_next_push_run(integer) FROM anon, authenticated;