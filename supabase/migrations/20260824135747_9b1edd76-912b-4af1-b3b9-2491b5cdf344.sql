-- 1. Announcements ------------------------------------------------------
CREATE TABLE public.system_announcements (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title text NOT NULL,
  body text NOT NULL,
  tone text NOT NULL DEFAULT 'info',
  target_org_slugs text[] NOT NULL DEFAULT '{}',
  target_roles text[] NOT NULL DEFAULT '{}',
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  published boolean NOT NULL DEFAULT true,
  pinned boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT system_announcements_tone_chk CHECK (tone IN ('info','warning','critical'))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.system_announcements TO authenticated;
GRANT ALL ON public.system_announcements TO service_role;

ALTER TABLE public.system_announcements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff read announcements targeted at them"
ON public.system_announcements FOR SELECT TO authenticated
USING (
  published
  AND starts_at <= now()
  AND (ends_at IS NULL OR ends_at > now())
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND (
        cardinality(target_org_slugs) = 0
        OR p.organization_slug = ANY (target_org_slugs)
      )
      AND (
        cardinality(target_roles) = 0
        OR p.role::text = ANY (target_roles)
      )
  )
);

CREATE POLICY "Admins manage announcements"
ON public.system_announcements FOR ALL TO authenticated
USING (public.is_super_admin(auth.uid()) OR public.get_current_user_role() = 'admin')
WITH CHECK (public.is_super_admin(auth.uid()) OR public.get_current_user_role() = 'admin');

CREATE TABLE public.announcement_receipts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  announcement_id uuid NOT NULL REFERENCES public.system_announcements(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  seen_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (announcement_id, user_id)
);

GRANT SELECT, INSERT, UPDATE ON public.announcement_receipts TO authenticated;
GRANT ALL ON public.announcement_receipts TO service_role;

ALTER TABLE public.announcement_receipts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own announcement receipts"
ON public.announcement_receipts FOR ALL TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE TRIGGER update_system_announcements_updated_at
BEFORE UPDATE ON public.system_announcements
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_announcement_receipts_updated_at
BEFORE UPDATE ON public.announcement_receipts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Payments -----------------------------------------------------------
ALTER TABLE public.billing_settings
  ADD COLUMN IF NOT EXISTS revenue_pricing_mode text NOT NULL DEFAULT 'per_room',
  ADD COLUMN IF NOT EXISTS revenue_percent_bps integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS revenue_percent_min_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS revenue_percent_cap_cents integer NOT NULL DEFAULT 0;

ALTER TABLE public.billing_settings
  DROP CONSTRAINT IF EXISTS billing_settings_revenue_pricing_mode_chk;
ALTER TABLE public.billing_settings
  ADD CONSTRAINT billing_settings_revenue_pricing_mode_chk
  CHECK (revenue_pricing_mode IN ('per_room','percent_revenue'));

CREATE TABLE public.billing_revenue_usage (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_slug text NOT NULL,
  hotel_id text NOT NULL,
  period_month date NOT NULL,
  realised_revenue_cents bigint NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'EUR',
  percent_bps integer NOT NULL DEFAULT 0,
  fee_cents bigint NOT NULL DEFAULT 0,
  room_nights integer NOT NULL DEFAULT 0,
  billed_at timestamptz,
  stripe_invoice_item_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_slug, hotel_id, period_month)
);

GRANT SELECT ON public.billing_revenue_usage TO authenticated;
GRANT ALL ON public.billing_revenue_usage TO service_role;

ALTER TABLE public.billing_revenue_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Billing owners read their revenue usage"
ON public.billing_revenue_usage FOR SELECT TO authenticated
USING (
  public.is_super_admin(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.organization_slug = billing_revenue_usage.organization_slug
      AND p.role::text IN ('admin','top_management','top_management_manager')
  )
);

CREATE TRIGGER update_billing_revenue_usage_updated_at
BEFORE UPDATE ON public.billing_revenue_usage
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
