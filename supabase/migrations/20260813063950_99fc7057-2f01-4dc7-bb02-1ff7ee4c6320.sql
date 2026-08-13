
CREATE OR REPLACE FUNCTION public.purge_revenue_logs()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  audit_engine int;
  audit_old int;
  sync_old int;
  recs_old int;
BEGIN
  DELETE FROM public.rate_change_audit
   WHERE source = 'engine' AND performed_at < now() - interval '14 days';
  GET DIAGNOSTICS audit_engine = ROW_COUNT;

  DELETE FROM public.rate_change_audit
   WHERE performed_at < now() - interval '120 days';
  GET DIAGNOSTICS audit_old = ROW_COUNT;

  UPDATE public.pms_sync_history
     SET data = NULL
   WHERE data IS NOT NULL AND created_at < now() - interval '14 days';

  DELETE FROM public.pms_sync_history WHERE created_at < now() - interval '60 days';
  GET DIAGNOSTICS sync_old = ROW_COUNT;

  DELETE FROM public.rate_recommendations
   WHERE created_at < now() - interval '30 days' AND status::text <> 'accepted';
  GET DIAGNOSTICS recs_old = ROW_COUNT;

  RETURN jsonb_build_object('audit_engine', audit_engine, 'audit_old', audit_old,
                            'sync_history', sync_old, 'recommendations', recs_old);
END;
$$;

REVOKE ALL ON FUNCTION public.purge_revenue_logs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_revenue_logs() TO service_role;
