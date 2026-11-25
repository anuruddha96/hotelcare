DO $$
DECLARE
  v_id uuid;
  v_row public.system_anomaly_alerts%ROWTYPE;
BEGIN
  v_id := public.hc_enqueue_system_anomaly(
    'db:rollback_storm','rollback_storm','critical',
    'Database rollback/error storm detected',
    '{"rollbacks":21303,"commits":1874,"rollback_ratio_percent":91.91}'::jsonb
  );
  SELECT * INTO STRICT v_row FROM public.system_anomaly_alerts WHERE id=v_id;
  IF v_row.severity <> 'warning' OR v_row.title NOT LIKE '%cause unconfirmed%' THEN
    RAISE EXCEPTION 'Unconfirmed rollback spike was marked as verified critical: %',row_to_json(v_row);
  END IF;
  IF v_row.details->>'rollbacks' <> '21303'
     OR v_row.details->>'severity_basis' IS NULL
     OR v_row.details->>'log_correlation' IS NULL THEN
    RAISE EXCEPTION 'Rollback evidence missing: %',v_row.details;
  END IF;
  IF public.hc_enqueue_system_anomaly(
    'db:rollback_storm','rollback_storm','critical','Repeated','{}'::jsonb
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'Alert cooldown duplicate was not suppressed';
  END IF;
  v_id := public.hc_enqueue_system_anomaly(
    'db:deadlock_spike','deadlock_spike','critical','Verified deadlocks','{"deadlocks":3}'::jsonb
  );
  SELECT * INTO STRICT v_row FROM public.system_anomaly_alerts WHERE id=v_id;
  IF v_row.severity <> 'critical' OR v_row.details->>'deadlocks' <> '3' THEN
    RAISE EXCEPTION 'Verified deadlock alert was demoted: %',row_to_json(v_row);
  END IF;
  IF has_function_privilege('authenticated','public.hc_enqueue_system_anomaly(text,text,text,text,jsonb)','EXECUTE')
    OR has_function_privilege('anon','public.hc_enqueue_system_anomaly(text,text,text,text,jsonb)','EXECUTE')
    OR NOT has_function_privilege('service_role','public.hc_enqueue_system_anomaly(text,text,text,text,jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'Enqueue permission regression';
  END IF;
END $$;
