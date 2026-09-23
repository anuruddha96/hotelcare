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

SELECT 'cross-tenant live assignment write denials passed' AS result;
