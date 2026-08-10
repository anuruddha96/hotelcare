DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'rate_change_audit'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.rate_change_audit;
  END IF;
END
$$;