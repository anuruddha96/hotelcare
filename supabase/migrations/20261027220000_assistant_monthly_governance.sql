-- Atomic per-user monthly assistant allowance; independent of the legacy deep-analysis wallet.
-- Reporting dates use Budapest business time, including daylight saving transitions.
CREATE TABLE IF NOT EXISTS public.assistant_monthly_message_usage (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message_id text NOT NULL,
  month_start date NOT NULL,
  organization_slug text,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  estimated_cost_usd numeric(12,5) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, message_id)
);
CREATE INDEX IF NOT EXISTS assistant_monthly_usage_user_month
  ON public.assistant_monthly_message_usage(user_id, month_start);
ALTER TABLE public.assistant_monthly_message_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.assistant_monthly_message_usage FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.assistant_monthly_message_usage TO service_role;

CREATE TABLE IF NOT EXISTS public.assistant_usage_alert_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_slug text,
  month_start date NOT NULL,
  alert_type text NOT NULL CHECK (alert_type IN ('quota_reached','quota_blocked','high_tokens','monthly_tokens')),
  message text NOT NULL,
  emailed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, month_start, alert_type)
);
ALTER TABLE public.assistant_usage_alert_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.assistant_usage_alert_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.assistant_usage_alert_events TO authenticated;
GRANT ALL ON public.assistant_usage_alert_events TO service_role;
DROP POLICY IF EXISTS assistant_alerts_admin_read ON public.assistant_usage_alert_events;
CREATE POLICY assistant_alerts_admin_read ON public.assistant_usage_alert_events
  FOR SELECT TO authenticated USING (
    (public.is_super_admin(auth.uid()) OR public.get_user_role(auth.uid())::text
      IN ('admin', 'top_management', 'top_management_manager'))
    AND (public.is_super_admin(auth.uid())
      OR organization_slug = public.get_user_organization_slug(auth.uid()))
  );

-- Called from Edge Functions with a verified user session. Serializes concurrent tabs
-- so two simultaneous sends cannot both consume slot #20.
CREATE OR REPLACE FUNCTION public.reserve_assistant_monthly_message(
  _user_id uuid, _message_id text, _organization_slug text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_month date := date_trunc('month', now() AT TIME ZONE 'Europe/Budapest')::date;
  v_used integer;
  v_role text;
  v_unlimited boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(_user_id::text));
  SELECT role::text INTO v_role FROM public.profiles
    WHERE id = _user_id AND deleted_at IS NULL;
  IF v_role IS NULL THEN RAISE EXCEPTION 'Active user profile required'; END IF;
  SELECT coalesce(enabled, false) INTO v_unlimited FROM public.assistant_unlimited_users
    WHERE user_id = _user_id;
  v_unlimited := coalesce(v_unlimited, false)
    OR v_role = 'admin' OR coalesce(public.is_super_admin(_user_id), false);
  SELECT count(*)::integer INTO v_used FROM public.assistant_monthly_message_usage
    WHERE user_id = _user_id AND month_start = v_month;
  IF EXISTS (SELECT 1 FROM public.assistant_monthly_message_usage
             WHERE user_id = _user_id AND message_id = _message_id) THEN
    RETURN jsonb_build_object('allowed', true, 'duplicate', true, 'unlimited', v_unlimited,
      'used', v_used, 'limit', CASE WHEN v_unlimited THEN NULL ELSE 20 END,
      'remaining', CASE WHEN v_unlimited THEN NULL ELSE greatest(0,20-v_used) END);
  END IF;
  IF NOT v_unlimited AND v_used >= 20 THEN
    RETURN jsonb_build_object('allowed', false, 'unlimited', false, 'used', v_used,
      'limit', 20, 'remaining', 0);
  END IF;
  INSERT INTO public.assistant_monthly_message_usage(user_id, message_id, month_start, organization_slug)
    VALUES (_user_id, _message_id, v_month, _organization_slug);
  RETURN jsonb_build_object('allowed', true, 'unlimited', v_unlimited,
    'used', v_used + 1, 'limit', CASE WHEN v_unlimited THEN NULL ELSE 20 END,
    'remaining', CASE WHEN v_unlimited THEN NULL ELSE greatest(0,19-v_used) END);
END; $$;
REVOKE ALL ON FUNCTION public.reserve_assistant_monthly_message(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_assistant_monthly_message(uuid,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.assistant_monthly_status()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_month date := date_trunc('month', now() AT TIME ZONE 'Europe/Budapest')::date;
  v_used integer;
  v_role text;
  v_unlimited boolean;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT role::text INTO v_role FROM public.profiles WHERE id = v_user AND deleted_at IS NULL;
  IF v_role IS NULL THEN RAISE EXCEPTION 'Active user required'; END IF;
  SELECT coalesce(enabled,false) INTO v_unlimited FROM public.assistant_unlimited_users WHERE user_id=v_user;
  v_unlimited := coalesce(v_unlimited,false) OR v_role='admin' OR coalesce(public.is_super_admin(v_user), false);
  SELECT count(*)::integer INTO v_used FROM public.assistant_monthly_message_usage
    WHERE user_id=v_user AND month_start=v_month;
  RETURN jsonb_build_object('used',v_used,'unlimited',v_unlimited,
     'limit',CASE WHEN v_unlimited THEN NULL ELSE 20 END,
     'remaining',CASE WHEN v_unlimited THEN NULL ELSE greatest(0,20-v_used) END,
     'resets_on',(v_month + interval '1 month')::date);
END; $$;
REVOKE ALL ON FUNCTION public.assistant_monthly_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assistant_monthly_status() TO authenticated, service_role;
