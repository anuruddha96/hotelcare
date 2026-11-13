-- Reception planner live refresh: stream reservation changes to the planner.
-- Realtime postgres_changes respects the existing RLS policies on public.reservations,
-- so a user only receives events for bookings they can already read.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'reservations'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.reservations;
  END IF;
END
$$;
