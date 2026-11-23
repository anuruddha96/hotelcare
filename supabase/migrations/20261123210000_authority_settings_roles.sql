CREATE POLICY authority_settings_role ON public.ntak_settings
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()) OR public.get_user_role(auth.uid())::text IN ('admin', 'top_management', 'top_management_manager'));

CREATE POLICY authority_settings_role ON public.viza_settings
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()) OR public.get_user_role(auth.uid())::text IN ('admin', 'top_management', 'top_management_manager'));

-- Diagnostic history and failed-event details are leadership-only even when
-- queried through PostgREST rather than the reports UI. The existing
-- hotel-scoped permissive policies still apply; service-role workers bypass RLS.
CREATE POLICY authority_reporting_role ON public.ntak_messages
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()) OR public.get_user_role(auth.uid())::text IN ('admin', 'top_management', 'top_management_manager'));

CREATE POLICY authority_reporting_role ON public.ntak_daily_closures
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()) OR public.get_user_role(auth.uid())::text IN ('admin', 'top_management', 'top_management_manager'));

CREATE POLICY authority_reporting_role ON public.ntak_booking_queue
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()) OR public.get_user_role(auth.uid())::text IN ('admin', 'top_management', 'top_management_manager'));

CREATE POLICY authority_reporting_role ON public.ntak_event_queue
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()) OR public.get_user_role(auth.uid())::text IN ('admin', 'top_management', 'top_management_manager'));

CREATE POLICY authority_reporting_role ON public.viza_guest_events
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()) OR public.get_user_role(auth.uid())::text IN ('admin', 'top_management', 'top_management_manager'));
