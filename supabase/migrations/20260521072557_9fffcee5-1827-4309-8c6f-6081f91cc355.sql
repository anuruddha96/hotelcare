
-- Add breakfast_restaurants config to hotel_configurations for multi-org /bb support
ALTER TABLE public.hotel_configurations
  ADD COLUMN IF NOT EXISTS breakfast_restaurants jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS breakfast_enabled boolean NOT NULL DEFAULT false;

-- Backfill the four RD Hotels Group breakfast hotels with their current restaurant lists.
UPDATE public.hotel_configurations
   SET breakfast_enabled = true,
       breakfast_restaurants = '[
         {"key":"levante","label_key":"restaurant_levante","label":"Levante"},
         {"key":"memories_basement","label_key":"restaurant_memories_basement","label":"Memories Basement"}
       ]'::jsonb
 WHERE hotel_id = 'memories-budapest';

UPDATE public.hotel_configurations
   SET breakfast_enabled = true,
       breakfast_restaurants = '[{"key":"main","label_key":"restaurant_main","label":"Main"}]'::jsonb
 WHERE hotel_id IN ('mika-downtown','ottofiori','gozsdu-court');

-- Public read of org+hotel breakfast metadata is needed by the /bb anonymous page.
-- Use a SECURITY DEFINER function rather than opening RLS on hotel_configurations.
CREATE OR REPLACE FUNCTION public.get_public_breakfast_hotels(_org_slug text)
RETURNS TABLE (
  hotel_id text,
  hotel_name text,
  organization_slug text,
  organization_name text,
  custom_logo_url text,
  custom_app_name text,
  custom_primary_color text,
  breakfast_restaurants jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT h.hotel_id,
         h.hotel_name,
         o.slug                AS organization_slug,
         o.name                AS organization_name,
         h.custom_logo_url,
         h.custom_app_name,
         h.custom_primary_color,
         h.breakfast_restaurants
    FROM public.hotel_configurations h
    JOIN public.organizations o ON o.id = h.organization_id
   WHERE o.slug = _org_slug
     AND h.is_active = true
     AND h.breakfast_enabled = true
   ORDER BY h.hotel_name;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_breakfast_hotels(text) TO anon, authenticated;
