-- Exercise the real migration in a disposable PostgreSQL database.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000011',true);
INSERT INTO public.room_assignments(id,room_id,assigned_to,assigned_by,organization_slug,assignment_date)
VALUES ('00000000-0000-4000-8000-000000000099','00000000-0000-4000-8000-000000000021',
'00000000-0000-4000-8000-000000000014','00000000-0000-4000-8000-000000000012','rdhotels',current_date);
UPDATE public.room_assignments SET assigned_to='00000000-0000-4000-8000-000000000017'
WHERE id='00000000-0000-4000-8000-000000000099';
UPDATE public.room_assignments SET status='in_progress'
WHERE id='00000000-0000-4000-8000-000000000099';
DELETE FROM public.room_assignments WHERE id='00000000-0000-4000-8000-000000000099';
DO $$
BEGIN
 IF (SELECT array_agg(event_type ORDER BY id) FROM public.room_assignment_history)
   IS DISTINCT FROM ARRAY['assigned','reassigned','unassigned']::text[] THEN
   RAISE EXCEPTION 'Expected three ownership events and no status-only event';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public.room_assignment_history WHERE event_type='reassigned'
   AND previous_assignee_name='Cleaner A' AND new_assignee_name='Cleaner B'
   AND actor_name='Manager' AND room_number='042'
   AND actor_id='00000000-0000-4000-8000-000000000011') THEN
   RAISE EXCEPTION 'Incorrect ownership or actor attribution';
 END IF;
 IF has_table_privilege(current_user,'public.room_assignment_history','INSERT')
   OR has_table_privilege(current_user,'public.room_assignment_history','UPDATE')
   OR has_table_privilege(current_user,'public.room_assignment_history','DELETE') THEN
   RAISE EXCEPTION 'Audit must be append-only for clients';
 END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000014',true);
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.room_assignment_history) THEN RAISE EXCEPTION 'Housekeeper read leaked'; END IF; END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000012',true);
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.room_assignment_history) THEN RAISE EXCEPTION 'Other property read leaked'; END IF; END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000013',true);
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.room_assignment_history) THEN RAISE EXCEPTION 'Other tenant read leaked'; END IF; END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
INSERT INTO public.room_assignments(id,room_id,assigned_to,organization_slug,assignment_date)
VALUES ('00000000-0000-4000-8000-000000000098','00000000-0000-4000-8000-000000000021',
'00000000-0000-4000-8000-000000000014','rdhotels',current_date);
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM public.room_assignment_history WHERE assignment_id='00000000-0000-4000-8000-000000000098' AND actor_id IS NULL AND actor_name IS NULL) THEN RAISE EXCEPTION 'Unauthenticated system change must not be attributed to staff'; END IF; END $$;
ROLLBACK;
