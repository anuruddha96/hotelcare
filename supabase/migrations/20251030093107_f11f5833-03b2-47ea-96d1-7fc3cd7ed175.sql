-- Create organization settings table for storing app-wide configurations
CREATE TABLE IF NOT EXISTS public.organization_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_slug TEXT NOT NULL,
  setting_key TEXT NOT NULL,
  setting_value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id),
  UNIQUE(organization_slug, setting_key)
);

-- Enable RLS
ALTER TABLE public.organization_settings ENABLE ROW LEVEL SECURITY;

-- Policy: Admins can manage all settings for their organization
CREATE POLICY "Admins can manage organization settings"
ON public.organization_settings
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid()
    AND profiles.organization_slug = organization_settings.organization_slug
    AND profiles.role = 'admin'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid()
    AND profiles.organization_slug = organization_settings.organization_slug
    AND profiles.role = 'admin'
  )
);

-- Policy: All authenticated users can read their organization's settings
CREATE POLICY "Users can read organization settings"
ON public.organization_settings
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid()
    AND profiles.organization_slug = organization_settings.organization_slug
  )
);

-- Create updated_at trigger
CREATE TRIGGER set_organization_settings_updated_at
BEFORE UPDATE ON public.organization_settings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create index for faster lookups
CREATE INDEX idx_organization_settings_org_key ON public.organization_settings(organization_slug, setting_key);