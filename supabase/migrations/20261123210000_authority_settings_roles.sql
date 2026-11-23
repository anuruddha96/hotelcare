CREATE POLICY authority_settings_role ON public.ntak_settings
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()) OR public.get_user_role(auth.uid())::text IN ('admin', 'top_management', 'top_management_manager'));

CREATE POLICY authority_settings_role ON public.viza_settings
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()) OR public.get_user_role(auth.uid())::text IN ('admin', 'top_management', 'top_management_manager'));
