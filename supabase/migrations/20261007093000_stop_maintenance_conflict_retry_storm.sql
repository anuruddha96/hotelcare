-- Hotfix: avoid treating stale maintenance UI state as a PostgreSQL serialization
-- failure. SQLSTATE 40001 causes PostgREST/client retry behavior and generated
-- millions of repeated database errors. Keep optimistic concurrency protection,
-- but return a normal application error that must not be automatically retried.

DO $$
DECLARE
  fn record;
  body text;
BEGIN
  FOR fn IN
    SELECT p.oid, n.nspname, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND p.proname IN ('work_maintenance_ticket', 'manage_maintenance_ticket')
  LOOP
    body := pg_get_functiondef(fn.oid);
    body := replace(
      body,
      'USING ERRCODE = ''40001''',
      'USING ERRCODE = ''P0001'', HINT = ''Refresh the ticket before retrying.'''
    );
    EXECUTE body;
  END LOOP;
END
$$;
