
-- Add minibar_logo_url column to hotel_configurations
ALTER TABLE public.hotel_configurations ADD COLUMN IF NOT EXISTS minibar_logo_url TEXT;

-- Insert Levante Budapest and Mitico Budapest into guest_recommendations
INSERT INTO public.guest_recommendations (name, type, description, specialty, map_url, icon, sort_order)
VALUES
  ('Levante Budapest', 'Restaurant', 'Modern Mediterranean cuisine with a contemporary twist, offering fresh seasonal dishes in an elegant setting near the Danube.', 'Mediterranean dining', 'https://maps.google.com/?q=Levante+Budapest', '🍽️', 7),
  ('Mitico Budapest', 'Restaurant', 'Authentic Italian fine dining experience featuring handmade pasta, premium ingredients, and an extensive wine selection.', 'Italian cuisine', 'https://maps.google.com/?q=Mitico+Budapest', '🍝', 8)
ON CONFLICT DO NOTHING;
