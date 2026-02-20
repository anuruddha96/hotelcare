
-- Add expiry_days column to minibar_items
ALTER TABLE public.minibar_items ADD COLUMN IF NOT EXISTS expiry_days integer;

-- Create minibar_placements table
CREATE TABLE public.minibar_placements (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  minibar_item_id uuid NOT NULL REFERENCES public.minibar_items(id) ON DELETE CASCADE,
  placed_by uuid NOT NULL,
  placed_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone NOT NULL,
  quantity integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'active',
  collected_by uuid,
  collected_at timestamp with time zone,
  hotel text NOT NULL,
  organization_slug text DEFAULT 'rdhotels',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.minibar_placements ENABLE ROW LEVEL SECURITY;

-- Managers, admins, reception can view all placements
CREATE POLICY "Managers and admins can view placements"
ON public.minibar_placements
FOR SELECT
USING (get_user_role(auth.uid()) = ANY (ARRAY['manager'::user_role, 'housekeeping_manager'::user_role, 'admin'::user_role, 'reception'::user_role]));

-- Housekeepers can view placements for their hotel
CREATE POLICY "Housekeepers can view their hotel placements"
ON public.minibar_placements
FOR SELECT
USING (
  get_user_role(auth.uid()) = 'housekeeping'::user_role
  AND organization_slug = get_user_organization_slug(auth.uid())
);

-- Staff can insert placements
CREATE POLICY "Staff can insert placements"
ON public.minibar_placements
FOR INSERT
WITH CHECK (
  placed_by = auth.uid()
  AND get_user_role(auth.uid()) = ANY (ARRAY['manager'::user_role, 'housekeeping_manager'::user_role, 'admin'::user_role, 'reception'::user_role])
);

-- Staff can update placement status (mark collected)
CREATE POLICY "Staff can update placements"
ON public.minibar_placements
FOR UPDATE
USING (
  get_user_role(auth.uid()) = ANY (ARRAY['housekeeping'::user_role, 'manager'::user_role, 'housekeeping_manager'::user_role, 'admin'::user_role, 'reception'::user_role])
);

-- Managers can delete placements
CREATE POLICY "Managers can delete placements"
ON public.minibar_placements
FOR DELETE
USING (
  get_user_role(auth.uid()) = ANY (ARRAY['manager'::user_role, 'housekeeping_manager'::user_role, 'admin'::user_role])
);

-- Create index for efficient querying
CREATE INDEX idx_minibar_placements_status ON public.minibar_placements(status);
CREATE INDEX idx_minibar_placements_expires ON public.minibar_placements(expires_at);
CREATE INDEX idx_minibar_placements_hotel ON public.minibar_placements(hotel, organization_slug);
