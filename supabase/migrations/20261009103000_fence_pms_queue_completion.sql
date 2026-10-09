-- Add a fenced completion RPC without breaking the currently deployed worker.
-- Deploy this migration BEFORE switching the worker to the new RPC.
CREATE OR REPLACE FUNCTION public.finish_pms_refresh_fenced(
  p_job_id uuid, p_attempt integer, p_status text,
  p_result jsonb DEFAULT NULL, p_error text DEFAULT NULL
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp AS $$
DECLARE updated_rows integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Worker only' USING ERRCODE='42501';
  END IF;
  IF p_attempt IS NULL OR p_attempt < 1 OR p_status NOT IN ('success','partial','failed') THEN
    RAISE EXCEPTION 'Invalid claim attempt or completion status' USING ERRCODE='22023';
  END IF;
  UPDATE public.pms_refresh_queue SET
    status=p_status,finished_at=now(),lease_expires_at=NULL,
    result=p_result,error_message=left(p_error,2000)
  WHERE id=p_job_id AND status='running' AND attempt=p_attempt
    AND lease_expires_at > now();
  GET DIAGNOSTICS updated_rows=ROW_COUNT;
  RETURN updated_rows=1;
END $$;
REVOKE ALL ON FUNCTION public.finish_pms_refresh_fenced(uuid,integer,text,jsonb,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finish_pms_refresh_fenced(uuid,integer,text,jsonb,text)
  TO service_role;
COMMENT ON FUNCTION public.finish_pms_refresh_fenced(uuid,integer,text,jsonb,text)
  IS 'Accepts completion only for the still-running, unexpired claim with the exact attempt number';
