-- Daily stayover textiles sometimes arrive as one counted trolley with no room labels.
-- Do not invent room attribution or change existing dirty_linen_counts / manager reports.
CREATE TABLE IF NOT EXISTS public.gozsdu_laundry_unallocated_daily (
  organization_slug text NOT NULL,
  hotel_id text NOT NULL DEFAULT 'gozsdu-court' CHECK (hotel_id = 'gozsdu-court'),
  work_date date NOT NULL,
  user_id uuid NOT NULL REFERENCES public.profiles(id),
  item_counts jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(item_counts) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_slug, hotel_id, work_date, user_id)
);
CREATE INDEX IF NOT EXISTS gozsdu_daily_bulk_date_idx ON public.gozsdu_laundry_unallocated_daily (organization_slug, work_date);
ALTER TABLE public.gozsdu_laundry_unallocated_daily ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gozsdu_laundry_unallocated_daily FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.gozsdu_laundry_unallocated_daily TO authenticated;
DROP POLICY IF EXISTS "Gozsdu daily linen own or hotel manager read" ON public.gozsdu_laundry_unallocated_daily;
CREATE POLICY "Gozsdu daily linen own or hotel manager read"
ON public.gozsdu_laundry_unallocated_daily FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.profiles p
  WHERE p.id = auth.uid()
    AND p.organization_slug = gozsdu_laundry_unallocated_daily.organization_slug
    AND p.assigned_hotel IN ('gozsdu-court', 'Gozsdu Court Budapest')
    AND (p.id = gozsdu_laundry_unallocated_daily.user_id OR p.role::text IN
      ('admin', 'manager', 'housekeeping_manager', 'top_management', 'top_management_manager'))
));

-- Full-day replacement (not an additive counter): retrying a save cannot double-count.
-- Only the actual employee may write their own batch; managers see it read-only.
CREATE OR REPLACE FUNCTION public.record_gozsdu_unallocated_daily_linen(p_counts jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor public.profiles%ROWTYPE;
  v_date date := (now() AT TIME ZONE 'Europe/Budapest')::date;
  v_row jsonb;
  v_item_id uuid;
  v_count integer;
  v_seen uuid[] := array[]::uuid[];
  v_values jsonb := '{}'::jsonb;
  v_total integer := 0;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE id = auth.uid();
  IF v_actor.id IS NULL
    OR v_actor.assigned_hotel NOT IN ('gozsdu-court', 'Gozsdu Court Budapest')
    OR NOT (v_actor.role::text = 'housekeeping' OR coalesce(v_actor.acts_as_housekeeper, false))
    OR p_counts IS NULL OR jsonb_typeof(p_counts) <> 'array' OR jsonb_array_length(p_counts) > 15
  THEN
    RAISE EXCEPTION 'Unauthorized or invalid Gozsdu daily linen batch' USING ERRCODE = '42501';
  END IF;
  FOR v_row IN SELECT value FROM jsonb_array_elements(p_counts) LOOP
    IF jsonb_typeof(v_row) <> 'object' OR NOT (v_row ? 'linen_item_id')
      OR NOT (v_row ? 'count') OR (v_row->>'count') !~ '^[0-9]{1,4}$' THEN
      RAISE EXCEPTION 'Invalid daily linen quantity';
    END IF;
    v_item_id := (v_row->>'linen_item_id')::uuid;
    v_count := (v_row->>'count')::integer;
    IF v_count > 1000 OR v_item_id = ANY(v_seen) OR NOT EXISTS (
      SELECT 1 FROM public.dirty_linen_items i
      WHERE i.id = v_item_id AND i.is_active = true AND i.hotel_scope = 'gozsdu-court'
    ) THEN
      RAISE EXCEPTION 'Duplicate, excessive, or non-Gozsdu linen item';
    END IF;
    v_seen := array_append(v_seen, v_item_id);
    v_total := v_total + v_count;
    IF v_count > 0 THEN v_values := v_values || jsonb_build_object(v_item_id::text, v_count); END IF;
  END LOOP;
  PERFORM pg_advisory_xact_lock(hashtext('gozsdu-daily-bulk'), hashtext(v_actor.id::text || ':' || v_date::text));
  IF v_total = 0 THEN
    DELETE FROM public.gozsdu_laundry_unallocated_daily
    WHERE organization_slug = v_actor.organization_slug AND hotel_id = 'gozsdu-court'
      AND work_date = v_date AND user_id = v_actor.id;
  ELSE
    INSERT INTO public.gozsdu_laundry_unallocated_daily
      (organization_slug, hotel_id, work_date, user_id, item_counts)
    VALUES (v_actor.organization_slug, 'gozsdu-court', v_date, v_actor.id, v_values)
    ON CONFLICT (organization_slug, hotel_id, work_date, user_id)
    DO UPDATE SET item_counts = EXCLUDED.item_counts, updated_at = now();
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.record_gozsdu_unallocated_daily_linen(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_gozsdu_unallocated_daily_linen(jsonb) TO authenticated;
