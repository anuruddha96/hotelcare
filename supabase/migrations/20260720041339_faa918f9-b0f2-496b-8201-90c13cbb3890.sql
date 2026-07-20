
CREATE TABLE IF NOT EXISTS public.hotel_autoassign_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL UNIQUE,
  organization_slug text,
  floor_grouping_weight numeric NOT NULL DEFAULT 1.0,
  room_size_weight numeric NOT NULL DEFAULT 1.0,
  checkout_distribution_weight numeric NOT NULL DEFAULT 2.0,
  daily_count_weight numeric NOT NULL DEFAULT 1.0,
  rtc_priority_weight numeric NOT NULL DEFAULT 1.5,
  max_rooms_per_hk integer,
  checkout_first boolean NOT NULL DEFAULT true,
  learned_hints jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hotel_autoassign_profiles TO authenticated;
GRANT ALL ON public.hotel_autoassign_profiles TO service_role;

ALTER TABLE public.hotel_autoassign_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view autoassign profiles in their org"
  ON public.hotel_autoassign_profiles
  FOR SELECT
  TO authenticated
  USING (
    organization_slug IS NULL
    OR organization_slug IN (
      SELECT organization_slug FROM public.profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "Admins and managers can insert autoassign profiles"
  ON public.hotel_autoassign_profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin','top_management','manager','housekeeping_manager')
        AND (p.organization_slug = hotel_autoassign_profiles.organization_slug OR p.role = 'admin')
    )
  );

CREATE POLICY "Admins and managers can update autoassign profiles"
  ON public.hotel_autoassign_profiles
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin','top_management','manager','housekeeping_manager')
        AND (p.organization_slug = hotel_autoassign_profiles.organization_slug OR p.role = 'admin')
    )
  );

CREATE OR REPLACE FUNCTION public.update_hotel_autoassign_profiles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_hotel_autoassign_profiles_updated_at ON public.hotel_autoassign_profiles;
CREATE TRIGGER trg_hotel_autoassign_profiles_updated_at
  BEFORE UPDATE ON public.hotel_autoassign_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_hotel_autoassign_profiles_updated_at();
