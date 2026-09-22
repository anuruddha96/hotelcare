-- Read-only post-migration regression. Execute against the HotelCare project;
-- never edit ticket records or leave impersonated auth state in the session.
BEGIN READ ONLY;

SELECT set_config('request.jwt.claim.sub', (
  SELECT id::text FROM public.profiles
  WHERE role::text='top_management_manager' AND organization_slug='rdhotels'
    AND assigned_hotel='memories-budapest' LIMIT 1
), true);
SET LOCAL ROLE authenticated;
DO $test$
DECLARE total integer; viewable_photos integer; others integer;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE public.user_can_view_ticket(id))
    INTO total, viewable_photos FROM public.tickets
    WHERE organization_slug='rdhotels' AND department='maintenance'
      AND hotel IN ('memories-budapest','Hotel Memories Budapest');
  IF total < 6 OR viewable_photos <> total THEN
    RAISE EXCEPTION 'Memories top-management issue/photo visibility: % rows, % photos authorized; expected at least 6 and matching authorization', total, viewable_photos;
  END IF;
  SELECT count(*) INTO others FROM public.tickets
    WHERE department='maintenance'
      AND (organization_slug <> 'rdhotels' OR public.get_hotel_name_from_id(hotel) <> 'Hotel Memories Budapest');
  IF others <> 0 THEN RAISE EXCEPTION 'Memories top-management cross-property/tenant leak: % rows', others; END IF;
END;
$test$;

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', (
  SELECT id::text FROM public.profiles
  WHERE role::text='manager' AND organization_slug='rdhotels'
    AND assigned_hotel='memories-budapest' LIMIT 1
), true);
SET LOCAL ROLE authenticated;
DO $test$
DECLARE total integer; photos integer;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE public.user_can_view_ticket(id))
    INTO total, photos FROM public.tickets
    WHERE organization_slug='rdhotels' AND department='maintenance'
      AND hotel='Hotel Memories Budapest';
  IF total < 6 OR photos <> total THEN RAISE EXCEPTION 'Memories slug manager: % issues, % photo permissions', total, photos; END IF;
END;
$test$;

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', (
  SELECT id::text FROM public.profiles
  WHERE role::text='top_management_manager' AND organization_slug='rdhotels'
    AND assigned_hotel='ottofiori' LIMIT 1
), true);
SET LOCAL ROLE authenticated;
DO $test$
BEGIN
  IF EXISTS (SELECT 1 FROM public.tickets WHERE hotel='Hotel Memories Budapest')
  THEN RAISE EXCEPTION 'Ottofiori top manager can see Memories issues'; END IF;
END;
$test$;

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', (
  SELECT id::text FROM public.profiles
  WHERE role::text='top_management_manager' AND organization_slug='slnt' LIMIT 1
), true);
SET LOCAL ROLE authenticated;
DO $test$
BEGIN
  IF EXISTS (SELECT 1 FROM public.tickets WHERE organization_slug='rdhotels')
  THEN RAISE EXCEPTION 'SLNT top manager can see RD Hotels tickets'; END IF;
END;
$test$;

ROLLBACK;
