-- Reduce Supabase Realtime's WAL decoding work during bulk hotel rate pushes.
-- rate_change_audit is the durable audit ledger (millions of rows). It is
-- queried on demand by useRateAudit / rate_cell_markers, not needed as a live
-- Postgres Changes feed. A single large Previo publishing run can emit 5,000+
-- audit rows within minutes, saturating realtime.list_changes.
--
-- Never delete audit history or change the Previo/revenue publishing flow.
-- The Revenue history hook now uses visible-tab refresh at a bounded cadence.
-- Keep operational tables (tickets, rooms, room_assignments, etc.) streaming.
DO $
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'rate_change_audit'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime DROP TABLE public.rate_change_audit';
  END IF;
END
$;

-- Reversal, if ever needed:
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.rate_change_audit;
