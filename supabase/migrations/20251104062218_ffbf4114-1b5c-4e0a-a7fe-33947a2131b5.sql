-- Create PMS Configuration table for hotel and room mapping
CREATE TABLE IF NOT EXISTS public.pms_configurations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  hotel_id TEXT NOT NULL REFERENCES public.hotel_configurations(hotel_id) ON DELETE CASCADE,
  pms_type TEXT NOT NULL DEFAULT 'previo', -- previo, opera, etc
  pms_hotel_id TEXT NOT NULL, -- The hotel ID in the PMS system (e.g., '788619' for Previo)
  is_active BOOLEAN NOT NULL DEFAULT true,
  sync_enabled BOOLEAN NOT NULL DEFAULT true,
  last_sync_at TIMESTAMPTZ,
  settings JSONB DEFAULT '{}', -- Additional PMS-specific settings
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(hotel_id, pms_type)
);

-- Create PMS Room Mapping table to map Previo room types to HotelCare rooms
CREATE TABLE IF NOT EXISTS public.pms_room_mappings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  pms_config_id UUID NOT NULL REFERENCES public.pms_configurations(id) ON DELETE CASCADE,
  hotelcare_room_number TEXT NOT NULL, -- Room number in HotelCare (e.g., '101', '102')
  pms_room_id TEXT NOT NULL, -- Room ID in PMS system (e.g., '984673' for Previo room type)
  pms_room_name TEXT, -- Room name in PMS (e.g., 'Egyágyas szoba Deluxe')
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pms_config_id, hotelcare_room_number)
);

-- Enable RLS
ALTER TABLE public.pms_configurations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pms_room_mappings ENABLE ROW LEVEL SECURITY;

-- RLS Policies for pms_configurations
CREATE POLICY "Admins can view all PMS configurations"
  ON public.pms_configurations FOR SELECT
  USING (public.get_user_role(auth.uid()) = 'admin'::public.user_role);

CREATE POLICY "Admins can insert PMS configurations"
  ON public.pms_configurations FOR INSERT
  WITH CHECK (public.get_user_role(auth.uid()) = 'admin'::public.user_role);

CREATE POLICY "Admins can update PMS configurations"
  ON public.pms_configurations FOR UPDATE
  USING (public.get_user_role(auth.uid()) = 'admin'::public.user_role);

CREATE POLICY "Admins can delete PMS configurations"
  ON public.pms_configurations FOR DELETE
  USING (public.get_user_role(auth.uid()) = 'admin'::public.user_role);

-- RLS Policies for pms_room_mappings
CREATE POLICY "Admins can view all PMS room mappings"
  ON public.pms_room_mappings FOR SELECT
  USING (public.get_user_role(auth.uid()) = 'admin'::public.user_role);

CREATE POLICY "Admins can insert PMS room mappings"
  ON public.pms_room_mappings FOR INSERT
  WITH CHECK (public.get_user_role(auth.uid()) = 'admin'::public.user_role);

CREATE POLICY "Admins can update PMS room mappings"
  ON public.pms_room_mappings FOR UPDATE
  USING (public.get_user_role(auth.uid()) = 'admin'::public.user_role);

CREATE POLICY "Admins can delete PMS room mappings"
  ON public.pms_room_mappings FOR DELETE
  USING (public.get_user_role(auth.uid()) = 'admin'::public.user_role);

-- Add index for faster lookups
CREATE INDEX idx_pms_configurations_hotel_id ON public.pms_configurations(hotel_id);
CREATE INDEX idx_pms_room_mappings_config_id ON public.pms_room_mappings(pms_config_id);
CREATE INDEX idx_pms_room_mappings_room_number ON public.pms_room_mappings(hotelcare_room_number);