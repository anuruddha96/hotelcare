-- National IFA status enumeration, NTAK v9.07 §§9.2.17, 10.2.26; v9.09 HUN §9.2.17.
-- Preserve existing scope/permission checks, NULL (automatic age) reset, and correction triggers.
-- Municipality-specific categories are out of scope; do not rewrite legacy rows.
CREATE OR REPLACE FUNCTION public.pms_set_guest_ifa_status(_reservation_id uuid,_guest_id uuid,_status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.reservations%ROWTYPE;
BEGIN
 SELECT * INTO r FROM public.reservations WHERE id=_reservation_id FOR UPDATE;
 IF NOT FOUND OR auth.uid() IS NULL OR NOT public.can_access_pms_hotel(auth.uid(),r.hotel_id,r.organization_slug) THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 IF NOT public.pms_ntak_guest_scope(r.id,r.room_id) THEN RAISE EXCEPTION 'NTAK_NOT_ENABLED'; END IF;
 IF _status IS NOT NULL AND _status NOT IN ('KOTELES','im1','im2','im3','im4','im5','im6','im8','im9','im10') THEN RAISE EXCEPTION 'IFA_EXEMPTION_UNVERIFIED'; END IF;
 UPDATE public.reservation_guests SET ifa_status=_status WHERE reservation_id=_reservation_id AND guest_id=_guest_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'GUEST_NOT_FOUND'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.pms_set_guest_ifa_status(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pms_set_guest_ifa_status(uuid,uuid,text) TO authenticated;
