-- Extra stand-ins for the end-to-end test of website-sales-chat (run after the fixture and
-- the migration): the AI usage log the function writes to, and PostgREST's login role.
CREATE TABLE IF NOT EXISTS public.ai_usage_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_slug text, hotel_id text, function_name text NOT NULL, model text,
  input_tokens integer NOT NULL DEFAULT 0, output_tokens integer NOT NULL DEFAULT 0, web_searches integer NOT NULL DEFAULT 0,
  estimated_cost_usd numeric NOT NULL DEFAULT 0, ok boolean NOT NULL DEFAULT true, error text, created_at timestamptz NOT NULL DEFAULT now());
GRANT ALL ON public.ai_usage_log TO service_role;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN CREATE ROLE authenticator LOGIN NOINHERIT; END IF; END $$;
GRANT anon, authenticated, service_role TO authenticator;
