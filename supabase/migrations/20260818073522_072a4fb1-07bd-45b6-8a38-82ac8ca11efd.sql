CREATE TABLE IF NOT EXISTS public.email_settings (
  organization_slug text PRIMARY KEY,
  from_name text NOT NULL DEFAULT 'Hotel Care',
  from_email text NOT NULL DEFAULT 'onboarding@resend.dev',
  reply_to text,
  transactional_enabled boolean NOT NULL DEFAULT true,
  digest_enabled boolean NOT NULL DEFAULT true,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.email_settings TO authenticated;
GRANT ALL ON public.email_settings TO service_role;

ALTER TABLE public.email_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "email_settings_select_own_org"
ON public.email_settings FOR SELECT TO authenticated
USING (organization_slug = public.pi_user_org());

CREATE POLICY "email_settings_insert_admins"
ON public.email_settings FOR INSERT TO authenticated
WITH CHECK (
  organization_slug = public.pi_user_org()
  AND public.get_current_user_role() IN ('admin','manager','top_management')
);

CREATE POLICY "email_settings_update_admins"
ON public.email_settings FOR UPDATE TO authenticated
USING (
  organization_slug = public.pi_user_org()
  AND public.get_current_user_role() IN ('admin','manager','top_management')
)
WITH CHECK (
  organization_slug = public.pi_user_org()
  AND public.get_current_user_role() IN ('admin','manager','top_management')
);

CREATE TRIGGER email_settings_touch_updated_at
BEFORE UPDATE ON public.email_settings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();