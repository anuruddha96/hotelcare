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
      '00000000-0000-4000-8000-000000000021',
      '00000000-0000-4000-8000-000000000014',
      'rdhotels',
      'assigned'
    );
    inserted := true;
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
  IF inserted THEN RAISE EXCEPTION 'SLNT manager inserted an RD assignment row'; END IF;
END $$;
ROLLBACK;

-- RLS alone is not enough: own-organization writes must still reject a foreign room.
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000013';
DO $$
DECLARE inserted boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.room_assignments(room_id, assigned_to, organization_slug, status)
    VALUES ('00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000015','slnt','assigned');
    inserted := true;
  EXCEPTION WHEN insufficient_privilege OR check_violation OR raise_exception THEN NULL;
  END;
  IF inserted THEN RAISE EXCEPTION 'SLNT manager inserted an SLNT assignment referencing an RD room'; END IF;
END $$;
ROLLBACK;

-- Symmetric INSERT integrity case: an SLNT room cannot reference an RD worker.
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000013';
DO $$
DECLARE inserted boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.room_assignments(room_id, assigned_to, organization_slug, status)
    VALUES ('00000000-0000-4000-8000-000000000023','00000000-0000-4000-8000-000000000014','slnt','assigned');
    inserted := true;
  EXCEPTION WHEN insufficient_privilege OR check_violation OR raise_exception THEN NULL;
  END;
  IF inserted THEN RAISE EXCEPTION 'SLNT manager inserted an SLNT assignment referencing an RD worker'; END IF;
END $$;
ROLLBACK;

-- UPDATE must not re-point a legitimate SLNT assignment to an RD room.
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000013';
DO $$
DECLARE candidate_count integer;
DECLARE changed boolean := false;
BEGIN
  SELECT count(*) INTO candidate_count FROM public.room_assignments
   WHERE organization_slug='slnt' AND room_id='00000000-0000-4000-8000-000000000023';
  IF candidate_count = 0 THEN RAISE EXCEPTION 'fixture missing SLNT assignment required for foreign-room UPDATE test'; END IF;
  BEGIN
    UPDATE public.room_assignments SET room_id='00000000-0000-4000-8000-000000000021'
     WHERE organization_slug='slnt' AND room_id='00000000-0000-4000-8000-000000000023';
    changed := FOUND;
  EXCEPTION WHEN insufficient_privilege OR check_violation OR raise_exception THEN NULL;
  END;
  IF changed THEN RAISE EXCEPTION 'SLNT manager repointed an SLNT assignment to an RD room'; END IF;
END $$;
ROLLBACK;

-- Symmetric UPDATE integrity case: an SLNT assignment cannot switch to an RD worker.
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000013';
DO $$
DECLARE candidate_count integer;
DECLARE changed boolean := false;
BEGIN
  SELECT count(*) INTO candidate_count FROM public.room_assignments
   WHERE organization_slug='slnt' AND room_id='00000000-0000-4000-8000-000000000023'
     AND assigned_to='00000000-0000-4000-8000-000000000015';
  IF candidate_count = 0 THEN RAISE EXCEPTION 'fixture missing SLNT assignment required for foreign-worker UPDATE test'; END IF;
  BEGIN
    UPDATE public.room_assignments SET assigned_to='00000000-0000-4000-8000-000000000014'
     WHERE organization_slug='slnt' AND room_id='00000000-0000-4000-8000-000000000023'
       AND assigned_to='00000000-0000-4000-8000-000000000015';
    changed := FOUND;
  EXCEPTION WHEN insufficient_privilege OR check_violation OR raise_exception THEN NULL;
  END;
  IF changed THEN RAISE EXCEPTION 'SLNT manager repointed an SLNT assignment to an RD worker'; END IF;
END $$;
ROLLBACK;

-- The tenant key itself cannot be relabeled across organizations.
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000013';
DO $$
DECLARE candidate_count integer;
DECLARE changed boolean := false;
BEGIN
  SELECT count(*) INTO candidate_count FROM public.room_assignments
   WHERE organization_slug='slnt' AND room_id='00000000-0000-4000-8000-000000000023'
     AND assigned_to='00000000-0000-4000-8000-000000000015';
  IF candidate_count = 0 THEN RAISE EXCEPTION 'fixture missing SLNT assignment required for tenant-slug UPDATE test'; END IF;
  BEGIN
    UPDATE public.room_assignments SET organization_slug='rdhotels'
     WHERE organization_slug='slnt' AND room_id='00000000-0000-4000-8000-000000000023'
       AND assigned_to='00000000-0000-4000-8000-000000000015';
    changed := FOUND;
  EXCEPTION WHEN insufficient_privilege OR check_violation OR raise_exception THEN NULL;
  END;
  IF changed THEN RAISE EXCEPTION 'SLNT manager relabeled an SLNT assignment as RD Hotels'; END IF;
END $$;
ROLLBACK;

-- Safety must not become over-restriction: a manager must still be able to update
-- ordinary fields on a legitimate assignment owned entirely by their tenant.
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000013'; -- SLNT manager
DO $$
DECLARE affected integer;
BEGIN
  UPDATE public.room_assignments
     SET status = 'completed'
   WHERE organization_slug = 'slnt'
     AND room_id = '00000000-0000-4000-8000-000000000023'
     AND assigned_to = '00000000-0000-4000-8000-000000000015';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN
    RAISE EXCEPTION 'Tenant guard blocked legitimate SLNT assignment status update; affected=%', affected;
  END IF;
END $$;
ROLLBACK;

-- The write guard must also preserve normal same-tenant assignment creation.
-- Use a fresh id so this checks INSERT policy/trigger behavior without colliding
-- with the fixture's existing legitimate SLNT assignment.
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000013'; -- SLNT manager
DO $$
DECLARE affected integer;
BEGIN
  INSERT INTO public.room_assignments(id, room_id, assigned_to, organization_slug, status)
  VALUES (
    '00000000-0000-4000-8000-000000000099',
    '00000000-0000-4000-8000-000000000023',
    '00000000-0000-4000-8000-000000000015',
    'slnt',
    'assigned'
  );
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN
    RAISE EXCEPTION 'Tenant guard blocked legitimate SLNT assignment insert; affected=%', affected;
  END IF;
END $$;
ROLLBACK;

SELECT 'cross-tenant live assignment write denials passed' AS result;
