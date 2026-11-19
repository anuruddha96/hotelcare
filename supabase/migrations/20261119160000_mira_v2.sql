-- Mira v2 (owner's request, 19 Nov 2026)
--  1. One conversation history across all hotels of the organization. Threads
--     were visible only while the profile's current hotel matched the hotel a
--     thread was started in, so switching hotels "lost" conversations and a
--     new chat could disappear from the list.
--  2. Mira's memory of each person (their own durable facts and preferences).
--  3. New alert kinds: heavy use, possible misuse, service outage.
--  4. Technical diagnostics stored with problem reports.
--  5. Daily usage report to administrators (cron + worker secret in Vault).
-- Re-runnable: every statement checks before it changes anything.

-- ---------------------------------------------------------------- 1. history
DROP POLICY IF EXISTS "own scoped threads" ON public.assistant_threads;
DROP POLICY IF EXISTS "own organization threads" ON public.assistant_threads;
CREATE POLICY "own organization threads" ON public.assistant_threads
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()) AND NOT (organization_slug IS DISTINCT FROM public.pi_user_org()))
  WITH CHECK (user_id = (SELECT auth.uid()) AND NOT (organization_slug IS DISTINCT FROM public.pi_user_org()));

DROP POLICY IF EXISTS "read messages from own scoped threads" ON public.assistant_messages;
DROP POLICY IF EXISTS "read messages from own organization threads" ON public.assistant_messages;
CREATE POLICY "read messages from own organization threads" ON public.assistant_messages
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.assistant_threads t
      WHERE t.id = assistant_messages.thread_id
        AND t.user_id = (SELECT auth.uid())
        AND NOT (t.organization_slug IS DISTINCT FROM public.pi_user_org())
    )
  );

-- The history list reads a person's threads newest first.
CREATE INDEX IF NOT EXISTS assistant_threads_user_updated_idx
  ON public.assistant_threads (user_id, updated_at DESC);

-- ---------------------------------------------------------------- 2. memory
CREATE TABLE IF NOT EXISTS public.assistant_user_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_slug text,
  fact text NOT NULL CHECK (char_length(fact) BETWEEN 4 AND 300),
  category text NOT NULL DEFAULT 'context' CHECK (category IN ('work', 'preference', 'context')),
  source text NOT NULL DEFAULT 'assistant' CHECK (source IN ('assistant', 'user')),
  thread_id uuid REFERENCES public.assistant_threads(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS assistant_user_memory_user_idx
  ON public.assistant_user_memory (user_id, updated_at DESC);
ALTER TABLE public.assistant_user_memory ENABLE ROW LEVEL SECURITY;

-- People read and delete their own memory in the app; Mira writes it from the
-- server with the service role. Nobody reads anyone else's memory.
DROP POLICY IF EXISTS "read own memory" ON public.assistant_user_memory;
CREATE POLICY "read own memory" ON public.assistant_user_memory
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "delete own memory" ON public.assistant_user_memory;
CREATE POLICY "delete own memory" ON public.assistant_user_memory
  FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "add own memory" ON public.assistant_user_memory;
CREATE POLICY "add own memory" ON public.assistant_user_memory
  FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()) AND source = 'user');

REVOKE ALL ON public.assistant_user_memory FROM anon;
GRANT SELECT, INSERT, DELETE ON public.assistant_user_memory TO authenticated;
GRANT ALL ON public.assistant_user_memory TO service_role;

-- ---------------------------------------------------------------- 3. alerts
ALTER TABLE public.assistant_usage_alert_events
  DROP CONSTRAINT IF EXISTS assistant_usage_alert_events_alert_type_check;
ALTER TABLE public.assistant_usage_alert_events
  ADD CONSTRAINT assistant_usage_alert_events_alert_type_check CHECK (alert_type = ANY (ARRAY[
    'quota_reached', 'quota_blocked', 'high_tokens', 'monthly_tokens',
    'heavy_use', 'abuse', 'outage'
  ]::text[]));
-- month_start holds the period start: the 1st for monthly alerts, the day itself for daily ones.
COMMENT ON COLUMN public.assistant_usage_alert_events.month_start IS
  'Period start: first day of the month for monthly alerts, the Budapest day for daily alerts (heavy use, misuse, outage).';
CREATE INDEX IF NOT EXISTS assistant_usage_alert_events_kind_idx
  ON public.assistant_usage_alert_events (alert_type, organization_slug, created_at DESC);

-- Daily counts and the daily report read usage by time.
CREATE INDEX IF NOT EXISTS assistant_monthly_usage_user_created_idx
  ON public.assistant_monthly_message_usage (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS assistant_monthly_usage_created_idx
  ON public.assistant_monthly_message_usage (created_at DESC);

-- ---------------------------------------------------------------- 4. reports
ALTER TABLE public.assistant_issue_reports
  ADD COLUMN IF NOT EXISTS diagnostics jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ---------------------------------------------------------------- 5. daily report
-- Machine secret for the report worker, generated here and kept in Vault; no
-- person ever sees it. Same pattern as the website chat worker.
DO $$
DECLARE v_exists boolean;
BEGIN
  IF to_regnamespace('vault') IS NULL THEN RETURN; END IF;
  EXECUTE 'SELECT EXISTS (SELECT 1 FROM vault.secrets WHERE name = $1)' INTO v_exists USING 'mira_usage_worker_secret';
  IF NOT v_exists THEN
    EXECUTE 'SELECT vault.create_secret($1, $2, $3)'
      USING replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
            'mira_usage_worker_secret', 'Authorises the daily Mira usage report worker';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.mira_usage_worker_secret()
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v text;
BEGIN
  IF to_regnamespace('vault') IS NULL THEN RETURN NULL; END IF;
  EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = $1 LIMIT 1' INTO v USING 'mira_usage_worker_secret';
  RETURN v;
END;
$fn$;
REVOKE ALL ON FUNCTION public.mira_usage_worker_secret() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mira_usage_worker_secret() TO service_role;

DO $$
BEGIN
  IF to_regnamespace('cron') IS NULL THEN RETURN; END IF;
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'mira-daily-usage-report';
  -- 05:15 UTC = 06:15 Budapest in winter, 07:15 in summer: yesterday's usage.
  PERFORM cron.schedule('mira-daily-usage-report', '15 5 * * *', $job$
    SELECT net.http_post(
      url := 'https://pcmszqqklkolvvlabohq.supabase.co/functions/v1/assistant-usage?action=daily_report',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-worker-secret', public.mira_usage_worker_secret()),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000);
  $job$);
END $$;
