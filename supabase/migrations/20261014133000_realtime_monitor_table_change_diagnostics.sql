-- Database-local evidence for expensive Supabase Realtime list_changes queries.
-- Cumulative pg_stat_user_tables counters are NOT an interval rate until we
-- have two snapshots. This module records a small fixed set of tables.
-- Accessible to the anomaly monitor's service role only; no user IDs, filters,
-- emails, or room/guest details are included in alert payloads.

CREATE TABLE IF NOT EXISTS public.system_monitor_realtime_table_snapshot (
  relid oid PRIMARY KEY,
  table_name text NOT NULL,
  captured_at timestamptz NOT NULL,
  n_tup_ins bigint NOT NULL,
  n_tup_upd bigint NOT NULL,
  n_tup_del bigint NOT NULL
);
ALTER TABLE public.system_monitor_realtime_table_snapshot ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.system_monitor_realtime_table_snapshot FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.hc_capture_realtime_table_evidence()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_at timestamptz := pg_catalog.clock_timestamp();
  v_changes jsonb := '[]'::jsonb;
  v_subscriptions jsonb := '[]'::jsonb;
BEGIN
  WITH current_stats AS (
    SELECT s.relid, s.relname::text AS table_name,
           s.n_tup_ins, s.n_tup_upd, s.n_tup_del
    FROM pg_catalog.pg_stat_user_tables s
    WHERE s.schemaname = 'public'
      AND s.relname IN (
        'rooms', 'room_assignments', 'tickets', 'housekeeping_notes',
        'dirty_linen_counts', 'break_requests', 'pms_change_events',
        'rate_change_audit', 'revenue_automation_notifications'
      )
  ),
  deltas AS (
    SELECT s.table_name,
      pg_catalog.round(pg_catalog.extract(epoch FROM (v_at-p.captured_at))::numeric, 1) AS window_seconds,
      CASE
        WHEN pg_catalog.extract(epoch FROM (v_at-p.captured_at)) BETWEEN 60 AND 1800
          AND s.n_tup_ins >= p.n_tup_ins
          AND s.n_tup_upd >= p.n_tup_upd
          AND s.n_tup_del >= p.n_tup_del
        THEN s.n_tup_ins - p.n_tup_ins
      END AS inserted,
      CASE
        WHEN pg_catalog.extract(epoch FROM (v_at-p.captured_at)) BETWEEN 60 AND 1800
          AND s.n_tup_ins >= p.n_tup_ins
          AND s.n_tup_upd >= p.n_tup_upd
          AND s.n_tup_del >= p.n_tup_del
        THEN s.n_tup_upd - p.n_tup_upd
      END AS updated,
      CASE
        WHEN pg_catalog.extract(epoch FROM (v_at-p.captured_at)) BETWEEN 60 AND 1800
          AND s.n_tup_ins >= p.n_tup_ins
          AND s.n_tup_upd >= p.n_tup_upd
          AND s.n_tup_del >= p.n_tup_del
        THEN s.n_tup_del - p.n_tup_del
      END AS deleted
    FROM current_stats s
    LEFT JOIN public.system_monitor_realtime_table_snapshot p ON p.relid=s.relid
  )
  SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) ORDER BY x.updated DESC NULLS LAST), '[]'::jsonb)
    INTO v_changes
  FROM (SELECT * FROM deltas ORDER BY updated DESC NULLS LAST LIMIT 9) x;

  INSERT INTO public.system_monitor_realtime_table_snapshot (
    relid, table_name, captured_at, n_tup_ins, n_tup_upd, n_tup_del
  )
  SELECT s.relid, s.relname::text, v_at, s.n_tup_ins, s.n_tup_upd, s.n_tup_del
  FROM pg_catalog.pg_stat_user_tables s
  WHERE s.schemaname='public'
    AND s.relname IN (
      'rooms','room_assignments','tickets','housekeeping_notes',
      'dirty_linen_counts','break_requests','pms_change_events',
      'rate_change_audit','revenue_automation_notifications'
    )
  ON CONFLICT (relid) DO UPDATE SET
    table_name=EXCLUDED.table_name, captured_at=EXCLUDED.captured_at,
    n_tup_ins=EXCLUDED.n_tup_ins, n_tup_upd=EXCLUDED.n_tup_upd,
    n_tup_del=EXCLUDED.n_tup_del;

  SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'table_name', q.table_name, 'subscriptions', q.total
    ) ORDER BY q.total DESC), '[]'::jsonb)
    INTO v_subscriptions
  FROM (
    SELECT s.entity::pg_catalog.regclass::text AS table_name, pg_catalog.count(*) AS total
    FROM realtime.subscription s
    GROUP BY s.entity
    ORDER BY total DESC LIMIT 9
  ) q;

  RETURN pg_catalog.jsonb_build_object(
    'sampled_at', v_at,
    'table_change_intervals', v_changes,
    'realtime_subscription_counts', v_subscriptions,
    'interpretation', 'These are sampled table-row change deltas, not failed writes, CPU time, unique user counts, or proof of a particular causal query. Null intervals mean no comparable 1-30 minute prior snapshot.'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.hc_capture_realtime_table_evidence() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hc_capture_realtime_table_evidence() TO service_role;
