-- Track dirty linen collected from public wellness/fitness areas separately
-- from guest-room linen. Keeping this separate avoids weakening the existing
-- room-based foreign keys, uniqueness rules, and RLS on dirty_linen_counts.

CREATE TABLE IF NOT EXISTS public.dirty_linen_public_area_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  housekeeper_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  task_id uuid REFERENCES public.general_tasks(id) ON DELETE SET NULL,
  area_type text NOT NULL CHECK (area_type IN ('gym', 'sauna', 'jacuzzi')),
  hotel text NOT NULL,
  linen_item_id uuid NOT NULL REFERENCES public.dirty_linen_items(id) ON DELETE RESTRICT,
  count integer NOT NULL DEFAULT 0 CHECK (count >= 0),
  work_date date NOT NULL DEFAULT CURRENT_DATE,
  organization_slug text DEFAULT pi_user_org(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dirty_linen_public_area_counts_unique
    UNIQUE (housekeeper_id, hotel, area_type, linen_item_id, work_date)
);

CREATE INDEX IF NOT EXISTS idx_dirty_linen_public_area_date
  ON public.dirty_linen_public_area_counts(work_date);
CREATE INDEX IF NOT EXISTS idx_dirty_linen_public_area_hotel
  ON public.dirty_linen_public_area_counts(hotel, work_date);
CREATE INDEX IF NOT EXISTS idx_dirty_linen_public_area_housekeeper
  ON public.dirty_linen_public_area_counts(housekeeper_id, work_date);

ALTER TABLE public.dirty_linen_public_area_counts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public area linen self select" ON public.dirty_linen_public_area_counts;
CREATE POLICY "Public area linen self select"
ON public.dirty_linen_public_area_counts
FOR SELECT
USING (
  housekeeper_id = auth.uid()
  OR is_super_admin(auth.uid())
  OR (
    get_user_role(auth.uid()) = ANY (ARRAY[
      'manager'::user_role,
      'housekeeping_manager'::user_role,
      'admin'::user_role
    ])
    AND (
      hotel = get_user_assigned_hotel(auth.uid())
      OR hotel = (
        SELECT hc.hotel_name
        FROM public.hotel_configurations hc
        WHERE hc.hotel_id = get_user_assigned_hotel(auth.uid())
        LIMIT 1
      )
    )
  )
  OR (
    is_top_management(auth.uid())
    AND (organization_slug IS NULL OR organization_slug = get_user_organization_slug(auth.uid()))
  )
);

DROP POLICY IF EXISTS "Public area linen self insert" ON public.dirty_linen_public_area_counts;
CREATE POLICY "Public area linen self insert"
ON public.dirty_linen_public_area_counts
FOR INSERT
WITH CHECK (
  housekeeper_id = auth.uid()
  AND (organization_slug IS NULL OR organization_slug = get_user_organization_slug(auth.uid()))
);

DROP POLICY IF EXISTS "Public area linen self update" ON public.dirty_linen_public_area_counts;
CREATE POLICY "Public area linen self update"
ON public.dirty_linen_public_area_counts
FOR UPDATE
USING (housekeeper_id = auth.uid())
WITH CHECK (
  housekeeper_id = auth.uid()
  AND (organization_slug IS NULL OR organization_slug = get_user_organization_slug(auth.uid()))
);

DROP POLICY IF EXISTS "Public area linen self delete" ON public.dirty_linen_public_area_counts;
CREATE POLICY "Public area linen self delete"
ON public.dirty_linen_public_area_counts
FOR DELETE
USING (housekeeper_id = auth.uid());

-- Make manager reporting update immediately when a housekeeper taps +/-.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'dirty_linen_public_area_counts'
  ) THEN
    ALTER PUBLICATION supabase_realtime
      ADD TABLE public.dirty_linen_public_area_counts;
  END IF;
END $$;
