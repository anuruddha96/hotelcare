-- Mira v2 migration check on a throwaway database:
--   psql -f mira_v2_fixture.sql
--   psql -f mira_v2_integration.sql -v migration=<path to 20261119160000_mira_v2.sql>
-- Fails with an exception on the first broken expectation.
\set ON_ERROR_STOP on

INSERT INTO auth.users (id) VALUES
  ('00000000-0000-0000-0000-0000000000a1'), -- manager, RD Hotels
  ('00000000-0000-0000-0000-0000000000a2'), -- colleague, RD Hotels
  ('00000000-0000-0000-0000-0000000000a3'); -- other organization
INSERT INTO public.profiles (id, organization_slug, assigned_hotel, role) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'rd', 'memories', 'manager'),
  ('00000000-0000-0000-0000-0000000000a2', 'rd', 'memories', 'manager'),
  ('00000000-0000-0000-0000-0000000000a3', 'other', 'elsewhere', 'manager');

-- The manager starts a chat in Hotel Memories, switches to Gozsdu, starts another.
SET ROLE authenticated;
SET request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
INSERT INTO public.assistant_threads (id, user_id, title) VALUES
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'Who cleaned 038 on Monday');
RESET ROLE;
UPDATE public.profiles SET assigned_hotel = 'gozsdu' WHERE id = '00000000-0000-0000-0000-0000000000a1';
INSERT INTO public.assistant_messages (thread_id, user_id, role, content) VALUES
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'user', 'Who cleaned 038 on Monday?');
SET ROLE authenticated;
SET request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
INSERT INTO public.assistant_threads (id, user_id, title) VALUES
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a1', 'Gozsdu checkouts');

-- The bug as reported: after switching hotel the first conversation is gone.
DO $$ BEGIN
  IF (SELECT count(*) FROM public.assistant_threads) <> 1 THEN
    RAISE EXCEPTION 'expected the old policy to hide the other hotel''s thread';
  END IF;
END $$;
RESET ROLE;

-- Apply the migration twice: it must be re-runnable.
\i :migration
\i :migration

SET ROLE authenticated;
SET request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
DO $$ BEGIN
  IF (SELECT count(*) FROM public.assistant_threads) <> 2 THEN
    RAISE EXCEPTION 'one history across hotels: expected 2 threads, got %', (SELECT count(*) FROM public.assistant_threads);
  END IF;
  IF (SELECT count(*) FROM public.assistant_messages WHERE thread_id = '10000000-0000-0000-0000-000000000001') <> 1 THEN
    RAISE EXCEPTION 'messages of a thread from another hotel must be readable';
  END IF;
END $$;
-- Renaming a thread from the other hotel works too.
UPDATE public.assistant_threads SET title = 'Room 038 Monday' WHERE id = '10000000-0000-0000-0000-000000000001';
DO $$ BEGIN
  IF (SELECT title FROM public.assistant_threads WHERE id = '10000000-0000-0000-0000-000000000001') <> 'Room 038 Monday' THEN
    RAISE EXCEPTION 'rename across hotels failed';
  END IF;
END $$;

-- A colleague never sees someone else's conversations.
SET request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';
DO $$ BEGIN
  IF (SELECT count(*) FROM public.assistant_threads) <> 0 OR (SELECT count(*) FROM public.assistant_messages) <> 0 THEN
    RAISE EXCEPTION 'a colleague can see another person''s Mira history';
  END IF;
END $$;
RESET ROLE;

-- Another organization stays separate, even for the same person.
UPDATE public.profiles SET organization_slug = 'other' WHERE id = '00000000-0000-0000-0000-0000000000a1';
SET ROLE authenticated;
SET request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
DO $$ BEGIN
  IF (SELECT count(*) FROM public.assistant_threads) <> 0 THEN
    RAISE EXCEPTION 'threads of another organization must stay hidden';
  END IF;
END $$;
RESET ROLE;
UPDATE public.profiles SET organization_slug = 'rd' WHERE id = '00000000-0000-0000-0000-0000000000a1';

-- Memory: people add and delete their own facts; Mira's facts come from the server.
SET ROLE authenticated;
SET request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
INSERT INTO public.assistant_user_memory (user_id, fact, category, source)
  VALUES ('00000000-0000-0000-0000-0000000000a1', 'Looks after Hotel Memories and Gozsdu', 'work', 'user');
DO $$ BEGIN
  BEGIN
    INSERT INTO public.assistant_user_memory (user_id, fact, source)
      VALUES ('00000000-0000-0000-0000-0000000000a1', 'Pretends to be written by Mira', 'assistant');
    RAISE EXCEPTION 'people must not write facts as if Mira saved them';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.assistant_user_memory (user_id, fact, source)
      VALUES ('00000000-0000-0000-0000-0000000000a2', 'Writing into a colleague''s memory', 'user');
    RAISE EXCEPTION 'people must not write into someone else''s memory';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
SET request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';
DO $$ BEGIN
  IF (SELECT count(*) FROM public.assistant_user_memory) <> 0 THEN
    RAISE EXCEPTION 'a colleague can read someone else''s memory';
  END IF;
END $$;
DELETE FROM public.assistant_user_memory; -- no effect on someone else's rows
SET request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
DO $$ BEGIN
  IF (SELECT count(*) FROM public.assistant_user_memory) <> 1 THEN
    RAISE EXCEPTION 'own memory should still be there';
  END IF;
END $$;
DELETE FROM public.assistant_user_memory;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.assistant_user_memory) <> 0 THEN RAISE EXCEPTION 'own memory delete failed'; END IF;
END $$;
-- The worker secret is never readable by a signed-in person.
DO $$ BEGIN
  BEGIN
    PERFORM public.mira_usage_worker_secret();
    RAISE EXCEPTION 'the worker secret must not be callable by signed-in users';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

-- New alert kinds are accepted, unknown ones are not; daily periods dedupe per day.
INSERT INTO public.assistant_usage_alert_events (user_id, organization_slug, month_start, alert_type, message) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'rd', '2026-11-19', 'heavy_use', 'x'),
  ('00000000-0000-0000-0000-0000000000a1', 'rd', '2026-11-19', 'abuse', 'x'),
  ('00000000-0000-0000-0000-0000000000a1', 'rd', '2026-11-19', 'outage', 'x');
DO $$ BEGIN
  BEGIN
    INSERT INTO public.assistant_usage_alert_events (user_id, month_start, alert_type)
      VALUES ('00000000-0000-0000-0000-0000000000a1', '2026-11-19', 'bogus');
    RAISE EXCEPTION 'unknown alert kinds must be rejected';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.assistant_usage_alert_events (user_id, month_start, alert_type)
      VALUES ('00000000-0000-0000-0000-0000000000a1', '2026-11-19', 'abuse');
    RAISE EXCEPTION 'a second misuse alert on the same day must be a duplicate';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $$;

-- Problem reports carry diagnostics.
INSERT INTO public.assistant_issue_reports (user_id, title) VALUES ('00000000-0000-0000-0000-0000000000a1', 'Wrong supervisor');
DO $$ BEGIN
  IF (SELECT diagnostics FROM public.assistant_issue_reports LIMIT 1) <> '{}'::jsonb THEN
    RAISE EXCEPTION 'diagnostics should default to an empty object';
  END IF;
END $$;

\echo 'mira v2 migration checks passed'
