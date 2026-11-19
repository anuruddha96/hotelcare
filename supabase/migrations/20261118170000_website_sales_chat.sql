-- Website sales chat for hotelcare.app (edge function website-sales-chat).
--
-- Visitors on the public marketing site talk to the HotelCare sales assistant. Everything here
-- is service-role only: RLS on, no policies, no grants to anon/authenticated. The browser never
-- reads these tables; it holds a random session secret whose SHA-256 is stored here.
--
-- GDPR:
--   * chats without consent are kept 30 days after the last message, then purged;
--   * a visitor who leaves an e-mail and ticks the Terms/Privacy consent box is kept 12 months
--     (or until they unsubscribe-and-delete with the link in every e-mail);
--   * consent evidence (time, version, the exact text shown) is stored with the row;
--   * e-mail addresses and phone numbers typed into the chat text are redacted before storage;
--   * IP addresses are stored only as a daily-rotating salted hash, for rate limiting.

CREATE TABLE IF NOT EXISTS public.website_chat_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  secret_hash text NOT NULL,
  language text NOT NULL DEFAULT 'en',
  time_zone text,
  page_path text,
  attribution jsonb NOT NULL DEFAULT '{}'::jsonb,
  messages jsonb NOT NULL DEFAULT '[]'::jsonb,
  visitor_messages integer NOT NULL DEFAULT 0,
  profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  stage text NOT NULL DEFAULT 'chatting',
  email_offers integer NOT NULL DEFAULT 0,
  contact_name text,
  email text,
  consent_at timestamptz,
  consent_version text,
  consent_text text,
  consent_withdrawn_at timestamptz,
  ip_hash text,
  lead_notified_at timestamptz,
  lead_notified_messages integer NOT NULL DEFAULT 0,
  reminders_sent integer NOT NULL DEFAULT 0,
  last_reminder_at timestamptz,
  next_reminder_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_visitor_at timestamptz NOT NULL DEFAULT now(),
  erase_after timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  -- Something new for the sales inbox: consented, not withdrawn, not yet (fully) e-mailed.
  lead_due boolean GENERATED ALWAYS AS (
    email IS NOT NULL AND consent_withdrawn_at IS NULL
    AND (lead_notified_at IS NULL OR lead_notified_messages < visitor_messages)
  ) STORED,
  CONSTRAINT website_chat_stage_check CHECK (stage IN ('chatting', 'qualified', 'demo_offered', 'completed', 'closed')),
  CONSTRAINT website_chat_language_check CHECK (language ~ '^[a-z]{2}$'),
  CONSTRAINT website_chat_email_check CHECK (email IS NULL OR (length(email) <= 254 AND email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),
  CONSTRAINT website_chat_consent_check CHECK (email IS NULL OR (consent_at IS NOT NULL AND consent_version IS NOT NULL AND consent_text IS NOT NULL)),
  CONSTRAINT website_chat_reminders_check CHECK (reminders_sent BETWEEN 0 AND 2),
  CONSTRAINT website_chat_messages_array CHECK (jsonb_typeof(messages) = 'array'),
  CONSTRAINT website_chat_profile_object CHECK (jsonb_typeof(profile) = 'object')
);

COMMENT ON TABLE public.website_chat_sessions IS
  'hotelcare.app sales chat. Service role only. Contact data only with recorded consent; purged after erase_after.';

CREATE INDEX IF NOT EXISTS website_chat_sessions_reminder_idx
  ON public.website_chat_sessions (next_reminder_at) WHERE next_reminder_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS website_chat_sessions_lead_due_idx
  ON public.website_chat_sessions (last_visitor_at) WHERE lead_due;
CREATE INDEX IF NOT EXISTS website_chat_sessions_erase_idx ON public.website_chat_sessions (erase_after);
CREATE INDEX IF NOT EXISTS website_chat_sessions_email_idx
  ON public.website_chat_sessions (lower(email)) WHERE email IS NOT NULL;

ALTER TABLE public.website_chat_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.website_chat_sessions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.website_chat_sessions TO service_role;
-- website_chat_sessions: no policies (service role only).

-- ---------------------------------------------------------------- rate limits
CREATE TABLE IF NOT EXISTS public.website_chat_rate_limits (
  bucket text NOT NULL,
  window_start timestamptz NOT NULL,
  hits integer NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
);
ALTER TABLE public.website_chat_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.website_chat_rate_limits FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.website_chat_rate_limits TO service_role;

