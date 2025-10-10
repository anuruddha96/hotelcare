-- Add resolution_text column to maintenance_issues table
ALTER TABLE public.maintenance_issues 
ADD COLUMN IF NOT EXISTS resolution_text text;

COMMENT ON COLUMN public.maintenance_issues.resolution_text IS 'Details of how the maintenance issue was resolved';