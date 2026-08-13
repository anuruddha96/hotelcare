DROP FUNCTION IF EXISTS public.claim_automation_lock(uuid, integer);
DROP FUNCTION IF EXISTS public.release_automation_lock(uuid);

ALTER TABLE public.revenue_engine_config
  ALTER COLUMN automation_lock_hotel TYPE text USING automation_lock_hotel::text;

CREATE OR REPLACE FUNCTION public.claim_automation_lock(p_hotel text, p_stale_minutes integer DEFAULT 10)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_ok boolean;
BEGIN
  UPDATE public.revenue_engine_config
     SET automation_lock_hotel = p_hotel,
         automation_lock_at = now()
   WHERE id = 'global'
     AND (automation_lock_at IS NULL
          OR automation_lock_at < now() - make_interval(mins => GREATEST(1, p_stale_minutes)))
  RETURNING true INTO v_ok;
  RETURN COALESCE(v_ok, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.release_automation_lock(p_hotel text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.revenue_engine_config
     SET automation_lock_hotel = NULL,
         automation_lock_at = NULL
   WHERE id = 'global' AND automation_lock_hotel = p_hotel;
$$;

REVOKE ALL ON FUNCTION public.claim_automation_lock(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_automation_lock(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_automation_lock(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_automation_lock(text) TO service_role;