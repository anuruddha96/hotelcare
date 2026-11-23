-- Preserve Phase 3's guest lifecycle boundary after authority settings become leadership-only.
-- Apply after Phase 3 and before opening reporting; do not grant settings SELECT.
CREATE OR REPLACE FUNCTION public.pms_reservation_is_ntak_scoped(_reservation_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  -- Fail closed for callers who cannot access the reservation; no cross-tenant oracle.
  IF auth.uid() IS NULL OR NOT COALESCE(public.has_pms_access(auth.uid()),false)
    OR NOT COALESCE(public.can_access_reservation(auth.uid(),_reservation_id),false)
  THEN RETURN true; END IF;
  RETURN public.pms_ntak_guest_scope(_reservation_id);
END;
$$;
REVOKE ALL ON FUNCTION public.pms_reservation_is_ntak_scoped(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.pms_reservation_is_ntak_scoped(uuid) TO authenticated;
ALTER POLICY "Legacy PMS staff insert stay guests" ON public.reservation_guests WITH CHECK (public.has_pms_access(auth.uid()) AND public.can_access_reservation(auth.uid(),reservation_id) AND NOT public.pms_reservation_is_ntak_scoped(reservation_id));
ALTER POLICY "Legacy PMS staff update stay guests" ON public.reservation_guests USING (public.has_pms_access(auth.uid()) AND public.can_access_reservation(auth.uid(),reservation_id) AND NOT public.pms_reservation_is_ntak_scoped(reservation_id)) WITH CHECK (public.has_pms_access(auth.uid()) AND public.can_access_reservation(auth.uid(),reservation_id) AND NOT public.pms_reservation_is_ntak_scoped(reservation_id));
ALTER POLICY "Legacy PMS staff delete stay guests" ON public.reservation_guests USING (public.has_pms_access(auth.uid()) AND public.can_access_reservation(auth.uid(),reservation_id) AND NOT public.pms_reservation_is_ntak_scoped(reservation_id));
