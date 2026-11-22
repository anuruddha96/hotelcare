-- Test the actual schema migration, trigger and RLS policy using PostgreSQL.
do $audit$
declare
  event_count int;
  status_actor uuid;
begin
  update public.restaurant_reservations set
    status='seated',
    status_marked_at=now(),
    status_marked_by='Breakfast colleague',
    status_marked_user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid
  where id='11111111-1111-4111-8111-111111111111';
  select count(*), (array_agg(actor_user_id))[1] into event_count,status_actor
  from public.restaurant_reservation_staff_events
  where action='status_changed' and previous_status='booked' and new_status='seated';
  if event_count<>1 or status_actor <> 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid then
    raise exception 'Verified status-change audit trail missing';
  end if;

  update public.restaurant_reservations
    set first_seen_at=now(), first_seen_by='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  where id='11111111-1111-4111-8111-111111111111';
  if (select count(*) from public.restaurant_reservation_staff_events where action='first_seen')<>1 then
    raise exception 'First-view audit missing';
  end if;
  if (select actor_user_id from public.restaurant_reservation_staff_events where action='first_seen')
    <> 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid then
    raise exception 'First-view audit attributed to wrong user';
  end if;

  -- An upstream dashboard update must not reuse the previous staff's identity.
  update public.restaurant_reservations set status='completed'
  where id='11111111-1111-4111-8111-111111111111';
  if (select actor_user_id from public.restaurant_reservation_staff_events
    where new_status='completed' limit 1) is not null then
    raise exception 'Upstream status was wrongly attributed to staff';
  end if;

  if not (select relrowsecurity from pg_class where oid='public.restaurant_reservation_staff_events'::regclass) then
    raise exception 'Audit events must have RLS enabled';
  end if;
  if has_table_privilege('anon','public.restaurant_reservation_staff_events','SELECT')
    or has_table_privilege('authenticated','public.restaurant_reservation_staff_events','SELECT')
    or not has_table_privilege('service_role','public.restaurant_reservation_staff_events','SELECT') then
    raise exception 'Audit events permissions are not isolated';
  end if;
  if has_function_privilege('anon','public.audit_restaurant_reservation_staff_changes()','EXECUTE')
    or has_function_privilege('authenticated','public.audit_restaurant_reservation_staff_changes()','EXECUTE') then
    raise exception 'Audit trigger function is publicly executable';
  end if;
end;
$audit$;

-- Test policy with distinct authenticated users and default roles.
-- An authenticated breakfast user may read; housekeeping, deleted staff
-- and anonymous callers must not see names or reservation records.
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);
set role authenticated;
do $rls$ begin
  if (select count(*) from public.restaurant_reservations)<>1 then
    raise exception 'Assigned breakfast staff cannot read restaurant reservations';
  end if;
end $rls$;
reset role;

select set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',false);
set role authenticated;
do $rls$ begin
  if (select count(*) from public.restaurant_reservations)<>0 then
    raise exception 'Housekeeping user accessed protected reservation';
  end if;
end $rls$;
reset role;

select set_config('request.jwt.claim.sub','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',false);
set role authenticated;
do $rls$ begin
  if (select count(*) from public.restaurant_reservations)<>0 then
    raise exception 'Deleted breakfast staff retained guest-data access';
  end if;
end $rls$;
reset role;

select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);
set role anon;
do $rls$ begin
  if (select count(*) from public.restaurant_reservations)<>0 then
    raise exception 'Anonymous role accessed guest data';
  end if;
end $rls$;
reset role;

do $final$ begin
  if (select count(*) from pg_trigger where tgname='trg_audit_restaurant_reservation_staff_changes')<>1 then
    raise exception 'Audit trigger was not idempotent';
  end if;
  raise notice 'Restaurant reservations: SQL audit and RLS tests passed';
end $final$;
