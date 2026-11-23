-- Disposable CI only. Uses actual Phase 3 policy/function definitions and a minimal fixture;
-- replace fixture with Claude's schema-only production snapshot when supplied.
CREATE OR REPLACE FUNCTION public.pms_ntak_guest_scope(
  _reservation_id uuid,_room_id uuid DEFAULT NULL
) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.reservations%ROWTYPE; cfg public.ntak_settings%ROWTYPE;
  room_to_check uuid;
BEGIN
  SELECT * INTO r FROM public.reservations WHERE id=_reservation_id;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO cfg FROM public.ntak_settings WHERE hotel_id=r.hotel_id AND enabled;
  IF NOT FOUND THEN RETURN false; END IF;
  IF cfg.unit_scope<>'profiled_only' THEN RETURN true; END IF;
  room_to_check:=COALESCE(_room_id,r.room_id);
  IF room_to_check IS NOT NULL THEN
    RETURN EXISTS(SELECT 1 FROM public.ntak_unit_profiles p
      WHERE p.hotel_id=r.hotel_id AND p.room_id=room_to_check AND p.active);
  END IF;
  RETURN r.room_type_id IS NOT NULL AND EXISTS(
    SELECT 1 FROM public.ntak_room_type_units t
    WHERE t.hotel_id=r.hotel_id AND t.room_type_id=r.room_type_id AND t.active);
