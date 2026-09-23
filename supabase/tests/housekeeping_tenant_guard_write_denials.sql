-- Additional destructive-path assertions for the housekeeping tenant guard.
-- Runs only against the disposable PostgreSQL CI fixture.

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000015'; -- SLNT housekeeper
DO $$
DECLARE affected integer;
BEGIN
  UPDATE public.room_assignments
     SET status = 'completed'
   WHERE organization_slug = 'rdhotels';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN
    RAISE EXCEPTION 'SLNT housekeeper updated % RD assignment rows', affected;
  END IF;
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000013'; -- SLNT manager
DO $$
DECLARE affected integer;
BEGIN
  DELETE FROM public.room_assignments
   WHERE organization_slug = 'rdhotels';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN
    RAISE EXCEPTION 'SLNT manager deleted % RD assignment rows', affected;
  END IF;
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000013'; -- SLNT manager
DO $$
DECLARE inserted boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.room_assignments(room_id, assigned_to, organization_slug, status)
    VALUES (
      '00000000-0000-4000-8000-000000000021', -- RD Hotels / Mika room
      '00000000-0000-4000-8000-000000000014', -- RD Hotels housekeeper
      'rdhotels',
      'assigned'
    );
    inserted := true;
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;

  IF inserted THEN
    RAISE EXCEPTION 'SLNT manager inserted an RD assignment row';
  END IF;
END $$;
ROLLBACK;

-- RLS alone is not enough: a manager may legitimately insert rows for their own
-- organization, so the integrity guard must also reject a foreign room hidden
-- behind the caller's organization_slug.
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000013'; -- SLNT manager
DO $$
DECLARE inserted boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.room_assignments(room_id, assigned_to, organization_slug, status)
    VALUES (
      '00000000-0000-4000-8000-000000000021', -- RD Hotels / Mika room
      '00000000-0000-4000-8000-000000000015', -- SLNT housekeeper
      'slnt',
      'assigned'
    );
    inserted := true;
  EXCEPTION
    WHEN insufficient_privilege OR check_violation OR raise_exception THEN NULL;
  END;

  IF inserted THEN
    RAISE EXCEPTION 'SLNT manager inserted an SLNT assignment referencing an RD room';
  END IF;
END $$;
ROLLBACK;

-- Symmetric integrity case: even with an SLNT room and SLNT organization_slug,
-- the assignment must not smuggle in a worker owned by RD Hotels.
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000013'; -- SLNT manager
DO $$
DECLARE inserted boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.room_assignments(room_id, assigned_to, organization_slug, status)
    VALUES (
      '00000000-0000-4000-8000-000000000023', -- SLNT One room
      '00000000-0000-4000-8000-000000000014', -- RD Hotels housekeeper
      'slnt',
      'assigned'
    );
    inserted := true;
  EXCEPTION
    WHEN insufficient_privilege OR check_violation OR raise_exception THEN NULL;
  END;

  IF inserted THEN
    RAISE EXCEPTION 'SLNT manager inserted an SLNT assignment referencing an RD worker';
  END IF;
END $$;
ROLLBACK;

-- UPDATE must enforce the same relationship integrity as INSERT. An SLNT manager
-- may edit an SLNT assignment, but must not be able to re-point it to an RD room.
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000013'; -- SLNT manager
DO $$
DECLARE candidate_count integer;
DECLARE changed boolean := false;
BEGIN
  SELECT count(*) INTO candidate_count
    FROM public.room_assignments
   WHERE organization_slug = 'slnt'
     AND room_id = '00000000-0000-4000-8000-000000000023';

  IF candidate_count = 0 THEN
    RAISE EXCEPTION 'fixture missing SLNT assignment required for foreign-room UPDATE test';
  END IF;

  BEGIN
    UPDATE public.room_assignments
       SET room_id = '00000000-0000-4000-8000-000000000021' -- RD Hotels / Mika room
     WHERE organization_slug = 'slnt'
       AND room_id = '00000000-0000-4000-8000-000000000023';
    changed := FOUND;
  EXCEPTION
    WHEN insufficient_privilege OR check_violation OR raise_exception THEN NULL;
  END;

  IF changed THEN
    RAISE EXCEPTION 'SLNT manager repointed an SLNT assignment to an RD room';
  END IF;
END $$;
ROLLBACK;

SELECT 'cross-tenant live assignment write denials passed' AS result;
