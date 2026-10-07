-- Automatic HotelCare database anomaly detection and admin e-mail alerts.
-- Detects rollback/error storms plus repeated/high-CPU SQL loops from Postgres
-- runtime counters. The monitor is intentionally database-local: it does not
-- require a Supabase Management API token and does not expose system telemetry
-- to browser roles.

CREATE TABLE IF NOT EXISTS public.system_anomaly_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  enabled boolean NOT NULL DEFAULT true,
  admin_email text NOT NULL DEFAULT 'anuruddha.dharmasena@gmail.com',
  rollback_threshold_5m bigint NOT NULL DEFAULT 250 CHECK (rollback_threshold_5m >= 1),
  query_calls_threshold_5m bigint NOT NULL DEFAULT 5000 CHECK (query_calls_threshold_5m >= 100),
  query_exec_ms_threshold_5m double precision NOT NULL DEFAULT 120000 CHECK (query_exec_ms_threshold_5m >= 1000),
  cooldown_minutes integer NOT NULL DEFAULT 60 CHECK (cooldown_minutes BETWEEN 5 AND 1440),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.system_anomaly_settings (singleton)
VALUES (true)
ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.system_anomaly_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint text NOT NULL,
  kind text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('warning', 'critical')),
  title text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  detected_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent')),
  processing_started_at timestamptz,
  notified_at timestamptz,
  email_message_id text,
  notify_attempts integer NOT NULL DEFAULT 0,
  last_notify_error text
);

CREATE INDEX IF NOT EXISTS idx_system_anomaly_alerts_pending
  ON public.system_anomaly_alerts (status, detected_at)
  WHERE notified_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_system_anomaly_alerts_fingerprint
  ON public.system_anomaly_alerts (fingerprint, detected_at DESC);

