-- Give read-only price-list viewers access to recorded historical STAY-date rates.
-- Uses the daily revenue archive only for dates before today in Budapest.
-- Never returns revenue, bookings, occupancy KPIs, events or rate-edit actions.
-- Preserve the existing caller and organization authorization checks.
CREATE OR REPLACE FUNCTION public.revenue_price_list(
  _hotel_id text,
  _from date DEFAULT NULL::date,
  _days integer DEFAULT 14
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  caller record;
  hotel_org text;
  today_date date := (now() AT TIME ZONE 'Europe/Budapest')::date;
  start_date date := coalesce(_from, (now() AT TIME ZONE 'Europe/Budapest')::date);
  end_date date;
  published record;
BEGIN
  SELECT p.id, p.organization_slug, p.role::text AS role, p.access_role,
         coalesce(p.is_super_admin, false) AS super_admin
    INTO caller
    FROM public.profiles p
   WHERE p.id = auth.uid() AND p.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sign in to see the price list' USING ERRCODE = '42501';
  END IF;

  SELECT o.slug INTO hotel_org
    FROM public.hotel_configurations h
    JOIN public.organizations o ON o.id = h.organization_id
   WHERE h.hotel_id = _hotel_id
   LIMIT 1;
  IF hotel_org IS NULL THEN
    RAISE EXCEPTION 'Unknown hotel' USING ERRCODE = '22023';
  END IF;

  -- Never grant access to another organization or an unauthorized role.
  IF (
    caller.super_admin
    OR (caller.organization_slug = hotel_org AND (
         caller.role IN ('admin', 'top_management', 'top_management_manager')
         OR (caller.access_role = 'manager' AND public.effective_access_role(caller.access_role, caller.role) = 'manager')
       ))
  ) IS NOT TRUE THEN
    RAISE EXCEPTION 'The price list is not part of your role' USING ERRCODE = '42501';
  END IF;

  end_date := start_date + least(greatest(coalesce(_days, 14), 1), 62);

  SELECT r.sync_completed_at, r.payload INTO published
    FROM public.revenue_published_payloads r
   WHERE r.hotel_id = _hotel_id
   LIMIT 1;

  RETURN jsonb_build_object(
    'hotel_id', _hotel_id,
    'from', start_date,
    'to', end_date - 1,
    'synced_at', published.sync_completed_at,
    'room_types', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', rt.value->>'id',
               'name', rt.value->>'name',
               'pms_room_id', rt.value->>'pms_room_id',
               'num_rooms', rt.value->'num_rooms',
               'sort_order', rt.value->'sort_order',
               'is_reference', rt.value->'is_reference',
               'is_sellable', rt.value->'is_sellable',
               'counts_toward_inventory', rt.value->'counts_toward_inventory',
               'name_translations', rt.value->'name_translations'
             ) ORDER BY rt.ordinality)
        FROM jsonb_array_elements(coalesce(published.payload->'roomTypes', '[]'::jsonb)) WITH ORDINALITY AS rt(value, ordinality)
    ), '[]'::jsonb),
    'rates', coalesce((
      SELECT jsonb_agg(r.rate ORDER BY r.stay_date, r.ordinality)
      FROM (
        -- Current and future stays: the latest published Previo rates.
        SELECT (live.value->>'stay_date')::date AS stay_date, live.ordinality,
               jsonb_build_object(
                 'stay_date', live.value->>'stay_date',
                 'obk_id', live.value->>'obk_id',
                 'occupancy', live.value->'occupancy',
                 'price', live.value->'price',
                 'currency', live.value->>'currency',
                 'source', 'current'
               ) AS rate
          FROM jsonb_array_elements(coalesce(published.payload->'rates', '[]'::jsonb)) WITH ORDINALITY AS live(value, ordinality)
         WHERE live.value->>'stay_date' >= to_char(greatest(start_date, today_date), 'YYYY-MM-DD')
           AND live.value->>'stay_date' < to_char(end_date, 'YYYY-MM-DD')
        UNION ALL
        -- Past stays: preserved daily snapshots, not a retroactive live rate.
        SELECT archive.stay_date, archived.ordinality,
               jsonb_build_object(
                 'stay_date', archive.stay_date,
                 'obk_id', archived.value->>'obk_id',
                 'occupancy', archived.value->'occupancy',
                 'price', archived.value->'price',
                 'currency', archived.value->>'currency',
                 'source', 'archive'
               ) AS rate
          FROM public.revenue_calendar_history_archive AS archive
          CROSS JOIN LATERAL jsonb_array_elements(coalesce(archive.rates, '[]'::jsonb)) WITH ORDINALITY AS archived(value, ordinality)
         WHERE archive.hotel_id = _hotel_id
           AND archive.stay_date >= start_date
           AND archive.stay_date < least(end_date, today_date)
      ) AS r
    ), '[]'::jsonb)
  );
END;
$function$;