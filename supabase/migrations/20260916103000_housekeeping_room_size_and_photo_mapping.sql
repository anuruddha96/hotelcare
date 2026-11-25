-- Additive housekeeping room mapping. Do not infer bed count from guest capacity,
-- override the existing numeric room_size_sqm, or rewrite active assignments.
ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS cleaning_size text,
  ADD COLUMN IF NOT EXISTS verified_bed_count smallint;

ALTER TABLE public.rooms
  ADD CONSTRAINT rooms_cleaning_size_valid
    CHECK (cleaning_size IS NULL OR cleaning_size IN ('small', 'medium', 'large', 'extra_large')),
  ADD CONSTRAINT rooms_verified_bed_count_valid
    CHECK (verified_bed_count IS NULL OR verified_bed_count BETWEEN 1 AND 20);

COMMENT ON COLUMN public.rooms.cleaning_size IS
  'Manager-confirmed housekeeping size; independent of physical size in square metres.';
COMMENT ON COLUMN public.rooms.verified_bed_count IS
  'Manager-confirmed number of actual beds; guest capacity and PMS bed preferences must not be treated as bed count.';

-- Targets belong to ONE configured hotel, never an organization-wide shared key.
-- One row per hotel, room size and cleaning type permits checkout and stayover
-- times to differ without changing existing manually set assignment durations.
CREATE TABLE IF NOT EXISTS public.hotel_cleaning_time_targets (
  hotel_configuration_id uuid NOT NULL REFERENCES public.hotel_configurations(id) ON DELETE CASCADE,
  cleaning_size text NOT NULL CHECK (cleaning_size IN ('small', 'medium', 'large', 'extra_large')),
  assignment_type text NOT NULL CHECK (assignment_type IN ('checkout_cleaning', 'daily_cleaning', 'deep_cleaning')),
  duration_minutes integer NOT NULL CHECK (duration_minutes BETWEEN 1 AND 480),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  PRIMARY KEY (hotel_configuration_id, cleaning_size, assignment_type)
);

ALTER TABLE public.hotel_cleaning_time_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Read cleaning targets inside own organization"
ON public.hotel_cleaning_time_targets FOR SELECT TO authenticated
USING (
  public.is_super_admin(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.hotel_configurations hc
    JOIN public.organizations o ON o.id = hc.organization_id
    WHERE hc.id = hotel_configuration_id
      AND o.slug = public.get_user_organization_slug(auth.uid())
  )
);

