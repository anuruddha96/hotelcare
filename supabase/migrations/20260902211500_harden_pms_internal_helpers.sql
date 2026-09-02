-- Internal PMS helpers are invoked by SECURITY DEFINER lifecycle functions or
-- service-role integrations. They do not need to be callable directly by a
-- browser session, which would allow cross-property probing by UUID/key.
REVOKE EXECUTE ON FUNCTION public.has_pms_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_pms_access(uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.pms_room_has_conflict(uuid, date, date, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pms_room_has_conflict(uuid, date, date, uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.pms_hotel_room_keys(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pms_hotel_room_keys(text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.pms_recalc_reservation_financials(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pms_recalc_reservation_financials(uuid) TO service_role;

-- PMS folio visibility must always inherit the reservation's hotel scope.
-- Unlinked legacy folios are not part of the reservation/front-desk module and
-- must not become visible portfolio-wide to operational PMS roles.
DROP POLICY IF EXISTS "PMS users can view folios for accessible reservations" ON public.guest_folios;
CREATE POLICY "PMS users can view folios for accessible reservations"
ON public.guest_folios FOR SELECT TO authenticated
USING (
  public.has_pms_access(auth.uid())
  AND reservation_id IS NOT NULL
  AND public.can_access_reservation(auth.uid(), reservation_id)
);
