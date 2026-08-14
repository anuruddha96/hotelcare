CREATE OR REPLACE FUNCTION public.rate_cell_markers(p_hotel_id text, p_from date, p_to date, p_since timestamptz)
RETURNS TABLE(stay_date date, room_type_name text, occupancy integer, source text, performed_at timestamptz, performed_by uuid, confirmation_status text, old_rate_eur numeric, new_rate_eur numeric, requested_price numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
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
  SELECT DISTINCT ON (a.stay_date, a.payload->>'room_type_name', (a.payload->>'occupancy')::int)
    a.stay_date,
    a.payload->>'room_type_name',
    (a.payload->>'occupancy')::int,
    a.source,
    a.performed_at,
    a.performed_by,
    a.payload->>'confirmation_status',
    a.old_rate_eur,
    a.new_rate_eur,
    CASE WHEN a.payload->>'requested_price' ~ '^-?[0-9]+(\.[0-9]+)?$'
         THEN (a.payload->>'requested_price')::numeric END
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
  ORDER BY a.stay_date, a.payload->>'room_type_name', (a.payload->>'occupancy')::int, a.performed_at DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rate_cell_history(p_hotel_id text, p_stay_date date, p_since timestamptz, p_per_cell integer DEFAULT 8)
RETURNS TABLE(id uuid, stay_date date, action text, source text, old_rate_eur numeric, new_rate_eur numeric, delta_eur numeric, notes text, performed_at timestamptz, performed_by uuid, payload jsonb)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
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
  SELECT t.id, t.stay_date, t.action, t.source, t.old_rate_eur, t.new_rate_eur,
         t.delta_eur, t.notes, t.performed_at, t.performed_by, t.payload
  FROM (
    SELECT a.*,
      row_number() OVER (
        PARTITION BY a.payload->>'room_type_name', (a.payload->>'occupancy')::int
        ORDER BY a.performed_at DESC
      ) AS rn
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
  ) t
  WHERE t.rn <= greatest(1, least(p_per_cell, 20))
  ORDER BY t.performed_at DESC;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.rate_cell_markers(text, date, date, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rate_cell_history(text, date, timestamptz, integer) TO authenticated, service_role;