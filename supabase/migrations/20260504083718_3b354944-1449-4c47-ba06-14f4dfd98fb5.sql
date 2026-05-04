DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'room_minibar_usage'
      AND policyname = 'Supervisors can review late minibar additions'
  ) THEN
    CREATE POLICY "Supervisors can review late minibar additions"
      ON public.room_minibar_usage
      FOR UPDATE
      USING (
        EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.id = auth.uid()
            AND p.role IN ('admin','top_management','manager','housekeeping_manager')
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.id = auth.uid()
            AND p.role IN ('admin','top_management','manager','housekeeping_manager')
        )
      );
  END IF;
END$$;