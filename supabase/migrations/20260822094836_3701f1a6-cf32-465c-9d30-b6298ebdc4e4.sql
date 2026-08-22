CREATE TABLE public.billing_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_slug text NOT NULL UNIQUE,
  currency text NOT NULL DEFAULT 'EUR',
  revenue_price_cents integer NOT NULL DEFAULT 1500,
  revenue_module_enabled boolean NOT NULL DEFAULT false,
  operations_price_cents integer NOT NULL DEFAULT 600,
  operations_module_enabled boolean NOT NULL DEFAULT true,
  operations_module_label text NOT NULL DEFAULT 'Housekeeping',
  trial_enabled boolean NOT NULL DEFAULT true,
  trial_months integer NOT NULL DEFAULT 1,
  trial_start date NOT NULL DEFAULT CURRENT_DATE,
  stripe_publishable_key text,
  payments_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.billing_settings TO authenticated;
GRANT ALL ON public.billing_settings TO service_role;
ALTER TABLE public.billing_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "billing_settings_read_own_org" ON public.billing_settings
  FOR SELECT TO authenticated
  USING (organization_slug = public.pi_user_org() OR public.is_super_admin(auth.uid()) OR public.get_current_user_role() = 'admin');

CREATE POLICY "billing_settings_admin_write" ON public.billing_settings
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()) OR public.get_current_user_role() = 'admin')
  WITH CHECK (public.is_super_admin(auth.uid()) OR public.get_current_user_role() = 'admin');

CREATE TRIGGER billing_settings_touch BEFORE UPDATE ON public.billing_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.billing_hotel_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_slug text NOT NULL,
  hotel_id text NOT NULL UNIQUE,
  room_count integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.billing_hotel_overrides TO authenticated;
GRANT ALL ON public.billing_hotel_overrides TO service_role;
ALTER TABLE public.billing_hotel_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "billing_overrides_read_own_org" ON public.billing_hotel_overrides
  FOR SELECT TO authenticated
  USING (organization_slug = public.pi_user_org() OR public.is_super_admin(auth.uid()) OR public.get_current_user_role() = 'admin');

CREATE POLICY "billing_overrides_admin_write" ON public.billing_hotel_overrides
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()) OR public.get_current_user_role() = 'admin')
  WITH CHECK (public.is_super_admin(auth.uid()) OR public.get_current_user_role() = 'admin');

CREATE TRIGGER billing_hotel_overrides_touch BEFORE UPDATE ON public.billing_hotel_overrides
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.module_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_slug text NOT NULL,
  hotel_id text NOT NULL,
  module text NOT NULL CHECK (module IN ('revenue','operations')),
  status text NOT NULL DEFAULT 'inactive',
  quantity integer NOT NULL DEFAULT 0,
  unit_amount_cents integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'EUR',
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_item_id text,
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, module)
);

GRANT SELECT ON public.module_subscriptions TO authenticated;
GRANT ALL ON public.module_subscriptions TO service_role;
ALTER TABLE public.module_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "module_subscriptions_read_own_org" ON public.module_subscriptions
  FOR SELECT TO authenticated
  USING (organization_slug = public.pi_user_org() OR public.is_super_admin(auth.uid()) OR public.get_current_user_role() = 'admin');

CREATE TRIGGER module_subscriptions_touch BEFORE UPDATE ON public.module_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.billing_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id text UNIQUE,
  event_type text,
  organization_slug text,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.billing_events TO authenticated;
GRANT ALL ON public.billing_events TO service_role;
ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "billing_events_admin_read" ON public.billing_events
  FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()) OR public.get_current_user_role() = 'admin');

CREATE OR REPLACE FUNCTION public.billable_room_count(_hotel_id text)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT bo.room_count FROM public.billing_hotel_overrides bo
      WHERE bo.hotel_id = _hotel_id AND bo.room_count IS NOT NULL),
    (SELECT COUNT(*)::int FROM public.rooms r
      WHERE r.hotel = _hotel_id
         OR r.hotel = (SELECT hc.hotel_name FROM public.hotel_configurations hc WHERE hc.hotel_id = _hotel_id LIMIT 1)),
    0
  );
$$;

GRANT EXECUTE ON FUNCTION public.billable_room_count(text) TO authenticated, service_role;

INSERT INTO public.billing_settings (organization_slug, revenue_price_cents, revenue_module_enabled, operations_price_cents, operations_module_label, trial_months, trial_start)
VALUES
  ('rdhotels', 1500, false, 600, 'Housekeeping', 1, CURRENT_DATE - INTERVAL '7 days'),
  ('slnt', 1500, false, 300, 'Operations', 3, CURRENT_DATE),
  ('hotelcare', 1500, false, 600, 'Housekeeping', 12, CURRENT_DATE)
ON CONFLICT (organization_slug) DO NOTHING;