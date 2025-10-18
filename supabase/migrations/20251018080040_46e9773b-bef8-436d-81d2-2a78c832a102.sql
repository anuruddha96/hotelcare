-- Add logo_scale column to organizations table for custom logo sizing
ALTER TABLE public.organizations
ADD COLUMN IF NOT EXISTS logo_scale DECIMAL(3,1) DEFAULT 3.0;

COMMENT ON COLUMN public.organizations.logo_scale IS 'Custom logo size in rem units (2.0 to 8.0) for header display';