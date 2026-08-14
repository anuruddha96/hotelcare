ALTER TABLE public.revenue_pickup_automation_rules
  ADD COLUMN IF NOT EXISTS smart_pricing_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS near_term_days integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS low_occupancy_pct numeric NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS long_lead_days integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS high_occupancy_pct numeric NOT NULL DEFAULT 85,
  ADD COLUMN IF NOT EXISTS strong_demand_increase numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_assist_enabled boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.rate_cell_markers(p_hotel_id text, p_from date, p_to date, p_since timestamp with time zone, p_limit integer DEFAULT 1000, p_offset integer DEFAULT 0)
 RETURNS TABLE(stay_date date, room_type_name text, occupancy integer, source text, performed_at timestamp with time zone, performed_by uuid, confirmation_status text, old_rate_eur numeric, new_rate_eur numeric, requested_price numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_org text;
BEGIN
  IF v_uid IS NULL THEN
    IF current_user NOT IN ('service_role', 'postgres', 'supabase_admin') THEN
      RETURN;
    END IF;
  ELSE
    IF NOT (public.is_revenue_user(v_uid) AND public.user_can_access_hotel(v_uid, p_hotel_id)) THEN
      RETURN;
    END IF;
    SELECT p.organization_slug INTO v_org FROM public.profiles p WHERE p.id = v_uid;
  END IF;

  RETURN QUERY
  WITH newest AS (
    SELECT DISTINCT ON (a.stay_date, a.payload->>'room_type_name', (a.payload->>'occupancy')::int)
      a.stay_date AS d,
      a.payload->>'room_type_name' AS rt,
      (a.payload->>'occupancy')::int AS occ,
      a.source AS src,
      a.performed_at AS pat,
      a.performed_by AS pby,
      a.payload->>'confirmation_status' AS cs,
      a.old_rate_eur AS oldr,
      a.new_rate_eur AS newr,
      CASE WHEN a.payload->>'requested_price' ~ '^-?[0-9]+(\.[0-9]+)?$'
           THEN (a.payload->>'requested_price')::numeric END AS req
    FROM public.rate_change_audit a
    WHERE a.hotel_id = p_hotel_id
      AND (v_org IS NULL OR a.organization_slug = v_org)
      AND a.stay_date BETWEEN p_from AND p_to
      AND a.performed_at >= p_since
      AND nullif(btrim(a.payload->>'room_type_name'), '') IS NOT NULL
      AND a.payload->>'occupancy' ~ '^[0-9]{1,3}$'
      AND a.source = ANY (ARRAY[
        'previo_confirmed','previo_automation_confirmed','previo_bulk_confirmed',
        'previo_external','previo_different','push','push_automation',
        'day-tool','cell-edit','bulk-editor','demand','pickup-board','autopilot'
      ])
      AND (a.source <> 'previo_different' OR a.payload->>'resolved_at' IS NULL)
    ORDER BY a.stay_date, a.payload->>'room_type_name', (a.payload->>'occupancy')::int,
      a.performed_at DESC,
      -- Deterministic tie-break when one sync statement writes several rows for
      -- the same cell at the identical timestamp: the true origin of the move
      -- wins over a confirmation row, so a change made directly in Previo can
      -- never be mislabelled as a change made by the team.
      CASE a.source
        WHEN 'previo_different' THEN 0
        WHEN 'previo_external' THEN 1
        WHEN 'push_automation' THEN 2
        WHEN 'previo_automation_confirmed' THEN 3
        WHEN 'day-tool' THEN 4
        WHEN 'cell-edit' THEN 4
        WHEN 'bulk-editor' THEN 4
        WHEN 'demand' THEN 4
        WHEN 'pickup-board' THEN 4
        WHEN 'autopilot' THEN 4
        WHEN 'push' THEN 5
        ELSE 6
      END
  )
  SELECT n.d, n.rt, n.occ, n.src, n.pat, n.pby, n.cs, n.oldr, n.newr, n.req
  FROM newest n
  ORDER BY n.d, n.rt, n.occ
  LIMIT greatest(1, least(coalesce(p_limit, 1000), 1000))
  OFFSET greatest(0, coalesce(p_offset, 0));
END;
$function$;