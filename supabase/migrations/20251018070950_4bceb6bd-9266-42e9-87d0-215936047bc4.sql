-- Add custom branding columns to organizations table
ALTER TABLE organizations 
ADD COLUMN IF NOT EXISTS custom_logo_url TEXT,
ADD COLUMN IF NOT EXISTS custom_primary_color TEXT DEFAULT 'hsl(200, 76%, 58%)',
ADD COLUMN IF NOT EXISTS custom_secondary_color TEXT DEFAULT 'hsl(0, 0%, 42%)',
ADD COLUMN IF NOT EXISTS custom_app_name TEXT,
ADD COLUMN IF NOT EXISTS custom_favicon_url TEXT,
ADD COLUMN IF NOT EXISTS custom_login_background TEXT,
ADD COLUMN IF NOT EXISTS custom_welcome_message TEXT,
ADD COLUMN IF NOT EXISTS allow_custom_branding BOOLEAN DEFAULT false;

-- Create index for faster branding lookups
CREATE INDEX IF NOT EXISTS idx_organizations_custom_branding ON organizations(allow_custom_branding) WHERE allow_custom_branding = true;

-- Update subscription_tier if not exists (already exists based on schema)
-- Add comment for clarity
COMMENT ON COLUMN organizations.allow_custom_branding IS 'Feature flag for enterprise custom branding. Only enabled for enterprise tier.';
COMMENT ON COLUMN organizations.custom_logo_url IS 'URL to organization custom logo for white-label branding';
COMMENT ON COLUMN organizations.custom_primary_color IS 'Primary brand color in HSL format';
COMMENT ON COLUMN organizations.custom_secondary_color IS 'Secondary brand color in HSL format';

-- Function to check if organization has branding enabled
CREATE OR REPLACE FUNCTION public.organization_has_custom_branding(org_slug text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(allow_custom_branding, false)
  FROM organizations
  WHERE slug = org_slug AND is_active = true;
$$;