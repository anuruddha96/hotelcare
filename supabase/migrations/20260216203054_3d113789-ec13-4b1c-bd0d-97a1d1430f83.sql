
CREATE TABLE public.hotel_floor_layouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_name text NOT NULL,
  floor_number integer NOT NULL,
  wing text NOT NULL,
  x numeric NOT NULL DEFAULT 0,
  y numeric NOT NULL DEFAULT 0,
  rotation numeric NOT NULL DEFAULT 0,
  updated_by uuid REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_name, floor_number, wing)
);

ALTER TABLE public.hotel_floor_layouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "All authenticated users can view floor layouts"
ON public.hotel_floor_layouts FOR SELECT
USING (auth.role() = 'authenticated');

CREATE POLICY "Admins can manage floor layouts"
ON public.hotel_floor_layouts FOR ALL
USING (get_user_role(auth.uid()) = 'admin'::user_role)
WITH CHECK (get_user_role(auth.uid()) = 'admin'::user_role);
