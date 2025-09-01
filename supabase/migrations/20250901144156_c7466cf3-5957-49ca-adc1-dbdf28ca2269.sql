-- Create rooms table for hotel room management
CREATE TABLE public.rooms (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  hotel text NOT NULL,
  room_number text NOT NULL,
  room_type text DEFAULT 'standard',
  floor_number integer,
  status text DEFAULT 'clean' CHECK (status IN ('clean', 'dirty', 'out_of_order', 'maintenance')),
  last_cleaned_at timestamp with time zone,
  last_cleaned_by uuid REFERENCES public.profiles(id),
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(hotel, room_number)
);

-- Create minibar_items table for minibar configuration
CREATE TABLE public.minibar_items (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  category text DEFAULT 'beverage',
  price numeric(10,2) NOT NULL DEFAULT 0.00,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Create room_minibar_usage table to track minibar consumption
CREATE TABLE public.room_minibar_usage (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  minibar_item_id uuid NOT NULL REFERENCES public.minibar_items(id) ON DELETE CASCADE,
  quantity_used integer DEFAULT 0,
  usage_date timestamp with time zone DEFAULT now(),
  recorded_by uuid REFERENCES public.profiles(id),
  guest_checkout_date timestamp with time zone,
  is_cleared boolean DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS on all new tables
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.minibar_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_minibar_usage ENABLE ROW LEVEL SECURITY;

-- Create policies for rooms table
CREATE POLICY "All authenticated users can view rooms"
ON public.rooms
FOR SELECT
USING (true);

CREATE POLICY "All staff can update room status"
ON public.rooms
FOR UPDATE
USING (true)
WITH CHECK (true);

CREATE POLICY "Admins can insert rooms"
ON public.rooms
FOR INSERT
WITH CHECK (get_user_role(auth.uid()) = 'admin'::user_role);

CREATE POLICY "Admins can delete rooms"
ON public.rooms
FOR DELETE
USING (get_user_role(auth.uid()) = 'admin'::user_role);

-- Create policies for minibar_items table
CREATE POLICY "All authenticated users can view minibar items"
ON public.minibar_items
FOR SELECT
USING (true);

CREATE POLICY "Admins can manage minibar items"
ON public.minibar_items
FOR ALL
USING (get_user_role(auth.uid()) = 'admin'::user_role)
WITH CHECK (get_user_role(auth.uid()) = 'admin'::user_role);

-- Create policies for room_minibar_usage table
CREATE POLICY "All authenticated users can view minibar usage"
ON public.room_minibar_usage
FOR SELECT
USING (true);

CREATE POLICY "All staff can record minibar usage"
ON public.room_minibar_usage
FOR INSERT
WITH CHECK (true);

CREATE POLICY "All staff can update minibar usage"
ON public.room_minibar_usage
FOR UPDATE
USING (true)
WITH CHECK (true);

-- Add triggers for updated_at timestamps
CREATE TRIGGER update_rooms_updated_at
BEFORE UPDATE ON public.rooms
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_minibar_items_updated_at
BEFORE UPDATE ON public.minibar_items
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_room_minibar_usage_updated_at
BEFORE UPDATE ON public.room_minibar_usage
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Insert default minibar items
INSERT INTO public.minibar_items (name, category, price) VALUES
('Coca Cola', 'beverage', 3.50),
('Mineral Water', 'beverage', 2.00),
('Beer', 'beverage', 4.00),
('Wine (Red)', 'beverage', 12.00),
('Wine (White)', 'beverage', 12.00),
('Pringles', 'snack', 4.50),
('Chocolate Bar', 'snack', 3.00),
('Nuts Mix', 'snack', 5.00),
('Energy Drink', 'beverage', 4.50),
('Juice', 'beverage', 3.00);