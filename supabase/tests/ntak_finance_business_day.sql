-- PostgreSQL-level reproduction: midnight must follow Budapest, not UTC.
-- 00:30 CET is 23:30 UTC on the previous day; CEST is 22:30 UTC.
DO $$
DECLARE
  winter timestamptz := '2026-11-23 00:30:00+01'::timestamptz;
  summer timestamptz := '2026-07-23 00:30:00+02'::timestamptz;
BEGIN
  IF (winter AT TIME ZONE 'Europe/Budapest')::date IS DISTINCT FROM DATE '2026-11-23'
     OR (winter AT TIME ZONE 'UTC')::date IS DISTINCT FROM DATE '2026-11-22' THEN
    RAISE EXCEPTION 'Winter 00:30 Budapest date mismatch';
  END IF;
  IF (summer AT TIME ZONE 'Europe/Budapest')::date IS DISTINCT FROM DATE '2026-07-23'
     OR (summer AT TIME ZONE 'UTC')::date IS DISTINCT FROM DATE '2026-07-22' THEN
    RAISE EXCEPTION 'Summer 00:30 Budapest date mismatch';
  END IF;
END;
$$;
