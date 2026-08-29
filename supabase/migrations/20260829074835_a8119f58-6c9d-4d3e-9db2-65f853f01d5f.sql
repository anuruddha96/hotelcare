CREATE OR REPLACE FUNCTION public.revenue_v2_safety_gate()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_runs int;
  v_bad_runs int;
  v_evaluated int;
  v_decreased int;
  v_budget_breaches int;
  v_bound_breaches int;
  v_recent_failures int;
  v_worst_decrease_share numeric;
  v_results jsonb;
  v_out jsonb := '[]'::jsonb;
BEGIN
  FOR r IN
    SELECT * FROM public.revenue_pickup_automation_rules
     WHERE engine_version >= 2 AND is_enabled = true
  LOOP
    -- ---------- live-mode watchdog ----------
    IF r.mode = 'live' THEN
      SELECT count(*) FILTER (WHERE status IN ('failed','timed_out'))
        INTO v_recent_failures
        FROM (SELECT status FROM public.revenue_automation_runs
               WHERE hotel_id = r.hotel_id ORDER BY started_at DESC LIMIT 3) t;

      SELECT coalesce(max(CASE WHEN dates_evaluated > 0
                               THEN dates_decreased::numeric / dates_evaluated END), 0)
        INTO v_worst_decrease_share
        FROM public.revenue_automation_runs
       WHERE hotel_id = r.hotel_id AND started_at > now() - interval '6 hours';

      IF v_recent_failures >= 3 OR v_worst_decrease_share > 0.34 THEN
        UPDATE public.revenue_pickup_automation_rules
           SET mode = 'shadow', auto_publish = false,
               auto_pause_reason = CASE WHEN v_recent_failures >= 3
                 THEN 'Three runs in a row did not finish cleanly.'
                 ELSE 'A run tried to lower more than a third of all dates.' END,
               updated_at = now()
         WHERE id = r.id;
        v_out := v_out || jsonb_build_object('hotel_id', r.hotel_id, 'action', 'auto_paused');
      END IF;
      CONTINUE;
    END IF;

    -- ---------- shadow-mode activation gate ----------
    IF r.shadow_started_at IS NULL OR r.shadow_started_at > now() - interval '24 hours' THEN
      CONTINUE;
    END IF;
    IF r.auto_pause_reason IS NOT NULL THEN
      CONTINUE; -- a paused property only goes live again by hand
    END IF;

    SELECT count(*), count(*) FILTER (WHERE status <> 'completed'),
           coalesce(sum(dates_evaluated),0), coalesce(sum(dates_decreased),0)
      INTO v_runs, v_bad_runs, v_evaluated, v_decreased
      FROM public.revenue_automation_runs
     WHERE hotel_id = r.hotel_id AND started_at > now() - interval '24 hours';

    SELECT count(*) INTO v_budget_breaches FROM (
      SELECT stay_date, sum(abs(movement)) AS moved
        FROM public.revenue_date_decisions
       WHERE hotel_id = r.hotel_id AND created_at > now() - interval '24 hours'
       GROUP BY stay_date
      HAVING sum(abs(movement)) > 20
    ) b;

    SELECT count(*) INTO v_bound_breaches
      FROM public.revenue_date_decisions d
      JOIN public.revenue_price_floors f
        ON f.hotel_id = d.hotel_id AND f.room_type_name IS NULL AND f.occupancy = 2
     WHERE d.hotel_id = r.hotel_id
       AND d.created_at > now() - interval '24 hours'
       AND d.target_price IS NOT NULL
       AND (d.target_price < f.min_price OR d.target_price > f.max_price);

    v_results := jsonb_build_object(
      'checked_at', now(),
      'runs', v_runs,
      'clean_runs', v_runs - v_bad_runs,
      'dates_evaluated', v_evaluated,
      'dates_decreased', v_decreased,
      'daily_budget_breaches', v_budget_breaches,
      'floor_or_ceiling_breaches', v_bound_breaches,
      'pass_min_runs', v_runs >= 12,
      'pass_no_failures', v_bad_runs = 0,
      'pass_budget', v_budget_breaches = 0,
      'pass_bounds', v_bound_breaches = 0,
      'pass_markdown_share', v_evaluated = 0 OR v_decreased::numeric / greatest(v_evaluated,1) <= 0.25
    );

    IF (v_results->>'pass_min_runs')::boolean
       AND (v_results->>'pass_no_failures')::boolean
       AND (v_results->>'pass_budget')::boolean
       AND (v_results->>'pass_bounds')::boolean
       AND (v_results->>'pass_markdown_share')::boolean THEN
      UPDATE public.revenue_pickup_automation_rules
         SET mode = 'live', auto_publish = true, live_activated_at = now(),
             gate_results = v_results, updated_at = now()
       WHERE id = r.id;
      v_out := v_out || jsonb_build_object('hotel_id', r.hotel_id, 'action', 'activated', 'gate', v_results);
    ELSE
      UPDATE public.revenue_pickup_automation_rules
         SET gate_results = v_results, updated_at = now()
       WHERE id = r.id;
      v_out := v_out || jsonb_build_object('hotel_id', r.hotel_id, 'action', 'still_shadow', 'gate', v_results);
    END IF;
  END LOOP;

  RETURN jsonb_build_object('checked', v_out);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.revenue_v2_safety_gate() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.revenue_v2_safety_gate() TO service_role;