CREATE TABLE public.motivational_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote text NOT NULL,
  author text NOT NULL DEFAULT 'Unknown',
  quote_key text GENERATED ALWAYS AS (lower(regexp_replace(quote, '[^a-zA-Z0-9]+', ' ', 'g'))) STORED,
  source text NOT NULL DEFAULT 'seed',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX motivational_quotes_key_uidx ON public.motivational_quotes (quote_key);
CREATE INDEX motivational_quotes_active_idx ON public.motivational_quotes (is_active, created_at);

GRANT SELECT ON public.motivational_quotes TO authenticated;
GRANT ALL ON public.motivational_quotes TO service_role;
ALTER TABLE public.motivational_quotes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read quotes" ON public.motivational_quotes FOR SELECT TO authenticated USING (is_active);

CREATE TABLE public.motivational_quote_state (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  status text NOT NULL DEFAULT 'idle',
  paused_reason text,
  lease_until timestamptz,
  last_refresh_at timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.motivational_quote_state TO authenticated;
GRANT ALL ON public.motivational_quote_state TO service_role;
ALTER TABLE public.motivational_quote_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read quote refresh state" ON public.motivational_quote_state FOR SELECT TO authenticated USING (true);
INSERT INTO public.motivational_quote_state (id) VALUES (true);