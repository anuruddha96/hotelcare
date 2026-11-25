-- Read-only smoke checks. Execute after deploying the companion migration.
DO $$
DECLARE
  v_count integer;
  v_role text;
  v_audience text;
BEGIN
  SELECT count(*) INTO v_count FROM public.welcome_quote_catalog
  WHERE is_active AND source_url ~ '^https://' AND verified_at IS NOT NULL;
  IF v_count < 15 THEN RAISE EXCEPTION 'Curated catalogue unexpectedly small: %', v_count; END IF;
  IF EXISTS (SELECT 1 FROM public.welcome_quote_catalog WHERE author IN ('Unknown','Operational clarity','Team continuity') OR source_url IS NULL) THEN
    RAISE EXCEPTION 'An unattributed or unverified quote is active';
  END IF;
  IF EXISTS (SELECT 1 FROM public.welcome_quote_catalog GROUP BY lower(trim(quote_text)) HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Duplicate quote text';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.welcome_quote_impressions'::regclass) THEN
    RAISE EXCEPTION 'Per-user quote history must have RLS';
  END IF;
  IF has_table_privilege('authenticated','public.welcome_quote_impressions','SELECT') OR
     has_table_privilege('authenticated','public.welcome_quote_impressions','INSERT') THEN
    RAISE EXCEPTION 'Employee quote history must not be directly readable or writable';
  END IF;
  IF NOT has_function_privilege('authenticated','public.claim_welcome_quote(text[])','EXECUTE') OR
     has_function_privilege('anon','public.claim_welcome_quote(text[])','EXECUTE') THEN
    RAISE EXCEPTION 'Quote claim RPC permissions are incorrect';
  END IF;
  FOREACH v_audience IN ARRAY ARRAY['housekeeping','housekeeping_leadership','reception','reception_leadership','maintenance','maintenance_leadership','breakfast','marketing','marketing_leadership','finance','finance_leadership','hr','hotel_management','executive','admin','supervisor','hospitality'] LOOP
    SELECT count(*) INTO v_count FROM public.welcome_quote_catalog
      WHERE is_active AND (v_audience = any(audiences) OR 'hospitality' = any(audiences));
    IF v_count < 7 THEN RAISE EXCEPTION 'Not enough quotes for %: %', v_audience, v_count; END IF;
  END LOOP;
END;
$$;
