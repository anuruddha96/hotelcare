-- Regression tests: tenant-scoped maintenance room access / safe work-start behavior.
BEGIN;
DO $test$
DECLARE
  fn text;
BEGIN
  SELECT pg_get_functiondef('public.get_maintenance_room_access(uuid)'::regprocedure) INTO fn;
  IF position('organization_slug' in fn)=0 OR position('assigned_hotel' in fn)=0 OR position('get_hotel_name_from_id' in fn)=0 THEN
    RAISE EXCEPTION 'Maintenance access is not property- and tenant-scoped';
  END IF;
  IF position('v_candidates = 1' in fn)=0 OR position('status_unverified' in fn)=0 THEN
    RAISE EXCEPTION 'Unlinked-room and stale-PMS safeguards missing';
  END IF;
  IF position('checkedOutAt' in fn)=0 OR position('pmsSyncDate' in fn)=0 THEN
    RAISE EXCEPTION 'Verified same-day checkout evidence missing';
  END IF;
  IF position('not_applicable' in fn)=0 THEN
    RAISE EXCEPTION 'Non-room maintenance tickets need a separate state';
  END IF;

  SELECT pg_get_functiondef('public.start_maintenance_ticket_with_access(uuid,timestamptz,text)'::regprocedure) INTO fn;
  IF position('FOR UPDATE' in fn)=0 OR position('guest_permission' in fn)=0 OR position('guest_out' in fn)=0 THEN
    RAISE EXCEPTION 'Entry confirmation / concurrency guard missing';
  END IF;
  IF position('public.work_maintenance_ticket' in fn)=0 THEN
    RAISE EXCEPTION 'Existing maintenance work workflow not retained';
  END IF;
  IF has_function_privilege('anon','public.get_maintenance_room_access(uuid)','EXECUTE')
     OR has_function_privilege('anon','public.start_maintenance_ticket_with_access(uuid,timestamptz,text)','EXECUTE') THEN
    RAISE EXCEPTION 'Anonymous access to maintenance access RPCs is forbidden';
  END IF;
END;
$test$;
ROLLBACK;
