-- AI policy: materialize the same default budgets already used by
-- ai_spend_snapshot(), so each tenant can configure/inspect the allowance.
INSERT INTO public.ai_budget_settings
  (organization_slug, daily_budget_usd, monthly_budget_usd, competitor_scan_enabled, event_sweep_enabled)
SELECT o.slug, 5, 100, true, true
FROM public.organizations o
WHERE o.slug IS NOT NULL
ON CONFLICT (organization_slug) DO NOTHING;

-- Private scheduled market-scan authorization, held exclusively in Vault.
-- The existing 06:00 cron previously passed only the public/anon API key,
-- allowing it to be replayed by anyone.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM vault.secrets WHERE name = 'hotelcare_otto_market_worker_secret'
  ) THEN
    PERFORM vault.create_secret(
      encode(gen_random_bytes(32), 'hex'),
      'hotelcare_otto_market_worker_secret',
      'Cron-only HotelCare Ottofiori AI market scan credential',
      NULL
    );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.verify_otto_market_worker_secret(p_secret text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
 SELECT coalesce(length(p_secret), 0) >= 32
    AND EXISTS(
      SELECT 1 FROM vault.decrypted_secrets s
      WHERE s.name = 'hotelcare_otto_market_worker_secret'
        AND s.decrypted_secret = p_secret
    );
$$;
REVOKE ALL ON FUNCTION public.verify_otto_market_worker_secret(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_otto_market_worker_secret(text) TO service_role;

-- Preserve the exact Budapest 06:00 cron and its existing anon apikey header;
-- add the separate non-public worker credential, checked by the Edge Function.
CREATE OR REPLACE FUNCTION public.invoke_ottofiori_market_scan(_force boolean DEFAULT false)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, cron, net, vault
AS $$
DECLARE
  _anon_key text;
  _worker_secret text;
  _request_id bigint;
BEGIN
  IF NOT _force AND extract(hour FROM timezone('Europe/Budapest', now())) <> 6 THEN
    RETURN NULL;
  END IF;
  SELECT (regexp_match(command, 'apikey[^A-Za-z0-9_-]+([A-Za-z0-9._-]+)'))[1]
    INTO _anon_key
    FROM cron.job
    WHERE jobname = 'revenue-automation-scheduler-10min'
    LIMIT 1;
  SELECT decrypted_secret INTO _worker_secret
    FROM vault.decrypted_secrets
    WHERE name = 'hotelcare_otto_market_worker_secret'
    LIMIT 1;
  IF _anon_key IS NULL OR _worker_secret IS NULL THEN
    RAISE EXCEPTION 'Market scan cron credentials are not configured';
  END IF;
  SELECT net.http_post(
    url := 'https://pcmszqqklkolvvlabohq.supabase.co/functions/v1/ottofiori-market-scan',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', _anon_key,
      'Authorization', 'Bearer ' || _anon_key,
      'x-market-scan-worker-secret', _worker_secret
    ),
    body := '{"days":60}'::jsonb
  ) INTO _request_id;
  RETURN _request_id;
END;
$$;
REVOKE ALL ON FUNCTION public.invoke_ottofiori_market_scan(boolean) FROM PUBLIC, anon, authenticated;
