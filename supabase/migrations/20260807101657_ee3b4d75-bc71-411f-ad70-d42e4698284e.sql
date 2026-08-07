-- 1. Supervisor role (value only; not referenced elsewhere in this migration)
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'supervisor';

-- 2. Venues: physical address / building grouping under a property
CREATE TABLE public.venues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL,
  organization_slug text NOT NULL,
  name text NOT NULL,
  address text,
  notes text,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.venues TO authenticated;
GRANT ALL ON public.venues TO service_role;

ALTER TABLE public.venues ENABLE ROW LEVEL SECURITY;

CREATE POLICY "venues_select_same_org" ON public.venues
FOR SELECT TO authenticated
USING (organization_slug = public.get_user_organization_slug(auth.uid()) OR public.is_super_admin(auth.uid()));

CREATE POLICY "venues_manage_admin_manager" ON public.venues
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

CREATE TRIGGER update_venues_updated_at
BEFORE UPDATE ON public.venues
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_venues_hotel ON public.venues (hotel_id);
CREATE INDEX idx_venues_org ON public.venues (organization_slug);

-- 3. Optional venue link on units. NULL for every existing row -> no behaviour change.
ALTER TABLE public.rooms
  ADD COLUMN venue_id uuid REFERENCES public.venues(id) ON DELETE SET NULL;

CREATE INDEX idx_rooms_venue ON public.rooms (venue_id);

-- 4. Per-user venue scopes (many-to-many)
CREATE TABLE public.user_property_scopes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  venue_id uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  organization_slug text NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, venue_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_property_scopes TO authenticated;
GRANT ALL ON public.user_property_scopes TO service_role;

ALTER TABLE public.user_property_scopes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ups_select_self_or_manager" ON public.user_property_scopes
FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR public.is_super_admin(auth.uid())
  OR (
    organization_slug = public.get_user_organization_slug(auth.uid())
    AND public.get_user_role(auth.uid()) = ANY (ARRAY['admin','manager','housekeeping_manager','top_management','top_management_manager']::user_role[])
  )
);

CREATE POLICY "ups_manage_admin_manager" ON public.user_property_scopes
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

CREATE TRIGGER update_user_property_scopes_updated_at
BEFORE UPDATE ON public.user_property_scopes
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_ups_user ON public.user_property_scopes (user_id);
CREATE INDEX idx_ups_venue ON public.user_property_scopes (venue_id);

-- 5. Scope helpers (security definer, no recursion into RLS-protected tables)
CREATE OR REPLACE FUNCTION public.user_has_venue_scopes(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_property_scopes WHERE user_id = _user_id)
$$;

CREATE OR REPLACE FUNCTION public.has_venue_access(_user_id uuid, _venue_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    -- Unscoped units stay visible to everyone who could already see them
    _venue_id IS NULL
    -- Users without any explicit scope keep their current (unrestricted) view
    OR NOT EXISTS (SELECT 1 FROM public.user_property_scopes WHERE user_id = _user_id)
    OR EXISTS (
      SELECT 1 FROM public.user_property_scopes
      WHERE user_id = _user_id AND venue_id = _venue_id
    )
$$;

-- 6. Merged multi-account PMS portfolio: one property, several Previo accounts
CREATE TABLE public.pms_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL,
  organization_slug text NOT NULL,
  label text NOT NULL,
  pms_type text NOT NULL DEFAULT 'previo',
  pms_hotel_id text,
  credentials_secret_name text,
  api_base_url text,
  is_active boolean NOT NULL DEFAULT true,
  is_primary boolean NOT NULL DEFAULT false,
  last_sync_at timestamptz,
  last_sync_status text,
  last_sync_error text,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, label)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pms_accounts TO authenticated;
GRANT ALL ON public.pms_accounts TO service_role;

ALTER TABLE public.pms_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pms_accounts_select_same_org" ON public.pms_accounts
FOR SELECT TO authenticated
USING (organization_slug = public.get_user_organization_slug(auth.uid()) OR public.is_super_admin(auth.uid()));

CREATE POLICY "pms_accounts_manage_admin" ON public.pms_accounts
FOR ALL TO authenticated
USING (
  public.is_super_admin(auth.uid())
  OR (
    organization_slug = public.get_user_organization_slug(auth.uid())
    AND public.get_user_role(auth.uid()) = ANY (ARRAY['admin','manager','top_management','top_management_manager']::user_role[])
  )
)
WITH CHECK (
  public.is_super_admin(auth.uid())
  OR (
    organization_slug = public.get_user_organization_slug(auth.uid())
    AND public.get_user_role(auth.uid()) = ANY (ARRAY['admin','manager','top_management','top_management_manager']::user_role[])
  )
);

CREATE TRIGGER update_pms_accounts_updated_at
BEFORE UPDATE ON public.pms_accounts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_pms_accounts_hotel ON public.pms_accounts (hotel_id);

-- 7. Venue scoping enforcement, restricted to the SLNT organization only.
--    For every other organization the predicate short-circuits to TRUE, so
--    RD Hotels / Ottofiori row visibility is provably unchanged.
CREATE POLICY "rooms_slnt_venue_scope" ON public.rooms
AS RESTRICTIVE
FOR SELECT TO authenticated
USING (
  coalesce(organization_slug, '') <> 'slnt'
  OR public.is_super_admin(auth.uid())
  OR public.get_user_role(auth.uid()) = ANY (ARRAY['admin','top_management','top_management_manager','manager','housekeeping_manager']::user_role[])
  OR public.has_venue_access(auth.uid(), venue_id)
);