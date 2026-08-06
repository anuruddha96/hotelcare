
CREATE TABLE public.rm_analysis_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL,
  organization_slug text,
  mode text NOT NULL DEFAULT 'standard',
  model text,
  prompt_version text NOT NULL DEFAULT 'v1',
  data_fingerprint text,
  period_start date,
  period_end date,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb,
  status text NOT NULL DEFAULT 'ok',
  error text,
  prompt_tokens integer NOT NULL DEFAULT 0,
  completion_tokens integer NOT NULL DEFAULT 0,
  total_tokens integer NOT NULL DEFAULT 0,
  estimated_cost_usd numeric NOT NULL DEFAULT 0,
  cached boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rm_analysis_runs_hotel_idx ON public.rm_analysis_runs (hotel_id, created_at DESC);
CREATE INDEX rm_analysis_runs_fp_idx ON public.rm_analysis_runs (hotel_id, data_fingerprint);

CREATE TABLE public.rm_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.rm_analysis_runs(id) ON DELETE CASCADE,
  hotel_id text NOT NULL,
  organization_slug text,
  priority integer NOT NULL DEFAULT 1,
  category text NOT NULL DEFAULT 'monitoring',
  arrival_date date,
  room_type text,
  headline text NOT NULL,
  action text NOT NULL,
  reason text,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  expected_impact jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence integer NOT NULL DEFAULT 0,
  urgency text NOT NULL DEFAULT 'monitor',
  risk text,
  recommended_cta text,
  expires_at timestamptz,
  status text NOT NULL DEFAULT 'new',
  feedback text,
  feedback_note text,
  acted_by uuid,
  acted_at timestamptz,
  outcome jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rm_recommendations_hotel_idx ON public.rm_recommendations (hotel_id, created_at DESC);

GRANT SELECT ON public.rm_analysis_runs TO authenticated;
GRANT ALL ON public.rm_analysis_runs TO service_role;
GRANT SELECT, UPDATE ON public.rm_recommendations TO authenticated;
GRANT ALL ON public.rm_recommendations TO service_role;

ALTER TABLE public.rm_analysis_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rm_recommendations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Revenue users read analysis runs"
  ON public.rm_analysis_runs FOR SELECT TO authenticated
  USING (public.is_revenue_user(auth.uid()) AND public.user_can_access_hotel(auth.uid(), hotel_id));

CREATE POLICY "Revenue users read recommendations"
  ON public.rm_recommendations FOR SELECT TO authenticated
  USING (public.is_revenue_user(auth.uid()) AND public.user_can_access_hotel(auth.uid(), hotel_id));

CREATE POLICY "Revenue users update recommendation status"
  ON public.rm_recommendations FOR UPDATE TO authenticated
  USING (public.is_revenue_user(auth.uid()) AND public.user_can_access_hotel(auth.uid(), hotel_id))
  WITH CHECK (public.is_revenue_user(auth.uid()) AND public.user_can_access_hotel(auth.uid(), hotel_id));

CREATE TRIGGER rm_recommendations_touch
  BEFORE UPDATE ON public.rm_recommendations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