CREATE POLICY "Managers set cleaning targets only for authorized hotels"
ON public.hotel_cleaning_time_targets FOR ALL TO authenticated
USING (
  public.is_super_admin(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.hotel_configurations hc
    JOIN public.organizations o ON o.id = hc.organization_id
    JOIN public.profiles p ON p.id = auth.uid() AND p.organization_slug = o.slug
    WHERE hc.id = hotel_configuration_id
      AND p.role::text IN ('admin', 'manager', 'housekeeping_manager', 'top_management', 'top_management_manager')
      AND (
        p.role::text IN ('admin', 'top_management', 'top_management_manager')
        OR p.assigned_hotel IN (hc.hotel_id, hc.hotel_name)
        OR p.hotel_id IN (hc.hotel_id, hc.hotel_name)
      )
  )
)
WITH CHECK (
  public.is_super_admin(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.hotel_configurations hc
    JOIN public.organizations o ON o.id = hc.organization_id
    JOIN public.profiles p ON p.id = auth.uid() AND p.organization_slug = o.slug
    WHERE hc.id = hotel_configuration_id
      AND p.role::text IN ('admin', 'manager', 'housekeeping_manager', 'top_management', 'top_management_manager')
      AND (
        p.role::text IN ('admin', 'top_management', 'top_management_manager')
        OR p.assigned_hotel IN (hc.hotel_id, hc.hotel_name)
        OR p.hotel_id IN (hc.hotel_id, hc.hotel_name)
      )
  )
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hotel_cleaning_time_targets TO authenticated;

-- Seed only the checkout examples. Stayover/deep cleaning targets remain unset
-- until a manager configures them; these examples are editable per hotel.
INSERT INTO public.hotel_cleaning_time_targets
  (hotel_configuration_id, cleaning_size, assignment_type, duration_minutes)
SELECT hc.id, defaults.cleaning_size, 'checkout_cleaning', defaults.minutes
FROM public.hotel_configurations hc
CROSS JOIN (VALUES
  ('small', 45), ('medium', 60), ('large', 90), ('extra_large', 105)
) AS defaults(cleaning_size, minutes)
ON CONFLICT (hotel_configuration_id, cleaning_size, assignment_type) DO NOTHING;

-- Existing room RLS allows housekeepers to update operational room fields.
-- Prevent that broad permission from changing manager-only size/bed mappings.
CREATE OR REPLACE FUNCTION public.protect_housekeeping_room_mapping()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  current_profile public.profiles%ROWTYPE;
  authorized boolean := false;
BEGIN
  IF NEW.cleaning_size IS NOT DISTINCT FROM OLD.cleaning_size
     AND NEW.verified_bed_count IS NOT DISTINCT FROM OLD.verified_bed_count THEN
    RETURN NEW;
  END IF;

  -- Trusted PMS/service updates must leave these columns unchanged; only
  -- authenticated managers may edit the actual room mapping.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authenticated manager required for housekeeping room mapping';
  END IF;
  IF public.is_super_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  SELECT * INTO current_profile FROM public.profiles WHERE id = auth.uid();
  IF current_profile.id IS NULL
     OR current_profile.organization_slug IS DISTINCT FROM NEW.organization_slug
     OR current_profile.role::text NOT IN
        ('admin', 'manager', 'housekeeping_manager', 'top_management', 'top_management_manager') THEN
    RAISE EXCEPTION 'Only a manager in this organization may change room mappings';
  END IF;

  IF current_profile.role::text IN ('admin', 'top_management', 'top_management_manager') THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.hotel_configurations hc
    JOIN public.organizations o ON o.id = hc.organization_id
    WHERE o.slug = NEW.organization_slug
      AND NEW.hotel IN (hc.hotel_id, hc.hotel_name)
      AND (
        current_profile.assigned_hotel IN (hc.hotel_id, hc.hotel_name)
        OR current_profile.hotel_id IN (hc.hotel_id, hc.hotel_name)
      )
  ) INTO authorized;

  IF NOT authorized THEN
    RAISE EXCEPTION 'Manager is not assigned to this hotel';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_housekeeping_room_mapping ON public.rooms;
CREATE TRIGGER trg_protect_housekeeping_room_mapping
BEFORE UPDATE OF cleaning_size, verified_bed_count ON public.rooms
FOR EACH ROW EXECUTE FUNCTION public.protect_housekeeping_room_mapping();

-- Supply a target only for newly created assignments with NO manual estimate.
-- Existing assignments, active timers, manual estimates and maintenance tasks
-- are deliberately untouched. No default size is inferred from guest count.
CREATE OR REPLACE FUNCTION public.set_new_assignment_room_size_duration()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  target_minutes integer;
BEGIN
  IF NEW.estimated_duration IS NOT NULL OR NEW.assignment_type::text NOT IN
    ('checkout_cleaning', 'daily_cleaning', 'deep_cleaning') THEN
    RETURN NEW;
  END IF;

  SELECT t.duration_minutes INTO target_minutes
  FROM public.rooms r
  JOIN public.organizations o ON o.slug = r.organization_slug
  JOIN public.hotel_configurations hc ON hc.organization_id = o.id
    AND r.hotel IN (hc.hotel_id, hc.hotel_name)
  JOIN public.hotel_cleaning_time_targets t
    ON t.hotel_configuration_id = hc.id
    AND t.cleaning_size = r.cleaning_size
    AND t.assignment_type = NEW.assignment_type::text
  WHERE r.id = NEW.room_id
    AND r.organization_slug = NEW.organization_slug
  LIMIT 1;

  IF target_minutes IS NOT NULL THEN
    NEW.estimated_duration := target_minutes;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_new_assignment_room_size_duration ON public.room_assignments;
CREATE TRIGGER trg_set_new_assignment_room_size_duration
BEFORE INSERT ON public.room_assignments
FOR EACH ROW EXECUTE FUNCTION public.set_new_assignment_room_size_duration();
