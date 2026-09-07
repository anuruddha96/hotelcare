CREATE OR REPLACE FUNCTION public.rate_cell_history(
  p_hotel_id text,
  p_stay_date date,
  p_since timestamp with time zone,
  p_per_cell integer DEFAULT 8
)
RETURNS TABLE(
  id uuid,
  stay_date date,
  action text,
  source text,
  old_rate_eur numeric,
  new_rate_eur numeric,
  delta_eur numeric,
  notes text,
  performed_at timestamp with time zone,
  performed_by uuid,
  payload jsonb
)
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
  WITH price_events AS (
    SELECT
      a.id,
      a.stay_date,
      a.action,
      a.source,
      a.old_rate_eur,
      a.new_rate_eur,
      a.delta_eur,
      a.notes,
      a.performed_at,
      a.performed_by,
      a.payload
    FROM public.rate_change_audit a
    WHERE a.hotel_id = p_hotel_id
      AND (v_org IS NULL OR a.organization_slug = v_org)
      AND a.stay_date = p_stay_date
      AND a.performed_at >= p_since
      AND nullif(btrim(a.payload->>'room_type_name'), '') IS NOT NULL
      AND a.payload->>'occupancy' ~ '^[0-9]{1,3}$'
      AND a.source = ANY (ARRAY[
        'previo_confirmed','previo_automation_confirmed','previo_bulk_confirmed',
        'previo_external','previo_different','push','push_automation',
        'day-tool','cell-edit','bulk-editor','demand','pickup-board','autopilot'
      ])
  ),
  cell_keys AS (
    SELECT DISTINCT
      r.room_type_name,
      r.occupancy
    FROM public.revenue_room_type_rates r
    WHERE r.hotel_id = p_hotel_id
      AND r.stay_date = p_stay_date
      AND nullif(btrim(r.room_type_name), '') IS NOT NULL
      AND r.occupancy IS NOT NULL
  ),
  min_stay_events AS (
    SELECT
      d.id,
      d.stay_date,
      'minimum_stay_changed'::text AS action,
      'automation_min_stay'::text AS source,
      NULL::numeric AS old_rate_eur,
      NULL::numeric AS new_rate_eur,
      NULL::numeric AS delta_eur,
      CASE
        WHEN d.status = 'failed' THEN format('Minimum stay %s → %s nights failed to publish', d.current_min_stay, d.target_min_stay)
        ELSE format('Minimum stay %s → %s nights', d.current_min_stay, d.target_min_stay)
      END::text AS notes,
      d.created_at AS performed_at,
      NULL::uuid AS performed_by,
      jsonb_build_object(
        'room_type_name', c.room_type_name,
        'occupancy', c.occupancy,
        'change_type', 'minimum_stay',
        'old_min_stay', d.current_min_stay,
        'new_min_stay', d.target_min_stay,
        'reason', d.reason,
        'status', d.status,
        'days_out', d.days_out,
        'occupancy_pct', d.occupancy_pct,
        'rooms_left', d.rooms_left,
        'pickup_24h', d.pickup_24h,
        'event_title', d.event_title,
        'event_impact', d.event_impact,
        'min_stay_run_id', d.run_id
      ) AS payload
    FROM public.revenue_min_stay_decisions d
    CROSS JOIN cell_keys c
    WHERE d.hotel_id = p_hotel_id
      AND (v_org IS NULL OR d.organization_slug = v_org)
      AND d.stay_date = p_stay_date
      AND d.created_at >= p_since
      AND d.current_min_stay IS DISTINCT FROM d.target_min_stay
      AND d.status IN ('applied', 'failed')
  ),
  combined AS (
    SELECT * FROM price_events
    UNION ALL
    SELECT * FROM min_stay_events
  ),
  ranked AS (
    SELECT
      c.*,
      row_number() OVER (
        PARTITION BY c.payload->>'room_type_name', (c.payload->>'occupancy')::int
        ORDER BY c.performed_at DESC
      ) AS rn
    FROM combined c
  )
  SELECT
    r.id, r.stay_date, r.action, r.source, r.old_rate_eur, r.new_rate_eur,
    r.delta_eur, r.notes, r.performed_at, r.performed_by, r.payload
  FROM ranked r
  WHERE r.rn <= greatest(1, least(p_per_cell, 20))
  ORDER BY r.performed_at DESC;
END;
$function$;
