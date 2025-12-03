-- Training Guide System Tables

-- Training guides table (metadata about each training module)
CREATE TABLE public.training_guides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  target_role TEXT DEFAULT 'housekeeping',
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  total_steps INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Training guide steps table
CREATE TABLE public.training_guide_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guide_id UUID REFERENCES public.training_guides(id) ON DELETE CASCADE NOT NULL,
  step_order INTEGER NOT NULL,
  step_key TEXT NOT NULL,
  target_selector TEXT,
  position TEXT DEFAULT 'bottom',
  action_type TEXT DEFAULT 'click',
  requires_action BOOLEAN DEFAULT false,
  highlight_padding INTEGER DEFAULT 8,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(guide_id, step_order)
);

-- User training assignments table
CREATE TABLE public.user_training_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  guide_id UUID REFERENCES public.training_guides(id) ON DELETE CASCADE NOT NULL,
  assigned_by UUID,
  status TEXT DEFAULT 'assigned' CHECK (status IN ('assigned', 'in_progress', 'completed', 'skipped')),
  current_step INTEGER DEFAULT 0,
  completed_steps JSONB DEFAULT '[]'::jsonb,
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  organization_slug TEXT,
  UNIQUE(user_id, guide_id)
);

-- Enable RLS
ALTER TABLE public.training_guides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_guide_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_training_assignments ENABLE ROW LEVEL SECURITY;

-- RLS Policies for training_guides
CREATE POLICY "All authenticated users can view active training guides"
ON public.training_guides FOR SELECT
USING (is_active = true);

CREATE POLICY "Admins can manage training guides"
ON public.training_guides FOR ALL
USING (get_user_role(auth.uid()) = 'admin')
WITH CHECK (get_user_role(auth.uid()) = 'admin');

-- RLS Policies for training_guide_steps
CREATE POLICY "All authenticated users can view training steps"
ON public.training_guide_steps FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.training_guides 
  WHERE id = training_guide_steps.guide_id AND is_active = true
));

CREATE POLICY "Admins can manage training steps"
ON public.training_guide_steps FOR ALL
USING (get_user_role(auth.uid()) = 'admin')
WITH CHECK (get_user_role(auth.uid()) = 'admin');

-- RLS Policies for user_training_assignments
CREATE POLICY "Users can view their own training assignments"
ON public.user_training_assignments FOR SELECT
USING (user_id = auth.uid() OR get_user_role(auth.uid()) IN ('admin', 'manager', 'housekeeping_manager'));

CREATE POLICY "Users can update their own training progress"
ON public.user_training_assignments FOR UPDATE
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Managers can assign training"
ON public.user_training_assignments FOR INSERT
WITH CHECK (
  get_user_role(auth.uid()) IN ('admin', 'manager', 'housekeeping_manager')
  AND assigned_by = auth.uid()
);

CREATE POLICY "Managers can delete training assignments"
ON public.user_training_assignments FOR DELETE
USING (get_user_role(auth.uid()) IN ('admin', 'manager', 'housekeeping_manager'));

-- Insert default training guides
INSERT INTO public.training_guides (slug, name, description, target_role, sort_order, total_steps) VALUES
('getting-started', 'Getting Started', 'Learn the basics of the app', 'housekeeping', 1, 5),
('working-with-rooms', 'Working with Rooms', 'How to clean and manage rooms', 'housekeeping', 2, 8),
('breaks-and-signout', 'Breaks & Sign-out', 'Managing breaks and ending your shift', 'housekeeping', 3, 4),
('special-situations', 'Special Situations', 'Handling DND, maintenance, and lost items', 'housekeeping', 4, 5);

