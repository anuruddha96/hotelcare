CREATE TABLE public.revenue_published_payloads (
  hotel_id text PRIMARY KEY,
  organization_slug text NOT NULL,
  sync_completed_at timestamptz NOT NULL,
  sync_completed_by_name text,
  horizon_from date NOT NULL,
  horizon_to date NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.revenue_published_payloads TO authenticated;
GRANT ALL ON public.revenue_published_payloads TO service_role;

ALTER TABLE public.revenue_published_payloads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view published revenue for accessible hotels"
ON public.revenue_published_payloads
FOR SELECT
TO authenticated
USING (public.user_can_access_hotel(auth.uid(), hotel_id));

CREATE INDEX revenue_published_payloads_org_idx
ON public.revenue_published_payloads (organization_slug, hotel_id);

CREATE OR REPLACE FUNCTION public.refresh_revenue_published_payload(
  _hotel_id text,
  _completed_at timestamptz DEFAULT now(),
  _actor_name text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org text;
  v_from date := (now() AT TIME ZONE 'Europe/Budapest')::date;
  v_to date := v_from + 365;
  v_payload jsonb;
BEGIN
  SELECT o.slug INTO v_org
  FROM public.hotel_configurations h
  JOIN public.organizations o ON o.id = h.organization_id
  WHERE h.hotel_id = _hotel_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Unknown hotel';
  END IF;

  SELECT jsonb_build_object(
    'roomTypes', COALESCE((
      SELECT jsonb_agg(to_jsonb(r) ORDER BY r.sort_order, r.name)
      FROM (
        SELECT id, name, pms_room_id, num_rooms, is_reference, derivation_mode,
               derivation_value, sort_order, is_sellable, counts_toward_inventory,
               name_translations
        FROM public.room_types
        WHERE hotel_id = _hotel_id
      ) r
    ), '[]'::jsonb),
    'nights', COALESCE((
      SELECT jsonb_agg(to_jsonb(n) ORDER BY n.stay_date, n.res_id, n.room_key)
      FROM (
        SELECT stay_date, res_id, room_key, obk_id, room_type_name,
               nightly_price_eur, total_price_eur, stay_from, stay_to,
               source_name, created_at_pms, guests
        FROM public.revenue_booking_nights
        WHERE hotel_id = _hotel_id AND stay_date BETWEEN v_from AND v_to
      ) n
    ), '[]'::jsonb),
    'rates', COALESCE((
      SELECT jsonb_agg(to_jsonb(r) ORDER BY r.stay_date, r.obk_id, r.occupancy)
      FROM (
        SELECT DISTINCT ON (stay_date, obk_id, occupancy)
               stay_date, obk_id, room_type_name, occupancy, price, currency,
               rate_plan_id, captured_at, updated_at
        FROM public.revenue_room_type_rates
        WHERE hotel_id = _hotel_id AND stay_date BETWEEN v_from AND v_to
        ORDER BY stay_date, obk_id, occupancy, captured_at DESC, updated_at DESC
      ) r
    ), '[]'::jsonb),
    'cancellations', COALESCE((
      SELECT jsonb_agg(to_jsonb(c) ORDER BY c.stay_date, c.res_id, c.room_key)
      FROM (
        SELECT stay_date, res_id, room_key, obk_id, room_type_name,
               nightly_price_eur, total_price_eur, stay_from, stay_to,
               source_name, created_at_pms, guests, cancelled_at
        FROM public.revenue_cancelled_nights
        WHERE hotel_id = _hotel_id AND stay_date BETWEEN v_from AND v_to
      ) c
    ), '[]'::jsonb),
    'snapshots', COALESCE((
      SELECT jsonb_agg(to_jsonb(s) ORDER BY s.stay_date)
      FROM (
        SELECT DISTINCT ON (stay_date)
               stay_date, captured_date, captured_at, rooms_sold,
               rooms_available, occupancy_pct, revenue_eur, adr_eur, new_bookings
        FROM public.revenue_daily_snapshots
        WHERE hotel_id = _hotel_id AND stay_date BETWEEN v_from AND v_to
        ORDER BY stay_date, captured_at DESC
      ) s
    ), '[]'::jsonb),
    'movements', COALESCE((
      SELECT jsonb_agg(to_jsonb(m) ORDER BY m.stay_date, m.captured_at)
      FROM (
        SELECT stay_date, date_trunc('hour', captured_at) AS captured_at,
               sum(delta)::integer AS delta
        FROM public.pickup_snapshots
        WHERE hotel_id = _hotel_id
          AND stay_date BETWEEN v_from AND v_to
          AND captured_at >= now() - interval '92 days'
          AND delta <> 0
        GROUP BY stay_date, date_trunc('hour', captured_at)
      ) m
    ), '[]'::jsonb),
    'settings', COALESCE((
      SELECT to_jsonb(s)
      FROM (
        SELECT sellable_rooms, rate_warn_below_eur, rate_critical_below_eur,
               rate_max_sane_eur, occupancy_low_pct, occupancy_high_pct,
               pickup_strong_threshold, base_currency, eur_conversion_rate
        FROM public.hotel_revenue_settings
        WHERE hotel_id = _hotel_id
      ) s
    ), '{}'::jsonb)
  ) INTO v_payload;

  INSERT INTO public.revenue_published_payloads (
    hotel_id, organization_slug, sync_completed_at, sync_completed_by_name,
    horizon_from, horizon_to, payload, updated_at
  ) VALUES (
    _hotel_id, v_org, _completed_at, NULLIF(left(COALESCE(_actor_name, ''), 200), ''),
    v_from, v_to, v_payload, now()
  )
  ON CONFLICT (hotel_id) DO UPDATE SET
    organization_slug = EXCLUDED.organization_slug,
    sync_completed_at = EXCLUDED.sync_completed_at,
    sync_completed_by_name = EXCLUDED.sync_completed_by_name,
    horizon_from = EXCLUDED.horizon_from,
    horizon_to = EXCLUDED.horizon_to,
    payload = EXCLUDED.payload,
    updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_revenue_published_payload(text,timestamptz,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_revenue_published_payload(text,timestamptz,text) TO service_role;

CREATE OR REPLACE FUNCTION public.get_revenue_published_payload(_hotel_id text)
RETURNS TABLE (
  sync_completed_at timestamptz,
  sync_completed_by_name text,
  horizon_from date,
  horizon_to date,
  payload jsonb
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT p.sync_completed_at, p.sync_completed_by_name, p.horizon_from, p.horizon_to, p.payload
  FROM public.revenue_published_payloads p
  WHERE p.hotel_id = _hotel_id
    AND public.user_can_access_hotel(auth.uid(), p.hotel_id)
$$;

REVOKE ALL ON FUNCTION public.get_revenue_published_payload(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_revenue_published_payload(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.complete_revenue_sync(
  _hotel_id text,
  _success boolean,
  _error text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_completed_at timestamptz := now();
BEGIN
  IF _success THEN
    PERFORM public.refresh_revenue_published_payload(_hotel_id, v_completed_at, NULL);
  END IF;

  UPDATE public.revenue_sync_state
  SET last_success_at = CASE WHEN _success THEN v_completed_at ELSE last_success_at END,
      lease_started_at = NULL,
      lease_expires_at = NULL,
      lease_owner = NULL,
      last_error = CASE WHEN _success THEN NULL ELSE left(COALESCE(_error, 'Revenue refresh failed'), 1000) END,
      updated_at = now()
  WHERE hotel_id = _hotel_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_revenue_sync(
  _hotel_id text,
  _success boolean,
  _actor_id uuid,
  _actor_name text DEFAULT NULL,
  _error text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_completed_at timestamptz := now();
BEGIN
  IF _success THEN
    PERFORM public.refresh_revenue_published_payload(_hotel_id, v_completed_at, _actor_name);
  END IF;

  UPDATE public.revenue_sync_state
  SET last_success_at = CASE WHEN _success THEN v_completed_at ELSE last_success_at END,
      last_success_by = CASE WHEN _success THEN _actor_id ELSE last_success_by END,
      last_success_by_name = CASE WHEN _success THEN NULLIF(left(COALESCE(_actor_name, ''), 200), '') ELSE last_success_by_name END,
      lease_started_at = NULL,
      lease_expires_at = NULL,
      lease_owner = NULL,
      last_error = CASE WHEN _success THEN NULL ELSE left(COALESCE(_error, 'Revenue refresh failed'), 1000) END,
      updated_at = now()
  WHERE hotel_id = _hotel_id
    AND (_actor_id IS NULL OR lease_owner = _actor_id);
END;
$$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT s.hotel_id, s.last_success_at, s.last_success_by_name
    FROM public.revenue_sync_state s
    WHERE s.last_success_at IS NOT NULL
  LOOP
    PERFORM public.refresh_revenue_published_payload(r.hotel_id, r.last_success_at, r.last_success_by_name);
  END LOOP;
END $$;