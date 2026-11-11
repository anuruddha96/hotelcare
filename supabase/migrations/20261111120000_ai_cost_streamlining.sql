-- AI cost streamlining (November 2026).
--
-- 1. Server-side translation memory: each unique (language, text) pair is
--    paid for once. Only the SHA-256 of the source text is stored, never the
--    original note; entries expire after 90 days.
-- 2. Ottofiori competitor web-search scan: the next 21 days daily (where
--    prices actually move), the full 60-day horizon only Monday and Thursday.
--    Each 7-day chunk is one paid web search per competitor.
-- 3. Ottofiori AI price supervisor: three reviews a day instead of six. The
--    deterministic engine keeps running every 30 minutes in between.

-- 1 ─ translation memory ----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_translation_cache (
  text_hash       text PRIMARY KEY,
  target_language text NOT NULL,
  translated_text text NOT NULL,
  model           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_translation_cache ENABLE ROW LEVEL SECURITY;
-- No policies: only Edge Functions using the service role read or write it.
REVOKE ALL ON public.ai_translation_cache FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ai_translation_cache TO service_role;

CREATE INDEX IF NOT EXISTS ai_translation_cache_created_at_idx
  ON public.ai_translation_cache (created_at);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-ai-translation-cache') THEN
    PERFORM cron.unschedule('purge-ai-translation-cache');
  END IF;
  PERFORM cron.schedule(
    'purge-ai-translation-cache', '25 3 * * *',
    $cron$DELETE FROM public.ai_translation_cache WHERE created_at < now() - interval '90 days';$cron$
  );
END $$;

-- 2 ─ shorter daily market-scan horizon -------------------------------------
CREATE OR REPLACE FUNCTION public.invoke_ottofiori_market_scan(_force boolean DEFAULT false)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, cron, net, vault
AS $$
DECLARE
  _anon_key text;
  _worker_secret text;
  _request_id bigint;
  _local timestamp := timezone('Europe/Budapest', now());
  _days int;
BEGIN
  IF NOT _force AND extract(hour FROM _local) <> 6 THEN
    RETURN NULL;
  END IF;
  -- ISO weekday: 1 = Monday, 4 = Thursday. A forced (manual) run always
  -- refreshes the full horizon.
  _days := CASE WHEN _force OR extract(isodow FROM _local) IN (1, 4) THEN 60 ELSE 21 END;
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
    body := jsonb_build_object('days', _days)
  ) INTO _request_id;
  RETURN _request_id;
END;
$$;
REVOKE ALL ON FUNCTION public.invoke_ottofiori_market_scan(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_ottofiori_market_scan(boolean) TO service_role;

-- 3 ─ AI supervisor: 3 reviews a day ----------------------------------------
-- 04:11 / 10:11 / 16:11 UTC = early morning, midday and late afternoon in
-- Budapest (05/11/17 in winter, 06/12/18 in summer).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ottofiori-ai-supervisor-4h') THEN
    PERFORM cron.unschedule('ottofiori-ai-supervisor-4h');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ottofiori-ai-supervisor-3x') THEN
    PERFORM cron.unschedule('ottofiori-ai-supervisor-3x');
  END IF;
  PERFORM cron.schedule('ottofiori-ai-supervisor-3x', '11 4,10,16 * * *',
    $cron$select public.invoke_ottofiori_ai_supervisor();$cron$);
END $$;

-- Spend by feature, for checking the effect of these changes:
--   select function_name, model, count(*) calls,
--          round(sum(estimated_cost_usd)::numeric, 2) usd
--   from ai_usage_log where created_at > now() - interval '30 days'
--   group by 1, 2 order by usd desc;
