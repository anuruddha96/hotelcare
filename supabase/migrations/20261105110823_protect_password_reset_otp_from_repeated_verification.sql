-- Server-side OTP rate limit, backed by a shared table for all Edge Function instances.
-- HMAC keys contain no raw IP address or email.
CREATE TABLE IF NOT EXISTS public.password_reset_attempt_limits (
  key_hash text PRIMARY KEY CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz NOT NULL DEFAULT now(),
  attempt_count integer NOT NULL DEFAULT 0,
  blocked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.password_reset_attempt_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.password_reset_attempt_limits FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.password_reset_attempt_limits TO service_role;

CREATE OR REPLACE FUNCTION public.check_password_reset_attempt(p_ip_hash text, p_email_hash text)
 RETURNS TABLE(allowed boolean, retry_after_seconds integer)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_key text;
  v_now timestamptz := now();
  v_window integer;
  v_max integer;
  v_block_seconds integer := 900;
  v_blocked_until timestamptz;
  v_retry integer := 0;
  v_i integer;
BEGIN
  -- Malformed input must fail closed.
  IF p_ip_hash IS NULL OR p_email_hash IS NULL
     OR p_ip_hash !~ '^[0-9a-f]{64}$' OR p_email_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN QUERY SELECT false, 900;
    RETURN;
  END IF;

  -- Fixed iteration order prevents lock inversion when many requests overlap.
  FOR v_i IN 1..2 LOOP
    v_key := CASE WHEN v_i = 1 THEN p_ip_hash ELSE p_email_hash END;
    v_window := CASE WHEN v_i = 1 THEN 60 ELSE 900 END;
    v_max := CASE WHEN v_i = 1 THEN 12 ELSE 5 END;

    INSERT INTO public.password_reset_attempt_limits AS current_limit
      (key_hash, window_started_at, attempt_count, updated_at)
    VALUES (v_key, v_now, 1, v_now)
    ON CONFLICT (key_hash) DO UPDATE SET
      attempt_count = CASE
        WHEN current_limit.window_started_at <= v_now - make_interval(secs => v_window)
        THEN 1 ELSE current_limit.attempt_count + 1 END,
      window_started_at = CASE
        WHEN current_limit.window_started_at <= v_now - make_interval(secs => v_window)
        THEN v_now ELSE current_limit.window_started_at END,
      blocked_until = CASE
        WHEN current_limit.blocked_until > v_now THEN current_limit.blocked_until
        WHEN current_limit.window_started_at > v_now - make_interval(secs => v_window)
             AND current_limit.attempt_count + 1 > v_max
        THEN v_now + make_interval(secs => v_block_seconds)
        ELSE NULL END,
      updated_at = v_now
    RETURNING current_limit.blocked_until INTO v_blocked_until;

    IF v_blocked_until > v_now THEN
      v_retry := GREATEST(v_retry, CEIL(EXTRACT(EPOCH FROM (v_blocked_until - v_now)))::integer);
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_retry = 0, v_retry;
END;
$function$


REVOKE ALL ON FUNCTION public.check_password_reset_attempt(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_password_reset_attempt(text,text) TO service_role;
COMMENT ON FUNCTION public.check_password_reset_attempt(text,text)
IS 'Service-role-only, multi-instance password-reset OTP attempt gate; 12/IP/min and 5/email/15min, with a 15-minute lockout.';