CREATE OR REPLACE FUNCTION public.website_chat_hit(p_bucket text, p_window_seconds integer, p_limit integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  w timestamptz := to_timestamp(floor(extract(epoch FROM now()) / GREATEST(p_window_seconds, 1)) * GREATEST(p_window_seconds, 1));
  n integer;
BEGIN
  INSERT INTO public.website_chat_rate_limits AS l (bucket, window_start, hits) VALUES (left(p_bucket, 120), w, 1)
  ON CONFLICT (bucket, window_start) DO UPDATE SET hits = l.hits + 1
  RETURNING hits INTO n;
  RETURN n <= p_limit;
END;
$fn$;
REVOKE ALL ON FUNCTION public.website_chat_hit(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.website_chat_hit(text, integer, integer) TO service_role;

-- ---------------------------------------------------------------- worker gate and retention
-- How much work the worker has: lead e-mails waiting (idle 20 min) plus reminders due.
CREATE OR REPLACE FUNCTION public.website_chat_due_count()
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT count(*)::integer FROM public.website_chat_sessions s
   WHERE (s.lead_due AND s.last_visitor_at <= now() - interval '20 minutes')
      OR (s.next_reminder_at IS NOT NULL AND s.next_reminder_at <= now()
          AND s.email IS NOT NULL AND s.consent_withdrawn_at IS NULL AND s.completed_at IS NULL);
$fn$;
REVOKE ALL ON FUNCTION public.website_chat_due_count() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.website_chat_due_count() TO service_role;

CREATE OR REPLACE FUNCTION public.website_chat_purge()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE n integer;
BEGIN
  DELETE FROM public.website_chat_sessions WHERE erase_after < now();
  GET DIAGNOSTICS n = ROW_COUNT;
  DELETE FROM public.website_chat_rate_limits WHERE window_start < now() - interval '2 days';
  RETURN n;
END;
$fn$;
REVOKE ALL ON FUNCTION public.website_chat_purge() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.website_chat_purge() TO service_role;

-- Machine secret for the worker and the signed e-mail links, generated here and kept in
-- Vault; no person ever sees it. Same pattern as the booking-engine worker.
DO $$
DECLARE v_exists boolean;
BEGIN
  IF to_regnamespace('vault') IS NULL THEN RETURN; END IF;
  EXECUTE 'SELECT EXISTS (SELECT 1 FROM vault.secrets WHERE name = $1)' INTO v_exists USING 'website_chat_worker_secret';
  IF NOT v_exists THEN
    EXECUTE 'SELECT vault.create_secret($1, $2, $3)'
      USING replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
            'website_chat_worker_secret', 'Authorises the website sales chat worker and signs its e-mail links';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.website_chat_worker_secret()
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v text;
BEGIN
  IF to_regnamespace('vault') IS NULL THEN RETURN NULL; END IF;
  EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = $1 LIMIT 1' INTO v USING 'website_chat_worker_secret';
  RETURN v;
END;
$fn$;
REVOKE ALL ON FUNCTION public.website_chat_worker_secret() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.website_chat_worker_secret() TO service_role;

-- ---------------------------------------------------------------- schedules
DO $$
BEGIN
  IF to_regnamespace('cron') IS NULL THEN RETURN; END IF;
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname IN ('website-sales-chat-worker', 'website-sales-chat-purge');
  -- Every 10 minutes; calls the function only when a lead e-mail or a reminder is due.
  PERFORM cron.schedule('website-sales-chat-worker', '3-59/10 * * * *', $job$
    SELECT net.http_post(
      url := 'https://pcmszqqklkolvvlabohq.supabase.co/functions/v1/website-sales-chat',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-worker-secret', public.website_chat_worker_secret()),
      body := jsonb_build_object('action', 'worker'),
      timeout_milliseconds := 120000)
    WHERE public.website_chat_due_count() > 0;
  $job$);
  -- Nightly retention: chats past erase_after and old rate-limit counters.
  PERFORM cron.schedule('website-sales-chat-purge', '23 2 * * *', $job$ SELECT public.website_chat_purge(); $job$);
END $$;