-- Insert training steps for Getting Started
INSERT INTO public.training_guide_steps (guide_id, step_order, step_key, target_selector, position, action_type, requires_action) VALUES
((SELECT id FROM public.training_guides WHERE slug = 'getting-started'), 1, 'welcome', NULL, 'center', 'info', false),
((SELECT id FROM public.training_guides WHERE slug = 'getting-started'), 2, 'check_in', '[data-training="check-in-button"]', 'bottom', 'click', false),
((SELECT id FROM public.training_guides WHERE slug = 'getting-started'), 3, 'view_rooms', '[data-training="rooms-tab"]', 'bottom', 'click', false),
((SELECT id FROM public.training_guides WHERE slug = 'getting-started'), 4, 'room_card_info', '[data-training="room-card"]', 'bottom', 'info', false),
((SELECT id FROM public.training_guides WHERE slug = 'getting-started'), 5, 'navigation', '[data-training="main-tabs"]', 'top', 'info', false);

-- Insert training steps for Working with Rooms
INSERT INTO public.training_guide_steps (guide_id, step_order, step_key, target_selector, position, action_type, requires_action) VALUES
((SELECT id FROM public.training_guides WHERE slug = 'working-with-rooms'), 1, 'start_room', '[data-training="start-room-button"]', 'top', 'hold', false),
((SELECT id FROM public.training_guides WHERE slug = 'working-with-rooms'), 2, 'capture_photos', '[data-training="room-photos-button"]', 'top', 'click', false),
((SELECT id FROM public.training_guides WHERE slug = 'working-with-rooms'), 3, 'dirty_linen', '[data-training="dirty-linen-button"]', 'top', 'click', false),
((SELECT id FROM public.training_guides WHERE slug = 'working-with-rooms'), 4, 'mark_dnd', '[data-training="dnd-button"]', 'top', 'click', false),
((SELECT id FROM public.training_guides WHERE slug = 'working-with-rooms'), 5, 'maintenance', '[data-training="maintenance-button"]', 'top', 'click', false),
((SELECT id FROM public.training_guides WHERE slug = 'working-with-rooms'), 6, 'lost_found', '[data-training="lost-found-button"]', 'top', 'click', false),
((SELECT id FROM public.training_guides WHERE slug = 'working-with-rooms'), 7, 'add_notes', '[data-training="notes-button"]', 'top', 'click', false),
((SELECT id FROM public.training_guides WHERE slug = 'working-with-rooms'), 8, 'complete_room', '[data-training="complete-room-button"]', 'top', 'hold', false);

-- Insert training steps for Breaks & Sign-out
INSERT INTO public.training_guide_steps (guide_id, step_order, step_key, target_selector, position, action_type, requires_action) VALUES
((SELECT id FROM public.training_guides WHERE slug = 'breaks-and-signout'), 1, 'request_break', '[data-training="break-button"]', 'bottom', 'click', false),
((SELECT id FROM public.training_guides WHERE slug = 'breaks-and-signout'), 2, 'select_break_type', '[data-training="break-type-selector"]', 'bottom', 'click', false),
((SELECT id FROM public.training_guides WHERE slug = 'breaks-and-signout'), 3, 'end_break', '[data-training="end-break-button"]', 'bottom', 'swipe', false),
((SELECT id FROM public.training_guides WHERE slug = 'breaks-and-signout'), 4, 'sign_out', '[data-training="sign-out-button"]', 'bottom', 'click', false);

-- Insert training steps for Special Situations
INSERT INTO public.training_guide_steps (guide_id, step_order, step_key, target_selector, position, action_type, requires_action) VALUES
((SELECT id FROM public.training_guides WHERE slug = 'special-situations'), 1, 'retrieve_dnd', '[data-training="dnd-rooms-tab"]', 'bottom', 'click', false),
((SELECT id FROM public.training_guides WHERE slug = 'special-situations'), 2, 'priority_rooms', '[data-training="priority-badge"]', 'bottom', 'info', false),
((SELECT id FROM public.training_guides WHERE slug = 'special-situations'), 3, 'checkout_daily', '[data-training="room-type-badge"]', 'bottom', 'info', false),
((SELECT id FROM public.training_guides WHERE slug = 'special-situations'), 4, 'completed_tasks', '[data-training="completed-tab"]', 'bottom', 'click', false),
((SELECT id FROM public.training_guides WHERE slug = 'special-situations'), 5, 'contact_supervisor', '[data-training="help-button"]', 'bottom', 'click', false);