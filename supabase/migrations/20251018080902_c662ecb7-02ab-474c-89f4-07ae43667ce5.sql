-- Add custom branding fields to hotel_configurations table
ALTER TABLE public.hotel_configurations
ADD COLUMN IF NOT EXISTS custom_branding_enabled BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS custom_logo_url TEXT,
ADD COLUMN IF NOT EXISTS custom_favicon_url TEXT,
ADD COLUMN IF NOT EXISTS custom_app_name TEXT,
ADD COLUMN IF NOT EXISTS custom_primary_color TEXT DEFAULT 'hsl(200, 76%, 58%)',
ADD COLUMN IF NOT EXISTS custom_secondary_color TEXT DEFAULT 'hsl(0, 0%, 42%)',
ADD COLUMN IF NOT EXISTS custom_login_background TEXT,
ADD COLUMN IF NOT EXISTS custom_welcome_message TEXT,
ADD COLUMN IF NOT EXISTS logo_scale DECIMAL(3,1) DEFAULT 3.0;

COMMENT ON COLUMN public.hotel_configurations.custom_branding_enabled IS 'Whether custom branding is enabled for this hotel';
COMMENT ON COLUMN public.hotel_configurations.custom_logo_url IS 'Custom logo URL for the hotel';
COMMENT ON COLUMN public.hotel_configurations.logo_scale IS 'Logo size in rem units (2.0 to 8.0) for header display';