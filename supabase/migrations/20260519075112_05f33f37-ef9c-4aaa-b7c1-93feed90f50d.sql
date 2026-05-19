
CREATE OR REPLACE FUNCTION public.purge_old_daily_overview_snapshots()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  removed integer := 0;
  retention_days integer;
BEGIN
  -- Read configurable retention window from organization_settings.
  -- We take the largest configured value across orgs (safest default) and
  -- fall back to 540 days when nothing is set.
  SELECT GREATEST(540, MAX( (setting_value::text)::integer ))
    INTO retention_days
    FROM public.organization_settings
   WHERE setting_key = 'daily_overview_retention_days'
     AND setting_value IS NOT NULL
     AND setting_value::text ~ '^[0-9]+$';

  IF retention_days IS NULL THEN
    retention_days := 540;
  END IF;

  DELETE FROM public.daily_overview_snapshots
   WHERE source = 'previo'
     AND business_date < (CURRENT_DATE - (retention_days || ' days')::interval);
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.purge_old_daily_overview_snapshots() FROM PUBLIC, anon, authenticated;
