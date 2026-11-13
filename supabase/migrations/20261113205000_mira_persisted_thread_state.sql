-- Mira: keep response-read state separate from the user's follow-up task status.
-- Existing conversations start read; only NEW replies gain an unread dot.
ALTER TABLE public.assistant_threads
  ADD COLUMN IF NOT EXISTS last_read_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_reply_at timestamptz,
  ADD COLUMN IF NOT EXISTS follow_up_status text NOT NULL DEFAULT 'none';

-- Backfill last completed response for history created before the migration.
UPDATE public.assistant_threads t
SET last_reply_at = replies.last_reply
FROM (
  SELECT thread_id, max(created_at) AS last_reply
  FROM public.assistant_messages
  WHERE role = 'assistant'
  GROUP BY thread_id
) replies
WHERE t.id = replies.thread_id AND t.last_reply_at IS NULL;

-- A constraint rather than a free-form status prevents accidental invalid states.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'assistant_threads_follow_up_status_check'
  ) THEN
    ALTER TABLE public.assistant_threads ADD CONSTRAINT assistant_threads_follow_up_status_check
      CHECK (follow_up_status IN ('none','open','done'));
  END IF;
END $$;

-- Server-side insert is the only authority for a NEW completed reply.
-- An interrupted stream without a saved assistant message will not set unread.
CREATE OR REPLACE FUNCTION public.hc_assistant_record_reply()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  -- A user-stopped partial stream is saved for history but is not a finished reply.
  IF NEW.role = 'assistant' AND right(trim(NEW.content), 10) <> '_Stopped._' THEN
    UPDATE public.assistant_threads t
       SET last_reply_at = GREATEST(COALESCE(t.last_reply_at, '-infinity'::timestamptz), NEW.created_at),
           updated_at = GREATEST(t.updated_at, NEW.created_at)
     WHERE t.id = NEW.thread_id AND t.user_id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS hc_assistant_reply_insert ON public.assistant_messages;
CREATE TRIGGER hc_assistant_reply_insert
AFTER INSERT ON public.assistant_messages
FOR EACH ROW EXECUTE FUNCTION public.hc_assistant_record_reply();

-- Atomic, monotonic read acknowledgment. Only the reply actually displayed
-- can be acknowledged; a newer reply arriving concurrently stays unread.
CREATE OR REPLACE FUNCTION public.hc_mira_mark_thread_read(
  p_thread_id uuid, p_last_seen_at timestamptz
) RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$
  UPDATE public.assistant_threads t
     SET last_read_at = GREATEST(t.last_read_at, LEAST(t.last_reply_at, p_last_seen_at))
   WHERE t.id = p_thread_id
     AND t.user_id = auth.uid()
     AND t.last_reply_at IS NOT NULL
     AND p_last_seen_at IS NOT NULL;
$$;
-- Supabase may grant EXECUTE to anon through explicit default privileges,
-- so revoke the anon grant as well as PUBLIC before granting authenticated.
REVOKE ALL ON FUNCTION public.hc_mira_mark_thread_read(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hc_mira_mark_thread_read(uuid, timestamptz) TO authenticated;
