-- Unconfirmed PostgreSQL rollback counter spikes must never be labeled as a
-- verified critical application failure. Real deadlocks retain their own
-- separately generated critical 'deadlock_spike' alerts.
-- All existing cooldowns, permissions, and other alert severities are preserved.
CREATE OR REPLACE FUNCTION public.hc_enqueue_system_anomaly(
  p_fingerprint text,
  p_kind text,
  p_severity text,
  p_title text,
  p_details jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id uuid;
  v_cooldown integer := 60;
BEGIN
  SELECT cooldown_minutes INTO v_cooldown
  FROM public.system_anomaly_settings
  WHERE singleton = true;

  IF EXISTS (
    SELECT 1 FROM public.system_anomaly_alerts
    WHERE fingerprint = p_fingerprint
      AND detected_at >= pg_catalog.now() - pg_catalog.make_interval(mins => coalesce(v_cooldown, 60))
  ) THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.system_anomaly_alerts (fingerprint, kind, severity, title, details)
  VALUES (
    p_fingerprint,
    p_kind,
    CASE WHEN p_kind = 'rollback_storm' THEN 'warning'
         WHEN p_severity = 'critical' THEN 'critical' ELSE 'warning' END,
    CASE WHEN p_kind = 'rollback_storm'
      THEN 'Unusually high PostgreSQL rollback rate (cause unconfirmed)'
      ELSE pg_catalog.left(p_title, 240) END,
    CASE WHEN p_kind = 'rollback_storm'
      THEN coalesce(p_details, '{}'::jsonb) || pg_catalog.jsonb_build_object(
        'severity_basis', 'Rollback counts alone do not confirm SQL errors, failed application writes or data loss.',
        'log_correlation', 'Check PostgreSQL errors, Edge failures and HTTP request traces in the same time window.'
      )
      ELSE coalesce(p_details, '{}'::jsonb) END
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.hc_enqueue_system_anomaly(text,text,text,text,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hc_enqueue_system_anomaly(text,text,text,text,jsonb)
  TO service_role;
