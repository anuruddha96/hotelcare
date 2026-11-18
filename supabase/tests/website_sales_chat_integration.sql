-- Website sales chat: only the service role can touch chats, the counters work, the worker
-- gate counts exactly the due work, retention deletes what it should, and the jobs exist.
\set ON_ERROR_STOP on

DO $$
DECLARE
  v_secret text;
  v_hits boolean[];
  v_id uuid;
BEGIN
  -- Privileges: nothing for the public API roles, despite Supabase's default grants.
  IF has_table_privilege('anon', 'public.website_chat_sessions', 'SELECT')
     OR has_table_privilege('authenticated', 'public.website_chat_sessions', 'INSERT')
     OR has_table_privilege('anon', 'public.website_chat_rate_limits', 'SELECT') THEN
    RAISE EXCEPTION 'API roles must not read or write chat tables';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.website_chat_sessions'::regclass) THEN
    RAISE EXCEPTION 'RLS must be enabled on website_chat_sessions';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename IN ('website_chat_sessions', 'website_chat_rate_limits')) THEN
    RAISE EXCEPTION 'chat tables must have no policies (service role only)';
  END IF;
  IF has_function_privilege('anon', 'public.website_chat_worker_secret()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.website_chat_hit(text, integer, integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.website_chat_purge()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.website_chat_due_count()', 'EXECUTE') THEN
    RAISE EXCEPTION 'chat functions must be service-role only';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.website_chat_worker_secret()', 'EXECUTE') THEN
    RAISE EXCEPTION 'service role must read the worker secret';
  END IF;

  -- The machine secret exists, is long, and survives a re-run of the migration block.
  v_secret := public.website_chat_worker_secret();
  IF v_secret IS NULL OR length(v_secret) < 64 THEN RAISE EXCEPTION 'worker secret missing'; END IF;

  -- Rate limiter: third hit in the window is over a limit of 2.
  v_hits := ARRAY[public.website_chat_hit('msg:test', 600, 2), public.website_chat_hit('msg:test', 600, 2), public.website_chat_hit('msg:test', 600, 2)];
  IF v_hits <> ARRAY[true, true, false] THEN RAISE EXCEPTION 'rate limiter wrong: %', v_hits; END IF;

  -- Contact data only with consent evidence.
  BEGIN
    INSERT INTO public.website_chat_sessions (secret_hash, email) VALUES ('x', 'anna@hotel.hu');
    RAISE EXCEPTION 'an e-mail without consent must be rejected';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.website_chat_sessions (secret_hash, stage) VALUES ('x', 'sold');
    RAISE EXCEPTION 'unknown stage must be rejected';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

-- Worker gate: exactly the due lead e-mails and reminders.
INSERT INTO public.website_chat_sessions (secret_hash, visitor_messages, email, consent_at, consent_version, consent_text, last_visitor_at)
VALUES ('lead-new', 3, 'a@hotel.hu', now(), 'v1', 'I agree', now() - interval '30 minutes');               -- due: lead never e-mailed
INSERT INTO public.website_chat_sessions (secret_hash, visitor_messages, email, consent_at, consent_version, consent_text, last_visitor_at, lead_notified_at, lead_notified_messages)
VALUES ('lead-done', 3, 'b@hotel.hu', now(), 'v1', 'I agree', now() - interval '30 minutes', now(), 3);    -- not due
INSERT INTO public.website_chat_sessions (secret_hash, visitor_messages, email, consent_at, consent_version, consent_text, last_visitor_at)
VALUES ('lead-active', 3, 'c@hotel.hu', now(), 'v1', 'I agree', now() - interval '5 minutes');             -- not due yet (still chatting)
INSERT INTO public.website_chat_sessions (secret_hash, visitor_messages, email, consent_at, consent_version, consent_text, last_visitor_at, lead_notified_at, lead_notified_messages, next_reminder_at)
VALUES ('reminder-due', 3, 'd@hotel.hu', now(), 'v1', 'I agree', now() - interval '4 hours', now(), 3, now() - interval '1 minute'); -- due
INSERT INTO public.website_chat_sessions (secret_hash, visitor_messages, email, consent_at, consent_version, consent_text, consent_withdrawn_at, last_visitor_at, lead_notified_at, lead_notified_messages, next_reminder_at)
VALUES ('unsubscribed', 3, 'e@hotel.hu', now(), 'v1', 'I agree', now(), now() - interval '4 hours', now(), 2, now() - interval '1 minute'); -- not due
INSERT INTO public.website_chat_sessions (secret_hash, visitor_messages, last_visitor_at)
VALUES ('anonymous', 5, now() - interval '2 hours');                                                        -- never e-mailed

DO $$
BEGIN
  IF public.website_chat_due_count() <> 2 THEN
    RAISE EXCEPTION 'expected 2 due items, got %', public.website_chat_due_count();
  END IF;
  IF (SELECT lead_due FROM public.website_chat_sessions WHERE secret_hash = 'anonymous') THEN
    RAISE EXCEPTION 'anonymous chats are never leads';
  END IF;
END $$;

-- Retention: expired rows go, others stay.
UPDATE public.website_chat_sessions SET erase_after = now() - interval '1 second' WHERE secret_hash IN ('anonymous', 'unsubscribed');
DO $$
DECLARE n integer;
BEGIN
  n := public.website_chat_purge();
  IF n <> 2 OR EXISTS (SELECT 1 FROM public.website_chat_sessions WHERE secret_hash IN ('anonymous', 'unsubscribed'))
     OR (SELECT count(*) FROM public.website_chat_sessions) <> 4 THEN
    RAISE EXCEPTION 'purge removed the wrong rows (returned %)', n;
  END IF;
END $$;

-- Schedules exist once, even after the migration ran twice.
DO $$
BEGIN
  IF (SELECT count(*) FROM cron.job WHERE jobname = 'website-sales-chat-worker') <> 1
     OR (SELECT count(*) FROM cron.job WHERE jobname = 'website-sales-chat-purge') <> 1 THEN
    RAISE EXCEPTION 'cron jobs missing or duplicated';
  END IF;
  IF (SELECT command FROM cron.job WHERE jobname = 'website-sales-chat-worker') NOT LIKE '%website_chat_due_count() > 0%' THEN
    RAISE EXCEPTION 'worker must only be called when work is due';
  END IF;
  IF (SELECT count(*) FROM vault.secrets WHERE name = 'website_chat_worker_secret') <> 1 THEN
    RAISE EXCEPTION 'worker secret duplicated';
  END IF;
END $$;

SELECT 'website sales chat SQL checks passed' AS result;
