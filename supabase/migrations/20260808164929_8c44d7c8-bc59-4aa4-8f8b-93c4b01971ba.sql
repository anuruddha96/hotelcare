CREATE TABLE public.revenue_signal_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL,
  organization_slug text,
  business_date date NOT NULL DEFAULT (now() AT TIME ZONE 'Europe/Budapest')::date,
  signal_key text NOT NULL,
  signal_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  decision text NOT NULL DEFAULT 'done',
  note text,
  acted_by uuid,
  acted_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, business_date, signal_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.revenue_signal_actions TO authenticated;
GRANT ALL ON public.revenue_signal_actions TO service_role;

ALTER TABLE public.revenue_signal_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org staff read signal actions"
ON public.revenue_signal_actions FOR SELECT TO authenticated
USING (public.user_can_access_hotel(auth.uid(), hotel_id));

CREATE POLICY "Org staff record signal actions"
ON public.revenue_signal_actions FOR INSERT TO authenticated
WITH CHECK (public.user_can_access_hotel(auth.uid(), hotel_id) AND acted_by = auth.uid());

CREATE POLICY "Org staff update own signal actions"
ON public.revenue_signal_actions FOR UPDATE TO authenticated
USING (public.user_can_access_hotel(auth.uid(), hotel_id))
WITH CHECK (public.user_can_access_hotel(auth.uid(), hotel_id));

CREATE POLICY "Org staff delete own signal actions"
ON public.revenue_signal_actions FOR DELETE TO authenticated
USING (public.user_can_access_hotel(auth.uid(), hotel_id) AND acted_by = auth.uid());

CREATE TRIGGER trg_revenue_signal_actions_updated_at
BEFORE UPDATE ON public.revenue_signal_actions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.revenue_signal_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL,
  organization_slug text,
  business_date date NOT NULL DEFAULT (now() AT TIME ZONE 'Europe/Budapest')::date,
  model text,
  signals jsonb NOT NULL DEFAULT '[]'::jsonb,
  input_digest text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.revenue_signal_runs TO authenticated;
GRANT ALL ON public.revenue_signal_runs TO service_role;

ALTER TABLE public.revenue_signal_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org staff read signal runs"
ON public.revenue_signal_runs FOR SELECT TO authenticated
USING (public.user_can_access_hotel(auth.uid(), hotel_id));

CREATE INDEX idx_revenue_signal_runs_lookup ON public.revenue_signal_runs (hotel_id, business_date, created_at DESC);
CREATE INDEX idx_revenue_signal_actions_lookup ON public.revenue_signal_actions (hotel_id, business_date);

CREATE TRIGGER trg_revenue_signal_runs_updated_at
BEFORE UPDATE ON public.revenue_signal_runs
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();