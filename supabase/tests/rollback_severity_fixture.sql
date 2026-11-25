-- Minimal isolated database fixture for testing the production enqueue guard.
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE TABLE public.system_anomaly_settings (
  singleton boolean PRIMARY KEY DEFAULT true,
  cooldown_minutes integer NOT NULL DEFAULT 60
);
CREATE TABLE public.system_anomaly_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint text NOT NULL,
  kind text NOT NULL,
  severity text NOT NULL,
  title text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  detected_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.system_anomaly_settings(singleton,cooldown_minutes) VALUES(true,60);
