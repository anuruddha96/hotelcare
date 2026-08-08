-- 1. Purchase invoice line items / VAT lines: enforce the parent invoice's organization.
DROP POLICY IF EXISTS pi_items_all ON public.purchase_invoice_items;
CREATE POLICY pi_items_all ON public.purchase_invoice_items
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.purchase_invoices i
    WHERE i.id = purchase_invoice_items.invoice_id
      AND (public.pi_user_role() = 'admin' OR i.organization_slug = public.pi_user_org())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.purchase_invoices i
    WHERE i.id = purchase_invoice_items.invoice_id
      AND (public.pi_user_role() = 'admin' OR i.organization_slug = public.pi_user_org())
  ));

DROP POLICY IF EXISTS pi_vat_all ON public.purchase_invoice_vat_lines;
CREATE POLICY pi_vat_all ON public.purchase_invoice_vat_lines
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.purchase_invoices i
    WHERE i.id = purchase_invoice_vat_lines.invoice_id
      AND (public.pi_user_role() = 'admin' OR i.organization_slug = public.pi_user_org())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.purchase_invoices i
    WHERE i.id = purchase_invoice_vat_lines.invoice_id
      AND (public.pi_user_role() = 'admin' OR i.organization_slug = public.pi_user_org())
  ));

-- 2. Staff attendance: own record AND own organization, with a WITH CHECK so a row
--    cannot be moved to another tenant or another user.
DROP POLICY IF EXISTS "Users can update their own attendance" ON public.staff_attendance;
CREATE POLICY "Users can update their own attendance" ON public.staff_attendance
  FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    AND (organization_slug IS NULL OR organization_slug = public.get_user_organization_slug(auth.uid()))
  )
  WITH CHECK (
    user_id = auth.uid()
    AND (organization_slug IS NULL OR organization_slug = public.get_user_organization_slug(auth.uid()))
  );

-- 3. Minibar usage: restrict updates to operational staff roles, still tenant-scoped.
DROP POLICY IF EXISTS "Staff update minibar usage in own organization" ON public.room_minibar_usage;
CREATE POLICY "Staff update minibar usage in own organization" ON public.room_minibar_usage
  FOR UPDATE TO authenticated
  USING (
    organization_slug = public.get_user_organization_slug(auth.uid())
    AND public.get_user_role(auth.uid()) = ANY (ARRAY[
      'admin','top_management','top_management_manager','manager',
      'housekeeping_manager','housekeeping','supervisor','reception','reception_manager',
      'maintenance','maintenance_manager','front_office','control_finance'
    ]::user_role[])
  )
  WITH CHECK (
    organization_slug = public.get_user_organization_slug(auth.uid())
    AND public.get_user_role(auth.uid()) = ANY (ARRAY[
      'admin','top_management','top_management_manager','manager',
      'housekeeping_manager','housekeeping','supervisor','reception','reception_manager',
      'maintenance','maintenance_manager','front_office','control_finance'
    ]::user_role[])
  );

-- 4. Profiles: managers may only assign an explicit allow-list of operational roles.
--    Elevated roles (admin, hr, top_management*, control_finance, manager tiers) stay admin-only.
CREATE OR REPLACE FUNCTION public.manager_assignable_role(_role user_role)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT _role = ANY (ARRAY[
    'housekeeping','supervisor','maintenance','reception','front_office','marketing'
  ]::user_role[]);
$$;

REVOKE ALL ON FUNCTION public.manager_assignable_role(user_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manager_assignable_role(user_role) TO authenticated, service_role;

DROP POLICY IF EXISTS profiles_insert_authorized ON public.profiles;
CREATE POLICY profiles_insert_authorized ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (
    public.get_current_user_role() = 'admin'::user_role
    OR (
      public.get_current_user_role() = ANY (ARRAY['housekeeping_manager','manager']::user_role[])
      AND NOT (organization_slug IS DISTINCT FROM public.get_user_organization_slug(auth.uid()))
      AND public.manager_assignable_role(role)
    )
  );

DROP POLICY IF EXISTS profiles_update_authorized ON public.profiles;
CREATE POLICY profiles_update_authorized ON public.profiles
  FOR UPDATE TO authenticated
  USING (
    public.get_current_user_role() = 'admin'::user_role
    OR (
      public.get_current_user_role() = ANY (ARRAY['housekeeping_manager','manager']::user_role[])
      AND NOT (organization_slug IS DISTINCT FROM public.get_user_organization_slug(auth.uid()))
      AND public.manager_assignable_role(role)
    )
  )
  WITH CHECK (
    public.get_current_user_role() = 'admin'::user_role
    OR (
      public.get_current_user_role() = ANY (ARRAY['housekeeping_manager','manager']::user_role[])
      AND NOT (organization_slug IS DISTINCT FROM public.get_user_organization_slug(auth.uid()))
      AND public.manager_assignable_role(role)
    )
  );

-- 5. Guest recommendations: public read stays (guest QR pages) but is now explicitly
--    scoped to the anon/authenticated roles and active rows only.
DROP POLICY IF EXISTS "Anyone can view active recommendations" ON public.guest_recommendations;
CREATE POLICY "Guest pages can view active recommendations" ON public.guest_recommendations
  FOR SELECT TO anon, authenticated
  USING (is_active = true);