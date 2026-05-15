
-- 1) Mapping table
CREATE TABLE IF NOT EXISTS public.previo_rate_plan_mapping (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL,
  organization_slug text NOT NULL,
  room_type_id uuid NOT NULL REFERENCES public.room_types(id) ON DELETE CASCADE,
  previo_rate_plan_id text,
  previo_room_type_id text,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, room_type_id)
);

CREATE INDEX IF NOT EXISTS idx_prp_mapping_hotel ON public.previo_rate_plan_mapping(hotel_id);

ALTER TABLE public.previo_rate_plan_mapping ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rate_plan_mapping_view"
ON public.previo_rate_plan_mapping
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role IN ('admin', 'top_management')
      AND p.organization_slug = previo_rate_plan_mapping.organization_slug
  )
);

CREATE POLICY "rate_plan_mapping_modify"
ON public.previo_rate_plan_mapping
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role IN ('admin', 'top_management')
      AND p.organization_slug = previo_rate_plan_mapping.organization_slug
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role IN ('admin', 'top_management')
      AND p.organization_slug = previo_rate_plan_mapping.organization_slug
  )
);

CREATE TRIGGER trg_prp_mapping_updated_at
  BEFORE UPDATE ON public.previo_rate_plan_mapping
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) pushed_at column
ALTER TABLE public.rate_recommendations
  ADD COLUMN IF NOT EXISTS pushed_at timestamptz;

-- 3) Allow rate_push in pms_sync_history
ALTER TABLE public.pms_sync_history DROP CONSTRAINT IF EXISTS pms_sync_history_sync_type_check;
ALTER TABLE public.pms_sync_history
  ADD CONSTRAINT pms_sync_history_sync_type_check
  CHECK (sync_type IN ('rooms','reservations','status_update','minibar','room_kinds','rate_push'));
