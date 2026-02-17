
-- Add display_order to minibar_items
ALTER TABLE minibar_items ADD COLUMN IF NOT EXISTS display_order INTEGER DEFAULT 0;

-- Create category order table
CREATE TABLE IF NOT EXISTS minibar_category_order (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT UNIQUE NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE minibar_category_order ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view category order" ON minibar_category_order FOR SELECT USING (true);
CREATE POLICY "Admins and managers can manage category order" ON minibar_category_order FOR ALL USING (get_user_role(auth.uid()) = ANY (ARRAY['admin'::user_role, 'manager'::user_role, 'housekeeping_manager'::user_role])) WITH CHECK (get_user_role(auth.uid()) = ANY (ARRAY['admin'::user_role, 'manager'::user_role, 'housekeeping_manager'::user_role]));

-- Seed default categories
INSERT INTO minibar_category_order (category, sort_order) VALUES
  ('snack', 1), ('beverage', 2), ('alcohol', 3)
ON CONFLICT (category) DO NOTHING;

-- Create guest recommendations table
CREATE TABLE IF NOT EXISTS guest_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  description TEXT,
  specialty TEXT,
  map_url TEXT,
  icon TEXT DEFAULT '📍',
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE guest_recommendations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active recommendations" ON guest_recommendations FOR SELECT USING (is_active = true);
CREATE POLICY "Admins and managers can manage recommendations" ON guest_recommendations FOR ALL USING (get_user_role(auth.uid()) = ANY (ARRAY['admin'::user_role, 'manager'::user_role, 'housekeeping_manager'::user_role])) WITH CHECK (get_user_role(auth.uid()) = ANY (ARRAY['admin'::user_role, 'manager'::user_role, 'housekeeping_manager'::user_role]));

-- Seed current hardcoded recommendations
INSERT INTO guest_recommendations (name, type, description, specialty, map_url, icon, sort_order) VALUES
  ('Treats and Stuff Café', 'Café & Bakery', 'Cozy artisan bakery known for irresistible brownies, specialty coffee, and homemade treats. A must-visit for dessert lovers!', '🍫 Famous brownies & specialty coffee', 'https://maps.google.com/?q=Treats+and+Stuff+Budapest', '☕', 1),
  ('Mika Tivadar Secret Museum', 'Museum', 'Hidden gem dedicated to the visionary art of Tivadar Csontváry Kosztka, one of Hungary''s most enigmatic painters.', '🎨 Rare Csontváry masterpieces', 'https://maps.google.com/?q=Mika+Tivadar+Secret+Museum+Budapest', '🏛️', 2),
  ('Szimpla Kert', 'Ruin Bar', 'The original ruin bar — an eclectic maze of quirky décor, live music, and craft drinks in a converted warehouse.', '🎶 Live music & unique atmosphere', 'https://maps.google.com/?q=Szimpla+Kert+Budapest', '🍻', 3),
  ('Széchenyi Thermal Bath', 'Spa & Wellness', 'Europe''s largest thermal bath complex with stunning neo-baroque architecture and rejuvenating thermal waters.', '♨️ 18 pools & thermal waters', 'https://maps.google.com/?q=Széchenyi+Thermal+Bath+Budapest', '🧖', 4),
  ('Great Market Hall', 'Market & Shopping', 'Budapest''s grandest covered market — three floors of Hungarian delicacies, spices, crafts, and souvenirs.', '🌶️ Hungarian paprika & local treats', 'https://maps.google.com/?q=Great+Market+Hall+Budapest', '🏪', 5),
  ('Fisherman''s Bastion', 'Landmark', 'Fairy-tale terraces on Castle Hill offering the most breathtaking panoramic views of the Danube and Parliament.', '📸 Best photo spot in Budapest', 'https://maps.google.com/?q=Fisherman%27s+Bastion+Budapest', '🏰', 6);
