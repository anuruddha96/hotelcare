ALTER TABLE public.revenue_engine_config
  ADD COLUMN IF NOT EXISTS automation_lock_hotel uuid,
  ADD COLUMN IF NOT EXISTS automation_lock_at timestamptz;

CREATE OR REPLACE FUNCTION public.claim_automation_lock(p_hotel uuid, p_stale_minutes integer DEFAULT 10)
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

CREATE OR REPLACE FUNCTION public.release_automation_lock(p_hotel uuid)
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

REVOKE ALL ON FUNCTION public.claim_automation_lock(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_automation_lock(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_automation_lock(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_automation_lock(uuid) TO service_role;