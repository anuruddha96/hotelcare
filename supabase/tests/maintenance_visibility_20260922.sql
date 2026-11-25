-- Read-only authorization regression for the live hotel-switching workflow.
-- Top Managers are executives of their organization and may select any of its
-- hotels in a browser tab. Ordinary managers remain assigned-hotel restricted.
-- Do not edit tickets, profiles or leave impersonated auth state behind.
BEGIN READ ONLY;

-- An RD Top Manager whose stored default is Ottofiori must be able to read
-- Memories tickets when the browser tab is viewing Memories.
SELECT set_config('request.jwt.claim.sub', (
  SELECT id::text FROM public.profiles
  WHERE role::text = 'top_management_manager' AND organization_slug = 'rdhotels'
    AND assigned_hotel = 'ottofiori' AND deleted_at IS NULL LIMIT 1
), true);
SET LOCAL ROLE authenticated;
DO $test$
DECLARE memories_count integer; photo_count integer; other_property_count integer;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE public.user_can_view_ticket(id))
    INTO memories_count, photo_count
  FROM public.tickets
  WHERE organization_slug = 'rdhotels' AND department = 'maintenance'
    AND hotel IN ('memories-budapest', 'Hotel Memories Budapest');
  IF memories_count < 1 OR photo_count <> memories_count THEN
    RAISE EXCEPTION 'Selected Memories ticket/photo visibility failed for RD Top Manager: % tickets, % photos', memories_count, photo_count;
  END IF;
  SELECT count(*) INTO other_property_count
  FROM public.tickets
  WHERE organization_slug = 'rdhotels' AND department = 'maintenance'
    AND hotel = 'Hotel Ottofiori';
  IF other_property_count < 1 THEN
    RAISE EXCEPTION 'Top Manager lost access to default hotel';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tickets WHERE organization_slug <> 'rdhotels') THEN
    RAISE EXCEPTION 'RD Top Manager can read another organization tickets';
  END IF;
END;
$test$;

-- Standard manager still sees their own hotel but not another RD property.
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', (
  SELECT id::text FROM public.profiles
  WHERE role::text = 'manager' AND organization_slug = 'rdhotels'
    AND assigned_hotel = 'memories-budapest' AND deleted_at IS NULL LIMIT 1
), true);
SET LOCAL ROLE authenticated;
DO $test$
DECLARE memories_count integer; photo_count integer;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE public.user_can_view_ticket(id))
    INTO memories_count, photo_count
  FROM public.tickets
  WHERE organization_slug = 'rdhotels' AND department = 'maintenance'
    AND hotel = 'Hotel Memories Budapest';
  IF memories_count < 1 OR photo_count <> memories_count THEN
    RAISE EXCEPTION 'Normal Memories manager ticket/photo visibility failed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tickets WHERE hotel = 'Hotel Ottofiori') THEN
    RAISE EXCEPTION 'Regular hotel manager gained cross-property maintenance access';
  END IF;
END;
$test$;

-- Separate organization executive must NOT see RD Hotels tickets.
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', (
  SELECT id::text FROM public.profiles
  WHERE role::text = 'top_management_manager' AND organization_slug = 'slnt'
    AND deleted_at IS NULL LIMIT 1
), true);
SET LOCAL ROLE authenticated;
DO $test$
BEGIN
  IF EXISTS (SELECT 1 FROM public.tickets WHERE organization_slug = 'rdhotels') THEN
    RAISE EXCEPTION 'SLNT Top Manager can read RD Hotels tickets';
  END IF;
END;
$test$;

-- Unauthenticated callers must not read these maintenance issues.
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', true);
SET LOCAL ROLE anon;
DO $test$
BEGIN
  IF EXISTS (SELECT 1 FROM public.tickets WHERE department = 'maintenance') THEN
    RAISE EXCEPTION 'Anonymous user can read maintenance tickets';
  END IF;
END;
$test$;

ROLLBACK;
