-- Follow-up hardening for Web Push. Safe to apply repeatedly.

grant select, delete on table public.push_subscriptions to service_role;

create or replace function public.hotelcare_notify_room_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _room record;
  _is_new_assignment boolean := false;
  _title text;
  _body text;
  _org text;
begin
  if new.assigned_to is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    _is_new_assignment := true;
  else
    _is_new_assignment := old.assigned_to is distinct from new.assigned_to
      or old.assignment_type is distinct from new.assignment_type;
  end if;

  if not _is_new_assignment then
    return new;
  end if;

  select r.room_number, r.is_checkout_room, r.organization_slug
    into _room
  from public.rooms r
  where r.id = new.room_id;

  if _room.room_number is null then
    return new;
  end if;

  _org := coalesce(_room.organization_slug, new.organization_slug, 'rdhotels');
  _title := case when coalesce(_room.is_checkout_room, false)
    then 'New checkout room'
    else 'New room assignment'
  end;
  _body := 'Room ' || _room.room_number || ' · ' ||
    initcap(replace(coalesce(new.assignment_type::text, 'cleaning'), '_', ' '));

  perform public.hotelcare_dispatch_push(
    array[new.assigned_to]::uuid[],
    _title,
    _body,
    '/' || _org || '?tab=housekeeping',
    'housekeeping-assignment-' || new.id::text,
    'housekeeping_assignment',
    jsonb_build_object(
      'assignmentId', new.id,
      'roomId', new.room_id,
      'roomNumber', _room.room_number,
      'assignmentType', new.assignment_type::text,
      'checkout', coalesce(_room.is_checkout_room, false)
    )
  );

  return new;
end;
$$;

create or replace function public.hotelcare_notify_housekeeping_alert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _users uuid[];
  _org text;
  _hotel text;
  _body text;
begin
  if tg_op = 'UPDATE' then
    if old.status is not distinct from new.status then
      return new;
    end if;
  end if;

  _org := coalesce(new.organization_slug, 'rdhotels');
  _hotel := new.hotel_id;

  select public.hotelcare_push_recipients(
    _org,
    _hotel,
    array['housekeeping_manager','manager','admin','top_management','top_management_manager','supervisor']::text[]
  ) into _users;

  _body := initcap(replace(coalesce(new.alert_type, 'Housekeeping automation alert'), '_', ' '));

  perform public.hotelcare_dispatch_push(
    _users,
    'Housekeeping needs attention',
    left(_body, 180),
    '/' || _org || '?tab=housekeeping',
    'housekeeping-alert-' || _hotel,
    'housekeeping_alert',
    jsonb_build_object(
      'alertId', new.id,
      'hotelId', new.hotel_id,
      'alertType', new.alert_type,
      'status', new.status,
      'workDate', new.work_date
    )
  );

  return new;
end;
$$;
