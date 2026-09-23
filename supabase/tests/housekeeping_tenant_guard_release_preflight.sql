-- #353 read-only release gate. Run with psql -X -v ON_ERROR_STOP=1 against
-- a secure, authorized production-equivalent snapshot before applying RLS.
-- This script emits only a generic failure, not employee IDs or room numbers.
-- It does not modify any records.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.room_assignments a
      LEFT JOIN public.rooms r ON r.id = a.room_id
      LEFT JOIN public.profiles p ON p.id = a.assigned_to
     WHERE a.status IN ('assigned', 'in_progress')
       AND (
         a.organization_slug IS DISTINCT FROM r.organization_slug
         OR a.organization_slug IS DISTINCT FROM p.organization_slug
         OR r.id IS NULL OR p.id IS NULL
       )
  ) THEN
    RAISE EXCEPTION
      'HK_TENANT_PREFLIGHT_BLOCKED: unresolved active cross-organization room or employee references'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.next_day_housekeeping_plan_items
     WHERE COALESCE(recommendation_context->>'assignment_role','primary') <> 'shared'
     GROUP BY plan_id,room_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'HK_TENANT_PREFLIGHT_BLOCKED: duplicate primary next-day room ownership'
      USING ERRCODE = '23505';
  END IF;

  RAISE NOTICE
    'HK_TENANT_PREFLIGHT_OK: no unresolved active tenant links or duplicate primary next-day owners';
END $$;
