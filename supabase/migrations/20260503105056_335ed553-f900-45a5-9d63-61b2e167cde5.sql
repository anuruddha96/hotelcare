
-- Helper: can the user access this specific hotel?
CREATE OR REPLACE FUNCTION public.user_can_access_hotel(_uid uuid, _hotel_id text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = _uid
      AND (
        p.role IN ('admin','top_management')
        OR p.assigned_hotel = _hotel_id
        OR p.assigned_hotel = public.get_hotel_name_from_id(_hotel_id)
      )
  );
$$;

-- Tighten policies on Phase-1 RPG tables: admin/top_management write, managers read-only,
-- and always scoped to the user's hotel
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'room_types','dow_adjustments','monthly_adjustments','lead_time_adjustments',
    'occupancy_targets','occupancy_strategy','yielding_tags','min_stay_settings',
    'surge_settings','benchmark_snapshots','pms_rate_plan_mappings','hotel_data_sources'
  ])
  LOOP
    EXECUTE format($p$
      DROP POLICY IF EXISTS "rev_admin_read_%1$s" ON public.%1$I;
      DROP POLICY IF EXISTS "rev_admin_write_%1$s" ON public.%1$I;
      CREATE POLICY "rev_read_%1$s" ON public.%1$I FOR SELECT TO authenticated
        USING (
          organization_slug = public.get_user_organization_slug(auth.uid())
          AND public.get_user_role(auth.uid()) IN ('admin','top_management','manager','housekeeping_manager')
          AND public.user_can_access_hotel(auth.uid(), hotel_id)
        );
      CREATE POLICY "rev_write_%1$s" ON public.%1$I FOR ALL TO authenticated
        USING (
          organization_slug = public.get_user_organization_slug(auth.uid())
          AND public.get_user_role(auth.uid()) IN ('admin','top_management')
          AND public.user_can_access_hotel(auth.uid(), hotel_id)
        )
        WITH CHECK (
          organization_slug = public.get_user_organization_slug(auth.uid())
          AND public.get_user_role(auth.uid()) IN ('admin','top_management')
          AND public.user_can_access_hotel(auth.uid(), hotel_id)
        );
    $p$, t);
  END LOOP;
END $$;

-- Surge events and ingest runs: read for revenue viewers, no client writes (edge fn uses service role)
DROP POLICY IF EXISTS "rev_admin_read_surge_events" ON public.surge_events;
DROP POLICY IF EXISTS "rev_admin_write_surge_events" ON public.surge_events;
CREATE POLICY "rev_read_surge_events" ON public.surge_events FOR SELECT TO authenticated
  USING (
    organization_slug = public.get_user_organization_slug(auth.uid())
    AND public.get_user_role(auth.uid()) IN ('admin','top_management','manager','housekeeping_manager')
    AND public.user_can_access_hotel(auth.uid(), hotel_id)
  );

DROP POLICY IF EXISTS "rev_admin_read_revenue_ingest_runs" ON public.revenue_ingest_runs;
DROP POLICY IF EXISTS "rev_admin_write_revenue_ingest_runs" ON public.revenue_ingest_runs;
CREATE POLICY "rev_read_revenue_ingest_runs" ON public.revenue_ingest_runs FOR SELECT TO authenticated
  USING (
    organization_slug = public.get_user_organization_slug(auth.uid())
    AND public.get_user_role(auth.uid()) IN ('admin','top_management','manager','housekeeping_manager')
    AND public.user_can_access_hotel(auth.uid(), hotel_id)
  );
