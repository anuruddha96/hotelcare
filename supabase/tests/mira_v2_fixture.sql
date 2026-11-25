-- Minimal copy of the production objects the Mira v2 migration touches, with
-- the production policies as they were before it (read from the live schema
-- on 19 Nov 2026). Used by mira_v2_integration.sql on a throwaway database.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon, service_role;
GRANT USAGE ON SCHEMA public TO authenticated, anon, service_role;

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY, organization_slug text, assigned_hotel text, role text, deleted_at timestamptz
);

CREATE FUNCTION public.pi_user_hotel() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT assigned_hotel FROM public.profiles WHERE id = auth.uid() $$;
CREATE FUNCTION public.pi_user_org() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT organization_slug FROM public.profiles WHERE id = auth.uid() $$;
GRANT EXECUTE ON FUNCTION public.pi_user_hotel(), public.pi_user_org() TO authenticated;

CREATE TABLE public.assistant_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  organization_slug text DEFAULT public.pi_user_org(),
  hotel_id text DEFAULT public.pi_user_hotel(),
  title text NOT NULL DEFAULT 'New chat',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.assistant_threads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own scoped threads" ON public.assistant_threads FOR ALL
  USING ((user_id = auth.uid()) AND (NOT (organization_slug IS DISTINCT FROM pi_user_org())) AND (NOT (hotel_id IS DISTINCT FROM pi_user_hotel())))
  WITH CHECK ((user_id = auth.uid()) AND (NOT (organization_slug IS DISTINCT FROM pi_user_org())) AND (NOT (hotel_id IS DISTINCT FROM pi_user_hotel())));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.assistant_threads TO authenticated;

CREATE TABLE public.assistant_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.assistant_threads(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text NOT NULL,
  content text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.assistant_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read messages from own scoped threads" ON public.assistant_messages FOR SELECT
  USING ((user_id = auth.uid()) AND (EXISTS (SELECT 1 FROM assistant_threads t
    WHERE ((t.id = assistant_messages.thread_id) AND (t.user_id = auth.uid())
      AND (NOT (t.organization_slug IS DISTINCT FROM pi_user_org())) AND (NOT (t.hotel_id IS DISTINCT FROM pi_user_hotel()))))));
GRANT SELECT ON public.assistant_messages TO authenticated;

CREATE TABLE public.assistant_usage_alert_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_slug text,
  month_start date NOT NULL,
  alert_type text NOT NULL CONSTRAINT assistant_usage_alert_events_alert_type_check
    CHECK (alert_type = ANY (ARRAY['quota_reached'::text, 'quota_blocked'::text, 'high_tokens'::text, 'monthly_tokens'::text])),
  message text,
  emailed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, month_start, alert_type)
);

CREATE TABLE public.assistant_monthly_message_usage (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message_id text NOT NULL,
  month_start date NOT NULL,
  organization_slug text,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  estimated_cost_usd numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, message_id)
);

CREATE TABLE public.assistant_issue_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
