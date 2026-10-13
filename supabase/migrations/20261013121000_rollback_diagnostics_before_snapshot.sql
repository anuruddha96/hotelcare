-- Read-only, restricted telemetry for investigating abrupt transaction rollback spikes.
-- pg_stat_database.xact_rollback alone DOES NOT establish failed writes or data loss.
-- This routine must be called BEFORE detect_system_anomalies() advances its snapshots.
CREATE OR REPLACE FUNCTION public.get_recent_rollback_evidence()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
WITH monitor_snapshot AS (
  SELECT captured_at
  FROM public.system_monitor_db_snapshot
  WHERE singleton IS TRUE
),
statement_deltas AS (
  SELECT
    s.queryid,
    pg_catalog.pg_get_userbyid(s.userid) AS role_name,
    s.calls - prior.calls AS delta_calls,
    CASE
      WHEN pg_catalog.lower(s.query) LIKE '%set_config(%' AND
           pg_catalog.lower(s.query) LIKE '%request.jwt.claims%'
        THEN 'postgrest_request_setup'
      WHEN pg_catalog.lower(s.query) LIKE '%realtime.list_changes%'
        THEN 'realtime_wal_reader'
      WHEN pg_catalog.lower(s.query) LIKE '%pgrst_source%'
        THEN 'postgrest_data_query'
      ELSE 'other_statement'
    END AS category
  FROM extensions.pg_stat_statements s
  JOIN public.system_monitor_query_snapshot prior
    ON prior.userid = s.userid AND prior.dbid = s.dbid AND prior.queryid = s.queryid
  CROSS JOIN monitor_snapshot m
  WHERE s.dbid = (
    SELECT oid FROM pg_catalog.pg_database
    WHERE datname = pg_catalog.current_database()
  )
    AND s.calls >= prior.calls
    AND s.total_exec_time >= prior.total_exec_time
    AND (s.calls - prior.calls) > 0
    AND pg_catalog.extract(EPOCH FROM (pg_catalog.now() - prior.captured_at)) BETWEEN 30 AND 1800
    AND pg_catalog.abs(pg_catalog.extract(EPOCH FROM (prior.captured_at - m.captured_at))) <= 60
),
largest AS (
  SELECT queryid, role_name, delta_calls, category
  FROM statement_deltas
  ORDER BY delta_calls DESC, queryid
  LIMIT 5
)
SELECT pg_catalog.jsonb_build_object(
  'diagnostic_window_seconds', (
    SELECT pg_catalog.round(pg_catalog.extract(EPOCH FROM (pg_catalog.now() - captured_at))::numeric, 1)
    FROM monitor_snapshot
  ),
  'authenticated_request_setup_calls', COALESCE((
    SELECT sum(delta_calls) FROM statement_deltas
    WHERE role_name = 'authenticated' AND category = 'postgrest_request_setup'
  ), 0),
  'service_request_setup_calls', COALESCE((
    SELECT sum(delta_calls) FROM statement_deltas
    WHERE role_name = 'service_role' AND category = 'postgrest_request_setup'
  ), 0),
  'top_query_deltas', COALESCE((
    SELECT pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'role', role_name,
        'category', category,
        'query_id', queryid::text,
        'calls', delta_calls
      ) ORDER BY delta_calls DESC
    )
    FROM largest
  ), '[]'::jsonb),
  'diagnostic_note',
    'Query counters are sampled approximations, not evidence that writes failed. Check PostgreSQL error logs and request traces.'
);
$$;

REVOKE ALL ON FUNCTION public.get_recent_rollback_evidence()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_recent_rollback_evidence()
  TO service_role;
