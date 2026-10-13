-- Disposable PostgreSQL CI fixture. The real project provides these monitor tables,
-- extension view, and role names; the fixture supplies the smallest required surface.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='anon') THEN
    CREATE ROLE anon;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='authenticated') THEN
    CREATE ROLE authenticated;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='service_role') THEN
    CREATE ROLE service_role;
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE TABLE public.system_monitor_db_snapshot (
  singleton boolean PRIMARY KEY, captured_at timestamptz NOT NULL
);
CREATE TABLE public.system_monitor_query_snapshot (
  userid oid NOT NULL, dbid oid NOT NULL, queryid bigint NOT NULL,
  calls bigint NOT NULL, total_exec_time double precision NOT NULL,
  captured_at timestamptz NOT NULL,
  PRIMARY KEY (userid,dbid,queryid)
);
CREATE TABLE extensions.pg_stat_statements (
  userid oid NOT NULL, dbid oid NOT NULL, queryid bigint NOT NULL,
  calls bigint NOT NULL, total_exec_time double precision NOT NULL,
  query text NOT NULL
);
INSERT INTO public.system_monitor_db_snapshot(singleton,captured_at)
VALUES (TRUE, now() - interval '5 minutes');
INSERT INTO public.system_monitor_query_snapshot(userid,dbid,queryid,calls,total_exec_time,captured_at)
SELECT oid, (SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database()), 1001, 100, 50, now() - interval '5 minutes'
FROM pg_catalog.pg_roles WHERE rolname='authenticated';
INSERT INTO extensions.pg_stat_statements(userid,dbid,queryid,calls,total_exec_time,query)
SELECT oid, (SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database()), 1001, 150100, 1000,
'select set_config(''search_path'', $1, true), set_config(''request.jwt.claims'', $2, true)'
FROM pg_catalog.pg_roles WHERE rolname='authenticated';
INSERT INTO public.system_monitor_query_snapshot(userid,dbid,queryid,calls,total_exec_time,captured_at)
SELECT oid, (SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database()), 1002, 50, 20, now() - interval '5 minutes'
FROM pg_catalog.pg_roles WHERE rolname='service_role';
INSERT INTO extensions.pg_stat_statements(userid,dbid,queryid,calls,total_exec_time,query)
SELECT oid, (SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database()), 1002, 150, 40,
'WITH pgrst_source AS (SELECT 1) SELECT 1'
FROM pg_catalog.pg_roles WHERE rolname='service_role';
