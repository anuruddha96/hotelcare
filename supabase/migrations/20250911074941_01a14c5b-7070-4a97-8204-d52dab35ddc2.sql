-- Create dirty linen items configuration table (admin configurable)
CREATE TABLE public.dirty_linen_items (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    display_name TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create dirty linen counts table (housekeeper submissions)
CREATE TABLE public.dirty_linen_counts (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    housekeeper_id UUID NOT NULL,
    room_id UUID NOT NULL,
    assignment_id UUID,
    linen_item_id UUID NOT NULL REFERENCES public.dirty_linen_items(id) ON DELETE CASCADE,
    count INTEGER NOT NULL DEFAULT 0,
    work_date DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.dirty_linen_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dirty_linen_counts ENABLE ROW LEVEL SECURITY;

-- RLS policies for dirty_linen_items
CREATE POLICY "All authenticated users can view linen items" 
ON public.dirty_linen_items 
FOR SELECT 
USING (true);

CREATE POLICY "Only admins can manage linen items" 
ON public.dirty_linen_items 
FOR ALL 
USING (get_user_role(auth.uid()) = 'admin'::user_role)
WITH CHECK (get_user_role(auth.uid()) = 'admin'::user_role);

-- RLS policies for dirty_linen_counts
CREATE POLICY "Housekeepers can view their own counts" 
ON public.dirty_linen_counts 
FOR SELECT 
USING (housekeeper_id = auth.uid() OR get_user_role(auth.uid()) = ANY (ARRAY['manager'::user_role, 'housekeeping_manager'::user_role, 'admin'::user_role]));

CREATE POLICY "Housekeepers can create their own counts" 
ON public.dirty_linen_counts 
FOR INSERT 
WITH CHECK (housekeeper_id = auth.uid() AND get_user_role(auth.uid()) = ANY (ARRAY['housekeeping'::user_role, 'manager'::user_role, 'admin'::user_role]));

CREATE POLICY "Housekeepers can update their own counts" 
ON public.dirty_linen_counts 
FOR UPDATE 
USING (housekeeper_id = auth.uid() OR get_user_role(auth.uid()) = ANY (ARRAY['manager'::user_role, 'housekeeping_manager'::user_role, 'admin'::user_role]));

CREATE POLICY "Only managers can delete linen counts" 
ON public.dirty_linen_counts 
FOR DELETE 
USING (get_user_role(auth.uid()) = ANY (ARRAY['manager'::user_role, 'housekeeping_manager'::user_role, 'admin'::user_role]));

-- Insert default linen items
INSERT INTO public.dirty_linen_items (name, display_name, sort_order) VALUES 
('pillow_cases', 'Pillow Cases', 1),
('bed_sheets', 'Bed Sheets', 2),
('duvet_covers', 'Duvet Covers', 3),
('blankets', 'Blankets', 4),
('towels_bath', 'Bath Towels', 5),
('towels_hand', 'Hand Towels', 6),
('towels_face', 'Face Towels', 7),
('bath_mats', 'Bath Mats', 8),
('curtains', 'Curtains', 9),
('table_cloths', 'Table Cloths', 10);

-- Create indexes for performance
CREATE INDEX idx_dirty_linen_counts_housekeeper_date ON public.dirty_linen_counts(housekeeper_id, work_date);
CREATE INDEX idx_dirty_linen_counts_work_date ON public.dirty_linen_counts(work_date);
CREATE INDEX idx_dirty_linen_items_active_sort ON public.dirty_linen_items(is_active, sort_order);

-- Create triggers for updated_at
CREATE TRIGGER update_dirty_linen_items_updated_at
    BEFORE UPDATE ON public.dirty_linen_items
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_dirty_linen_counts_updated_at
    BEFORE UPDATE ON public.dirty_linen_counts
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();