
CREATE TABLE public.competitor_properties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL,
  organization_slug text NOT NULL,
  name text NOT NULL,
  source_url text,
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX competitor_properties_hotel_idx ON public.competitor_properties (hotel_id, active);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.competitor_properties TO authenticated;
GRANT ALL ON public.competitor_properties TO service_role;
ALTER TABLE public.competitor_properties ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Revenue users read competitors" ON public.competitor_properties
FOR SELECT TO authenticated
USING (public.is_revenue_user(auth.uid())
  AND organization_slug = public.get_user_organization_slug(auth.uid())
  AND public.user_can_access_hotel(auth.uid(), hotel_id));

CREATE POLICY "Revenue users manage competitors" ON public.competitor_properties
FOR ALL TO authenticated
USING (public.is_revenue_user(auth.uid())
  AND organization_slug = public.get_user_organization_slug(auth.uid())
  AND public.user_can_access_hotel(auth.uid(), hotel_id))
WITH CHECK (public.is_revenue_user(auth.uid())
  AND organization_slug = public.get_user_organization_slug(auth.uid())
  AND public.user_can_access_hotel(auth.uid(), hotel_id));

CREATE TABLE public.competitor_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competitor_id uuid NOT NULL REFERENCES public.competitor_properties(id) ON DELETE CASCADE,
  hotel_id text NOT NULL,
  organization_slug text NOT NULL,
  stay_date date NOT NULL,
  rate numeric,
  currency text NOT NULL DEFAULT 'EUR',
  source text,
  captured_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX competitor_rates_uidx ON public.competitor_rates (competitor_id, stay_date);
CREATE INDEX competitor_rates_hotel_date_idx ON public.competitor_rates (hotel_id, stay_date);

GRANT SELECT ON public.competitor_rates TO authenticated;
GRANT ALL ON public.competitor_rates TO service_role;
ALTER TABLE public.competitor_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Revenue users read competitor rates" ON public.competitor_rates
FOR SELECT TO authenticated
USING (public.is_revenue_user(auth.uid())
  AND organization_slug = public.get_user_organization_slug(auth.uid())
  AND public.user_can_access_hotel(auth.uid(), hotel_id));

CREATE TABLE public.revenue_digest_settings (
  hotel_id text PRIMARY KEY,
  organization_slug text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  send_hour integer NOT NULL DEFAULT 6,
  send_minute integer NOT NULL DEFAULT 30,
  recipients text[] NOT NULL DEFAULT '{}',
  last_sent_on date,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.revenue_digest_settings TO authenticated;
GRANT ALL ON public.revenue_digest_settings TO service_role;
ALTER TABLE public.revenue_digest_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Revenue users read digest settings" ON public.revenue_digest_settings
FOR SELECT TO authenticated
USING (public.is_revenue_user(auth.uid())
  AND organization_slug = public.get_user_organization_slug(auth.uid())
  AND public.user_can_access_hotel(auth.uid(), hotel_id));

CREATE POLICY "Revenue users manage digest settings" ON public.revenue_digest_settings
FOR ALL TO authenticated
USING (public.is_revenue_user(auth.uid())
  AND organization_slug = public.get_user_organization_slug(auth.uid())
  AND public.user_can_access_hotel(auth.uid(), hotel_id))
WITH CHECK (public.is_revenue_user(auth.uid())
  AND organization_slug = public.get_user_organization_slug(auth.uid())
  AND public.user_can_access_hotel(auth.uid(), hotel_id));

CREATE TRIGGER competitor_properties_touch BEFORE UPDATE ON public.competitor_properties
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
