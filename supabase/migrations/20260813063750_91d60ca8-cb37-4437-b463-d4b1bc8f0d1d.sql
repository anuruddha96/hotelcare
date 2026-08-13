
-- 1. Global RM control, admin configurable ---------------------------------
CREATE TABLE IF NOT EXISTS public.revenue_engine_config (
  id text PRIMARY KEY DEFAULT 'global',
  automation_enabled boolean NOT NULL DEFAULT false,
  engine_tick_enabled boolean NOT NULL DEFAULT true,
  dry_run boolean NOT NULL DEFAULT true,
  pause_reason text,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT revenue_engine_config_singleton CHECK (id = 'global')
);

GRANT SELECT ON public.revenue_engine_config TO authenticated;
GRANT ALL ON public.revenue_engine_config TO service_role;

ALTER TABLE public.revenue_engine_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rec_read" ON public.revenue_engine_config;
CREATE POLICY "rec_read" ON public.revenue_engine_config
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "rec_admin_write" ON public.revenue_engine_config;
CREATE POLICY "rec_admin_write" ON public.revenue_engine_config
  FOR UPDATE TO authenticated
  USING (public.get_current_user_role() = 'admin'::user_role)
  WITH CHECK (public.get_current_user_role() = 'admin'::user_role);

INSERT INTO public.revenue_engine_config (id, automation_enabled, engine_tick_enabled, dry_run, pause_reason)
VALUES ('global', false, true, true, 'Paused to relieve database disk I/O')
ON CONFLICT (id) DO NOTHING;

-- 2. Index for the expensive price-history queries -------------------------
CREATE INDEX IF NOT EXISTS rate_change_audit_hotel_source_time_idx
  ON public.rate_change_audit (hotel_id, source, performed_at DESC);

-- 3. Retention: stop keeping detailed logs forever -------------------------
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

  -- Keep a compact record: drop the bulky payload after 14 days, the row after 60.
  UPDATE public.pms_sync_history
     SET details = NULL
   WHERE details IS NOT NULL AND created_at < now() - interval '14 days';

  DELETE FROM public.pms_sync_history WHERE created_at < now() - interval '60 days';
  GET DIAGNOSTICS sync_old = ROW_COUNT;

  DELETE FROM public.rate_recommendations
   WHERE created_at < now() - interval '30 days' AND status <> 'accepted';
  GET DIAGNOSTICS recs_old = ROW_COUNT;

  RETURN jsonb_build_object('audit_engine', audit_engine, 'audit_old', audit_old,
                            'sync_history', sync_old, 'recommendations', recs_old);
END;
$$;

REVOKE ALL ON FUNCTION public.purge_revenue_logs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_revenue_logs() TO service_role;

-- 4. Lighter schedules -----------------------------------------------------
SELECT cron.alter_job(11, schedule => '*/30 * * * *');
SELECT cron.alter_job(2,  schedule => '0 * * * *');
SELECT cron.alter_job(4,  schedule => '0 */3 * * *');

SELECT cron.schedule('purge-revenue-logs', '40 3 * * *', 'SELECT public.purge_revenue_logs();');
