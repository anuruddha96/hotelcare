CREATE TABLE public.demand_overrides (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  hotel_id text NOT NULL,
  organization_slug text,
  stay_date date NOT NULL,
  score integer NOT NULL CHECK (score >= 0 AND score <= 100),
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, stay_date)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.demand_overrides TO authenticated;
GRANT ALL ON public.demand_overrides TO service_role;

ALTER TABLE public.demand_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "demand_overrides_select" ON public.demand_overrides
FOR SELECT TO authenticated
USING (is_revenue_user(auth.uid()) AND organization_slug = get_user_organization_slug(auth.uid()));

CREATE POLICY "demand_overrides_modify" ON public.demand_overrides
FOR ALL TO authenticated
USING (is_revenue_user(auth.uid()) AND organization_slug = get_user_organization_slug(auth.uid()))
WITH CHECK (is_revenue_user(auth.uid()) AND organization_slug = get_user_organization_slug(auth.uid()));

CREATE TRIGGER update_demand_overrides_updated_at
BEFORE UPDATE ON public.demand_overrides
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();