CREATE TABLE IF NOT EXISTS public.system_monitor_db_snapshot (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  captured_at timestamptz NOT NULL,
  stats_reset timestamptz,
  xact_commit bigint NOT NULL,
  xact_rollback bigint NOT NULL,
  deadlocks bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS public.system_monitor_query_snapshot (
  userid oid NOT NULL,
  dbid oid NOT NULL,
  queryid bigint NOT NULL,
  calls bigint NOT NULL,
  total_exec_time double precision NOT NULL,
  captured_at timestamptz NOT NULL,
  PRIMARY KEY (userid, dbid, queryid)
);

ALTER TABLE public.system_anomaly_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_anomaly_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_monitor_db_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_monitor_query_snapshot ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.system_anomaly_settings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.system_anomaly_alerts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.system_monitor_db_snapshot FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.system_monitor_query_snapshot FROM PUBLIC, anon, authenticated;

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
    SELECT 1
    FROM public.system_anomaly_alerts
    WHERE fingerprint = p_fingerprint
      AND detected_at >= pg_catalog.now() - pg_catalog.make_interval(mins => coalesce(v_cooldown, 60))
  ) THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.system_anomaly_alerts (
    fingerprint, kind, severity, title, details
  )
  VALUES (
    p_fingerprint,
    p_kind,
    CASE WHEN p_severity = 'critical' THEN 'critical' ELSE 'warning' END,
    pg_catalog.left(p_title, 240),
    coalesce(p_details, '{}'::jsonb)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.hc_enqueue_system_anomaly(text,text,text,text,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hc_enqueue_system_anomaly(text,text,text,text,jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.detect_system_anomalies()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := pg_catalog.now();
  v_settings public.system_anomaly_settings%ROWTYPE;
  v_db record;
  v_prev public.system_monitor_db_snapshot%ROWTYPE;
  v_have_prev boolean := false;
  v_window_seconds double precision;
  v_commit_delta bigint;
  v_rollback_delta bigint;
  v_deadlock_delta bigint;
  v_total_tx bigint;
  v_rollback_ratio double precision;
  v_created integer := 0;
  v_alert_id uuid;
  v_q record;
  v_qprev public.system_monitor_query_snapshot%ROWTYPE;
  v_have_qprev boolean;
  v_delta_calls bigint;
  v_delta_exec double precision;
  v_q_window double precision;
  v_calls_per_second double precision;
  v_severity text;
BEGIN
  SELECT * INTO v_settings
  FROM public.system_anomaly_settings
  WHERE singleton = true;

  IF NOT FOUND OR NOT coalesce(v_settings.enabled, true) THEN
    RETURN pg_catalog.jsonb_build_object('enabled', false, 'created', 0);
  END IF;

  SELECT
    d.stats_reset,
    d.xact_commit,
    d.xact_rollback,
    d.deadlocks
  INTO v_db
  FROM pg_catalog.pg_stat_database d
  WHERE d.datname = pg_catalog.current_database();

  SELECT * INTO v_prev
  FROM public.system_monitor_db_snapshot
  WHERE singleton = true;
  v_have_prev := FOUND;

  IF v_have_prev
     AND v_prev.stats_reset IS NOT DISTINCT FROM v_db.stats_reset
     AND v_db.xact_commit >= v_prev.xact_commit
     AND v_db.xact_rollback >= v_prev.xact_rollback
     AND v_db.deadlocks >= v_prev.deadlocks THEN

    v_window_seconds := extract(epoch FROM (v_now - v_prev.captured_at));
    IF v_window_seconds BETWEEN 30 AND 1800 THEN
      v_commit_delta := v_db.xact_commit - v_prev.xact_commit;
      v_rollback_delta := v_db.xact_rollback - v_prev.xact_rollback;
      v_deadlock_delta := v_db.deadlocks - v_prev.deadlocks;
      v_total_tx := v_commit_delta + v_rollback_delta;
      v_rollback_ratio := CASE WHEN v_total_tx > 0
        THEN v_rollback_delta::double precision / v_total_tx::double precision
        ELSE 0 END;

      IF v_rollback_delta >= v_settings.rollback_threshold_5m
         AND (v_rollback_ratio >= 0.05 OR v_rollback_delta >= 1000) THEN
        v_severity := CASE
          WHEN v_rollback_delta >= 1000 OR v_rollback_ratio >= 0.25 THEN 'critical'
          ELSE 'warning'
        END;
        v_alert_id := public.hc_enqueue_system_anomaly(
          'db:rollback_storm',
          'rollback_storm',
          v_severity,
          'Database rollback/error storm detected',
          pg_catalog.jsonb_build_object(
            'window_seconds', pg_catalog.round(v_window_seconds::numeric, 1),
            'rollbacks', v_rollback_delta,
            'commits', v_commit_delta,
            'rollback_ratio_percent', pg_catalog.round((v_rollback_ratio * 100)::numeric, 2),
            'threshold', v_settings.rollback_threshold_5m
          )
        );
        IF v_alert_id IS NOT NULL THEN v_created := v_created + 1; END IF;
      END IF;

      IF v_deadlock_delta >= 3 THEN
        v_alert_id := public.hc_enqueue_system_anomaly(
          'db:deadlock_spike',
          'deadlock_spike',
          'critical',
          'Database deadlock spike detected',
          pg_catalog.jsonb_build_object(
            'window_seconds', pg_catalog.round(v_window_seconds::numeric, 1),
            'deadlocks', v_deadlock_delta
          )
        );
        IF v_alert_id IS NOT NULL THEN v_created := v_created + 1; END IF;
      END IF;
    END IF;
  END IF;

  INSERT INTO public.system_monitor_db_snapshot (
    singleton, captured_at, stats_reset, xact_commit, xact_rollback, deadlocks
  )
  VALUES (
    true, v_now, v_db.stats_reset, v_db.xact_commit, v_db.xact_rollback, v_db.deadlocks
  )
  ON CONFLICT (singleton) DO UPDATE SET
    captured_at = EXCLUDED.captured_at,
    stats_reset = EXCLUDED.stats_reset,
    xact_commit = EXCLUDED.xact_commit,
    xact_rollback = EXCLUDED.xact_rollback,
    deadlocks = EXCLUDED.deadlocks;

  FOR v_q IN
    WITH ranked AS (
      SELECT
        s.userid,
        s.dbid,
        s.queryid,
        s.calls,
        s.total_exec_time,
        pg_catalog.left(pg_catalog.regexp_replace(s.query, E'\\s+', ' ', 'g'), 1200) AS query_sample,
        row_number() OVER (ORDER BY s.calls DESC) AS by_calls,
        row_number() OVER (ORDER BY s.total_exec_time DESC) AS by_exec
      FROM extensions.pg_stat_statements s
      WHERE s.dbid = (
        SELECT oid FROM pg_catalog.pg_database
        WHERE datname = pg_catalog.current_database()
      )
        AND s.queryid IS NOT NULL
    )
    SELECT *
    FROM ranked
    WHERE by_calls <= 250 OR by_exec <= 250
  LOOP
    IF position('detect_system_anomalies' IN pg_catalog.lower(v_q.query_sample)) > 0
       OR position('system_monitor_query_snapshot' IN pg_catalog.lower(v_q.query_sample)) > 0
       OR position('pg_stat_statements' IN pg_catalog.lower(v_q.query_sample)) > 0 THEN
      CONTINUE;
    END IF;

    SELECT * INTO v_qprev
    FROM public.system_monitor_query_snapshot
    WHERE userid = v_q.userid
      AND dbid = v_q.dbid
      AND queryid = v_q.queryid;
    v_have_qprev := FOUND;

    IF v_have_qprev
       AND v_q.calls >= v_qprev.calls
       AND v_q.total_exec_time >= v_qprev.total_exec_time THEN
      v_q_window := extract(epoch FROM (v_now - v_qprev.captured_at));

      IF v_q_window BETWEEN 30 AND 1800 THEN
        v_delta_calls := v_q.calls - v_qprev.calls;
        v_delta_exec := v_q.total_exec_time - v_qprev.total_exec_time;
        v_calls_per_second := CASE WHEN v_q_window > 0
          THEN v_delta_calls::double precision / v_q_window
          ELSE 0 END;

        IF v_delta_calls >= v_settings.query_calls_threshold_5m
           AND (v_calls_per_second >= 10 OR v_delta_calls >= (v_settings.query_calls_threshold_5m * 2)) THEN
          v_severity := CASE
            WHEN v_delta_calls >= (v_settings.query_calls_threshold_5m * 4) THEN 'critical'
            ELSE 'warning'
          END;
          v_alert_id := public.hc_enqueue_system_anomaly(
            pg_catalog.format('query_loop:%s:%s:%s', v_q.userid, v_q.dbid, v_q.queryid),
            'query_loop',
            v_severity,
            'Repeated database query loop detected',
            pg_catalog.jsonb_build_object(
              'window_seconds', pg_catalog.round(v_q_window::numeric, 1),
              'query_calls', v_delta_calls,
              'calls_per_second', pg_catalog.round(v_calls_per_second::numeric, 2),
              'total_exec_time_ms', pg_catalog.round(v_delta_exec::numeric, 1),
              'query_id', v_q.queryid::text,
              'query_sample', v_q.query_sample
            )
          );
          IF v_alert_id IS NOT NULL THEN v_created := v_created + 1; END IF;
        END IF;

        IF v_delta_exec >= v_settings.query_exec_ms_threshold_5m
           AND v_delta_calls >= 100 THEN
          v_alert_id := public.hc_enqueue_system_anomaly(
            pg_catalog.format('query_cpu:%s:%s:%s', v_q.userid, v_q.dbid, v_q.queryid),
            'query_cpu_hotspot',
            CASE WHEN v_delta_exec >= (v_settings.query_exec_ms_threshold_5m * 2) THEN 'critical' ELSE 'warning' END,
            'High database query CPU/time usage detected',
            pg_catalog.jsonb_build_object(
              'window_seconds', pg_catalog.round(v_q_window::numeric, 1),
              'query_calls', v_delta_calls,
              'total_exec_time_ms', pg_catalog.round(v_delta_exec::numeric, 1),
              'average_exec_ms', pg_catalog.round((v_delta_exec / NULLIF(v_delta_calls, 0))::numeric, 2),
              'query_id', v_q.queryid::text,
              'query_sample', v_q.query_sample
            )
          );
          IF v_alert_id IS NOT NULL THEN v_created := v_created + 1; END IF;
        END IF;
      END IF;
    END IF;

    INSERT INTO public.system_monitor_query_snapshot (
      userid, dbid, queryid, calls, total_exec_time, captured_at
    )
    VALUES (
      v_q.userid, v_q.dbid, v_q.queryid, v_q.calls, v_q.total_exec_time, v_now
    )
    ON CONFLICT (userid, dbid, queryid) DO UPDATE SET
      calls = EXCLUDED.calls,
      total_exec_time = EXCLUDED.total_exec_time,
      captured_at = EXCLUDED.captured_at;
  END LOOP;

  DELETE FROM public.system_monitor_query_snapshot
  WHERE captured_at < v_now - interval '24 hours';

  RETURN pg_catalog.jsonb_build_object(
    'enabled', true,
    'created', v_created,
    'checked_at', v_now
  );
END;
$$;

REVOKE ALL ON FUNCTION public.detect_system_anomalies()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.detect_system_anomalies()
  TO service_role;

CREATE OR REPLACE FUNCTION public.claim_system_anomaly_alerts(p_limit integer DEFAULT 10)
RETURNS SETOF public.system_anomaly_alerts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  WITH claimable AS (
    SELECT a.id
    FROM public.system_anomaly_alerts a
    WHERE a.notified_at IS NULL
      AND a.notify_attempts < 5
      AND (
        a.status = 'pending'
        OR (a.status = 'sending' AND a.processing_started_at < pg_catalog.now() - interval '15 minutes')
      )
    ORDER BY
      CASE a.severity WHEN 'critical' THEN 0 ELSE 1 END,
      a.detected_at
    FOR UPDATE SKIP LOCKED
    LIMIT greatest(1, least(coalesce(p_limit, 10), 20))
  )
  UPDATE public.system_anomaly_alerts a
  SET status = 'sending',
      processing_started_at = pg_catalog.now(),
      notify_attempts = a.notify_attempts + 1,
      last_notify_error = NULL
  FROM claimable c
  WHERE a.id = c.id
  RETURNING a.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_system_anomaly_alerts(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_system_anomaly_alerts(integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.get_system_anomaly_worker_secret()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT decrypted_secret
  FROM vault.decrypted_secrets
  WHERE name = 'system_anomaly_worker_secret'
  ORDER BY created_at DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_system_anomaly_worker_secret()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_system_anomaly_worker_secret()
  TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets
    WHERE name = 'system_anomaly_worker_secret'
  ) THEN
    PERFORM vault.create_secret(
      pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '') ||
      pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', ''),
      'system_anomaly_worker_secret',
      'HotelCare system anomaly monitor cron authentication'
    );
  END IF;
END
$$;

DO $$
DECLARE
  v_job_id bigint;
BEGIN
  FOR v_job_id IN
    SELECT jobid FROM cron.job
    WHERE jobname = 'hotelcare-system-anomaly-monitor'
  LOOP
    PERFORM cron.unschedule(v_job_id);
  END LOOP;

  PERFORM cron.schedule(
    'hotelcare-system-anomaly-monitor',
    '*/5 * * * *',
    $cron$
      SELECT net.http_post(
        url := 'https://pcmszqqklkolvvlabohq.supabase.co/functions/v1/system-anomaly-monitor',
        headers := pg_catalog.jsonb_build_object(
          'Content-Type', 'application/json',
          'x-worker-secret', (
            SELECT decrypted_secret
            FROM vault.decrypted_secrets
            WHERE name = 'system_anomaly_worker_secret'
            ORDER BY created_at DESC
            LIMIT 1
          )
        ),
        body := pg_catalog.jsonb_build_object(
          'trigger', 'cron',
          'scheduled_at', pg_catalog.now()
        ),
        timeout_milliseconds := 60000
      ) AS request_id;
    $cron$
  );
END
$$;
