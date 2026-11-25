-- Remove the remaining per-row RLS hotspot found after the 7 Oct CPU fix.
-- pms_change_events counted/open-event reads were executing a profiles/RLS
-- subquery once per event row. For ~1,965 open events this turned a simple
-- indexed count into ~5.1 seconds and caused the final observed statement
-- timeout. Resolve the caller's role/hotel scope once per statement.

DROP POLICY IF EXISTS "Hotel staff can view pms change events"
  ON public.pms_change_events;

CREATE POLICY "Hotel staff can view pms change events"
ON public.pms_change_events
FOR SELECT
TO authenticated
USING (
  (SELECT public.get_user_role((SELECT auth.uid()))::text)
    IN ('admin', 'top_management')
  OR (
    (SELECT public.get_user_role((SELECT auth.uid()))::text)
      IN ('manager', 'housekeeping_manager', 'front_office')
    AND hotel_id = ANY (
      (SELECT public.user_assigned_hotel_keys((SELECT auth.uid())))::text[]
    )
  )
);

DROP POLICY IF EXISTS "Hotel staff can resolve pms change events"
  ON public.pms_change_events;

CREATE POLICY "Hotel staff can resolve pms change events"
ON public.pms_change_events
FOR UPDATE
TO authenticated
USING (
  (SELECT public.get_user_role((SELECT auth.uid()))::text)
    IN ('admin', 'top_management')
  OR (
    (SELECT public.get_user_role((SELECT auth.uid()))::text)
      IN ('manager', 'housekeeping_manager', 'front_office')
    AND hotel_id = ANY (
      (SELECT public.user_assigned_hotel_keys((SELECT auth.uid())))::text[]
    )
  )
)
WITH CHECK (
  (SELECT public.get_user_role((SELECT auth.uid()))::text)
    IN ('admin', 'top_management')
  OR (
    (SELECT public.get_user_role((SELECT auth.uid()))::text)
      IN ('manager', 'housekeeping_manager', 'front_office')
    AND hotel_id = ANY (
      (SELECT public.user_assigned_hotel_keys((SELECT auth.uid())))::text[]
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_pms_change_events_open_hotel_cover
  ON public.pms_change_events (hotel_id)
  INCLUDE (id)
  WHERE acknowledged_at IS NULL;

ANALYZE public.pms_change_events;
