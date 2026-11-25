DO $$
DECLARE
  v jsonb;
BEGIN
  v := public.get_recent_rollback_evidence();
  IF (v->>'authenticated_request_setup_calls')::bigint <> 150000 THEN
    RAISE EXCEPTION 'Expected 150000 authenticated setup calls; got %', v;
  END IF;
  IF (v->>'service_request_setup_calls')::bigint <> 0 THEN
    RAISE EXCEPTION 'Service data query must not be counted as setup: %', v;
  END IF;
  IF jsonb_array_length(v->'top_query_deltas') <> 2 THEN
    RAISE EXCEPTION 'Expected two sampled statements: %', v;
  END IF;
  IF v->'top_query_deltas'->0->>'category' <> 'postgrest_request_setup' THEN
    RAISE EXCEPTION 'Expected request setup attribution: %', v;
  END IF;
  IF v::text LIKE '%request.jwt.claims%' THEN
    RAISE EXCEPTION 'Telemetry must not expose raw statement text: %', v;
  END IF;
END $$;

-- Reset and stale query snapshots must not yield negative or unbounded deltas.
UPDATE extensions.pg_stat_statements SET calls=1 WHERE queryid=1001;
DO $$
BEGIN
  IF (public.get_recent_rollback_evidence()->>'authenticated_request_setup_calls')::bigint <> 0 THEN
    RAISE EXCEPTION 'Counter resets must be discarded';
  END IF;
END $$;
UPDATE extensions.pg_stat_statements SET calls=150100 WHERE queryid=1001;
UPDATE public.system_monitor_query_snapshot
SET captured_at=now()-interval '2 hours';
DO $$
BEGIN
  IF jsonb_array_length(public.get_recent_rollback_evidence()->'top_query_deltas') <> 0 THEN
    RAISE EXCEPTION 'Stale query snapshots must be discarded';
  END IF;
END $$;

-- Do not expose monitoring RPC to client roles.
DO $$
BEGIN
  IF has_function_privilege('authenticated', 'public.get_recent_rollback_evidence()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.get_recent_rollback_evidence()', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.get_recent_rollback_evidence()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Incorrect diagnostic RPC grants';
  END IF;
END $$;
