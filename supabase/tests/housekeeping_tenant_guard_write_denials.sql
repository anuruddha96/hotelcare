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

SELECT 'cross-tenant live assignment write denials passed' AS result;