END;
$$;
REVOKE ALL ON FUNCTION public.pms_ntak_guest_scope(uuid,uuid) FROM PUBLIC,anon,authenticated;
ALTER TABLE public.reservation_guests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "PMS staff manage stay guests" ON public.reservation_guests;
DROP POLICY IF EXISTS "PMS staff view stay guests" ON public.reservation_guests;
DROP POLICY IF EXISTS "Legacy PMS staff insert stay guests" ON public.reservation_guests;
DROP POLICY IF EXISTS "Legacy PMS staff update stay guests" ON public.reservation_guests;
DROP POLICY IF EXISTS "Legacy PMS staff delete stay guests" ON public.reservation_guests;
CREATE POLICY "PMS staff view stay guests"
ON public.reservation_guests FOR SELECT TO authenticated USING (
  public.has_pms_access(auth.uid()) AND public.can_access_reservation(auth.uid(),reservation_id)
);
CREATE POLICY "Legacy PMS staff insert stay guests"
ON public.reservation_guests FOR INSERT TO authenticated WITH CHECK (
  public.has_pms_access(auth.uid()) AND public.can_access_reservation(auth.uid(),reservation_id)
  AND NOT EXISTS(
    SELECT 1 FROM public.ntak_settings cfg JOIN public.reservations r ON r.id=reservation_id
    WHERE cfg.hotel_id=r.hotel_id AND cfg.enabled AND (
      cfg.unit_scope <> 'profiled_only'
      OR (r.room_id IS NOT NULL AND EXISTS(
        SELECT 1 FROM public.ntak_unit_profiles p
        WHERE p.hotel_id=r.hotel_id AND p.room_id=r.room_id AND p.active))
      OR (r.room_id IS NULL AND r.room_type_id IS NOT NULL AND EXISTS(
        SELECT 1 FROM public.ntak_room_type_units t
        WHERE t.hotel_id=r.hotel_id AND t.room_type_id=r.room_type_id AND t.active))
    ))
);
CREATE POLICY "Legacy PMS staff update stay guests"
ON public.reservation_guests FOR UPDATE TO authenticated USING (
  public.has_pms_access(auth.uid()) AND public.can_access_reservation(auth.uid(),reservation_id)
  AND NOT EXISTS(
    SELECT 1 FROM public.ntak_settings cfg JOIN public.reservations r ON r.id=reservation_id
    WHERE cfg.hotel_id=r.hotel_id AND cfg.enabled AND (
      cfg.unit_scope <> 'profiled_only'
      OR (r.room_id IS NOT NULL AND EXISTS(
        SELECT 1 FROM public.ntak_unit_profiles p
        WHERE p.hotel_id=r.hotel_id AND p.room_id=r.room_id AND p.active))
      OR (r.room_id IS NULL AND r.room_type_id IS NOT NULL AND EXISTS(
        SELECT 1 FROM public.ntak_room_type_units t
        WHERE t.hotel_id=r.hotel_id AND t.room_type_id=r.room_type_id AND t.active))
    ))
) WITH CHECK (
  public.has_pms_access(auth.uid()) AND public.can_access_reservation(auth.uid(),reservation_id)
  AND NOT EXISTS(
    SELECT 1 FROM public.ntak_settings cfg JOIN public.reservations r ON r.id=reservation_id
    WHERE cfg.hotel_id=r.hotel_id AND cfg.enabled AND (
      cfg.unit_scope <> 'profiled_only'
      OR (r.room_id IS NOT NULL AND EXISTS(
        SELECT 1 FROM public.ntak_unit_profiles p
        WHERE p.hotel_id=r.hotel_id AND p.room_id=r.room_id AND p.active))
      OR (r.room_id IS NULL AND r.room_type_id IS NOT NULL AND EXISTS(
        SELECT 1 FROM public.ntak_room_type_units t
        WHERE t.hotel_id=r.hotel_id AND t.room_type_id=r.room_type_id AND t.active))
    ))
);
CREATE POLICY "Legacy PMS staff delete stay guests"
ON public.reservation_guests FOR DELETE TO authenticated USING (
  public.has_pms_access(auth.uid()) AND public.can_access_reservation(auth.uid(),reservation_id)
  AND NOT EXISTS(
    SELECT 1 FROM public.ntak_settings cfg JOIN public.reservations r ON r.id=reservation_id
    WHERE cfg.hotel_id=r.hotel_id AND cfg.enabled AND (
      cfg.unit_scope <> 'profiled_only'
      OR (r.room_id IS NOT NULL AND EXISTS(
        SELECT 1 FROM public.ntak_unit_profiles p
        WHERE p.hotel_id=r.hotel_id AND p.room_id=r.room_id AND p.active))
      OR (r.room_id IS NULL AND r.room_type_id IS NOT NULL AND EXISTS(
        SELECT 1 FROM public.ntak_room_type_units t
        WHERE t.hotel_id=r.hotel_id AND t.room_type_id=r.room_type_id AND t.active))
    ))
);
GRANT SELECT,INSERT,UPDATE,DELETE ON public.reservation_guests TO authenticated;
ALTER TABLE public.ntak_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY fixture_settings_visible ON public.ntak_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY fixture_authority_restriction ON public.ntak_settings AS RESTRICTIVE FOR SELECT TO authenticated USING (false);
INSERT INTO public.profiles(id,role,organization_slug) VALUES('00000000-0000-4000-8000-000000000081','reception','fixture');
INSERT INTO public.hotel_access VALUES ('00000000-0000-4000-8000-000000000081','enabled'),('00000000-0000-4000-8000-000000000081','disabled');
INSERT INTO public.ntak_settings(hotel_id,organization_slug,enabled) VALUES('enabled','fixture',true),('disabled','fixture',false);
INSERT INTO public.guests(id,first_name,last_name,hotel_id) VALUES
('00000000-0000-4000-8000-000000000082','Test','Guest','enabled'),
('00000000-0000-4000-8000-000000000083','Test','Companion','enabled');
INSERT INTO public.reservations(id,hotel_id,organization_slug,check_in_date,check_out_date) VALUES
('00000000-0000-4000-8000-000000000084','enabled','fixture',current_date,current_date+1),
('00000000-0000-4000-8000-000000000085','disabled','fixture',current_date,current_date+1);
INSERT INTO public.reservation_guests(reservation_id,guest_id) VALUES ('00000000-0000-4000-8000-000000000084','00000000-0000-4000-8000-000000000082');
\ir ../migrations/20261124010100_ntak_authority_guest_rls.sql
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000081',false);
SET ROLE authenticated;
DO $$
DECLARE affected int;
BEGIN
 IF EXISTS(SELECT 1 FROM public.ntak_settings) THEN RAISE EXCEPTION 'settings leaked'; END IF;
 BEGIN
 INSERT INTO public.reservation_guests(reservation_id,guest_id) VALUES ('00000000-0000-4000-8000-000000000084','00000000-0000-4000-8000-000000000083');
 RAISE EXCEPTION 'Direct insert on scoped booking allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 UPDATE public.reservation_guests SET is_primary=true WHERE reservation_id='00000000-0000-4000-8000-000000000084';
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected<>0 THEN RAISE EXCEPTION 'Direct update on scoped booking allowed'; END IF;
 DELETE FROM public.reservation_guests WHERE reservation_id='00000000-0000-4000-8000-000000000084';
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected<>0 THEN RAISE EXCEPTION 'Direct delete on scoped booking allowed'; END IF;
 INSERT INTO public.reservation_guests(reservation_id,guest_id) VALUES ('00000000-0000-4000-8000-000000000085','00000000-0000-4000-8000-000000000083');
 UPDATE public.reservation_guests SET is_primary=true WHERE reservation_id='00000000-0000-4000-8000-000000000085';
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected<>1 THEN RAISE EXCEPTION 'Non-NTAK update unexpectedly blocked'; END IF;
 DELETE FROM public.reservation_guests WHERE reservation_id='00000000-0000-4000-8000-000000000085';
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected<>1 THEN RAISE EXCEPTION 'Non-NTAK delete unexpectedly blocked'; END IF;
END $$;
RESET ROLE;
