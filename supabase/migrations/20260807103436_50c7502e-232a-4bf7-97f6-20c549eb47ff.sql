CREATE TABLE public.pms_unit_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_slug text NOT NULL,
  hotel_id text NOT NULL,
  pms_account_id uuid REFERENCES public.pms_accounts(id) ON DELETE SET NULL,
  pms_hotel_id text,
  external_type_id text,
  external_room_id text,
  source_name text NOT NULL,
  normalized_name text NOT NULL,
  canonical_room_name text,
  suggested_venue_name text,
  venue_id uuid REFERENCES public.venues(id) ON DELETE SET NULL,
  room_id uuid REFERENCES public.rooms(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'suggested',
  confidence numeric NOT NULL DEFAULT 0.5,
  conflict_reason text,
  review_notes text,
  source_kind text NOT NULL DEFAULT 'manual',
  source_file text,
  source_date date,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pms_unit_mappings TO authenticated;
GRANT ALL ON public.pms_unit_mappings TO service_role;

ALTER TABLE public.pms_unit_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pum_select_same_org" ON public.pms_unit_mappings
FOR SELECT TO authenticated
USING (organization_slug = public.get_user_organization_slug(auth.uid()) OR public.is_super_admin(auth.uid()));

CREATE POLICY "pum_manage_admin_manager" ON public.pms_unit_mappings
FOR ALL TO authenticated
USING (
  public.is_super_admin(auth.uid())
  OR (
    organization_slug = public.get_user_organization_slug(auth.uid())
    AND public.get_user_role(auth.uid()) = ANY (ARRAY['admin','manager','housekeeping_manager','top_management','top_management_manager']::user_role[])
  )
)
WITH CHECK (
  public.is_super_admin(auth.uid())
  OR (
    organization_slug = public.get_user_organization_slug(auth.uid())
    AND public.get_user_role(auth.uid()) = ANY (ARRAY['admin','manager','housekeeping_manager','top_management','top_management_manager']::user_role[])
  )
);

CREATE TRIGGER update_pms_unit_mappings_updated_at
BEFORE UPDATE ON public.pms_unit_mappings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_pum_org ON public.pms_unit_mappings (organization_slug);
CREATE INDEX idx_pum_account ON public.pms_unit_mappings (pms_account_id);
CREATE INDEX idx_pum_status ON public.pms_unit_mappings (status);

-- Idempotency: prefer external ids, fall back to normalized name per account.
CREATE UNIQUE INDEX uq_pum_ext_room
  ON public.pms_unit_mappings (pms_account_id, external_room_id)
  WHERE external_room_id IS NOT NULL;

CREATE UNIQUE INDEX uq_pum_ext_type
  ON public.pms_unit_mappings (pms_account_id, external_type_id)
  WHERE external_room_id IS NULL AND external_type_id IS NOT NULL;

CREATE UNIQUE INDEX uq_pum_name
  ON public.pms_unit_mappings (pms_account_id, normalized_name);

-- Least-privilege venue scoping for SLNT only.
CREATE OR REPLACE FUNCTION public.slnt_venue_visible(_user_id uuid, _venue_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _venue_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.user_property_scopes
    WHERE user_id = _user_id AND venue_id = _venue_id
  )
$$;

DROP POLICY IF EXISTS "rooms_slnt_venue_scope" ON public.rooms;

CREATE POLICY "rooms_slnt_venue_scope" ON public.rooms
AS RESTRICTIVE
FOR SELECT TO authenticated
USING (
  coalesce(organization_slug, '') <> 'slnt'
  OR public.is_super_admin(auth.uid())
  OR public.get_user_role(auth.uid()) = ANY (ARRAY['admin','top_management','top_management_manager','manager','housekeeping_manager']::user_role[])
  OR public.slnt_venue_visible(auth.uid(), venue_id)
);