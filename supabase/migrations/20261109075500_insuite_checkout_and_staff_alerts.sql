-- HotelCare In-Suite phase 2: verify the guest stay and provide durable staff alerts.
-- New tables are deliberately private. Only insuite-api and trusted jobs may access them.
alter table public.insuite_devices
  add column if not exists active_reservation_id uuid references public.reservations(id),
  add column if not exists session_started_at timestamptz not null default now();

create index if not exists insuite_devices_current_stay
  on public.insuite_devices(active_reservation_id)
  where is_active and active_reservation_id is not null;

create table if not exists public.insuite_staff_alerts (
  id bigint generated always as identity primary key,
  recipient_id uuid not null references public.profiles(id),
  organization_slug text not null,
  hotel_id text not null,
  room_id uuid references public.rooms(id),
  event_key text not null,
  kind text not null check(kind in ('guest_request','guest_message','order','booking','escalation')),
  title text not null,
  body text not null,
  request_id uuid references public.insuite_service_requests(id),
  message_id uuid references public.insuite_messages(id),
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  unique (recipient_id, event_key)
);
create index if not exists insuite_staff_alerts_recipient_queue
  on public.insuite_staff_alerts(recipient_id, acknowledged_at, created_at desc);
create index if not exists insuite_staff_alerts_property
  on public.insuite_staff_alerts(organization_slug, hotel_id, created_at desc);

alter table public.insuite_staff_alerts enable row level security;
revoke all on public.insuite_staff_alerts from public, anon, authenticated;
revoke all on sequence public.insuite_staff_alerts_id_seq from public, anon, authenticated;
grant all on public.insuite_staff_alerts to service_role;
grant usage, select on sequence public.insuite_staff_alerts_id_seq to service_role;

alter table public.insuite_service_requests
  add column if not exists escalation_level integer not null default 0,
  add column if not exists escalated_at timestamptz;

-- Called only from privileged row triggers or the trusted escalation worker.
-- All recipients are constrained to the request's organization; regular staff
-- must also be assigned to the hotel (canonical ID or configured display name).
create or replace function public.insuite_fanout_alert(
  _organization_slug text, _hotel_id text, _room_id uuid,
  _event_key text, _kind text, _title text, _body text,
  _roles text[], _direct_user_id uuid default null,
  _request_id uuid default null, _message_id uuid default null
) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  _ids uuid[];
  _room_number text;
  _hotel_name text;
  _result integer := 0;
begin
  select hc.hotel_name into _hotel_name from public.hotel_configurations hc
  join public.organizations o on o.id = hc.organization_id
  where hc.hotel_id = _hotel_id and o.slug = _organization_slug limit 1;
  if _hotel_name is null then return 0; end if;
  select r.room_number into _room_number from public.rooms r
    where r.id = _room_id and r.organization_slug = _organization_slug
      and r.hotel = any(array[_hotel_id, _hotel_name]);
  if _room_number is null then return 0; end if;

  select coalesce(array_agg(distinct p.id), '{}'::uuid[]) into _ids
  from public.profiles p
  where p.organization_slug = _organization_slug
    and p.deleted_at is null
    and (
      (p.id = _direct_user_id and p.role::text in ('housekeeping','maintenance','reception','front_office','supervisor','manager','housekeeping_manager','maintenance_manager','reception_manager'))
      or (
        p.role::text = any(_roles)
        and (
          p.hotel_id = _hotel_id
          or p.assigned_hotel = any(array[_hotel_id, _hotel_name])
          or (p.role::text in ('top_management','top_management_manager') and p.assigned_hotel is null)
        )
      )
    );

  insert into public.insuite_staff_alerts
    (recipient_id, organization_slug, hotel_id, room_id, event_key, kind, title, body, request_id, message_id)
  select uid, _organization_slug, _hotel_id, _room_id, _event_key,
    _kind, left(_title,120), left(_body,240), _request_id, _message_id
  from unnest(_ids) as uid
  on conflict (recipient_id,event_key) do nothing;
  get diagnostics _result = row_count;
  if _result > 0 then
    -- Push is best-effort; a failed push MUST NEVER roll back the durable
    -- per-user inbox alert inserted in the parent transaction.
    begin
      perform public.hotelcare_dispatch_push(
        _ids, left(_title,120), left(_body,200),
        '/' || _organization_slug || '/insuite',
        left('insuite-' || _event_key, 80), 'insuite_' || _kind,
        jsonb_build_object('hotelId',_hotel_id,'roomId',_room_id,'roomNumber',_room_number)
      );
    exception when others then
      raise warning 'insuite optional Web Push failed: %', sqlerrm;
    end;
  end if;
  return _result;
exception when others then
  raise warning 'insuite alert dispatch failed: %', sqlerrm;
  return 0;
end; $$;
revoke all on function public.insuite_fanout_alert(text,text,uuid,text,text,text,text,text[],uuid,uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.insuite_fanout_alert(text,text,uuid,text,text,text,text,text[],uuid,uuid,uuid)
  to service_role;

create or replace function public.insuite_notify_request()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  _roles text[];
  _number text;
begin
  if tg_op <> 'INSERT' then return new; end if;
  select room_number into _number from public.rooms where id = new.room_id;
  _roles := case new.department
    when 'housekeeping' then array['housekeeping_manager','manager','supervisor','reception','front_office','reception_manager']
    when 'maintenance' then array['maintenance','maintenance_manager','manager','reception','front_office','reception_manager']
    else array['reception','front_office','reception_manager','manager'] end;
  perform public.insuite_fanout_alert(
    new.organization_slug, new.hotel_id, new.room_id,
    'service:' || new.id::text, 'guest_request',
    'Guest service request · Room ' || coalesce(_number,'?'),
    left(replace(new.request_type, '_', ' ') || ' ×' || new.quantity::text,200),
    _roles, new.assigned_to, new.id, null
  );
  return new;
end; $$;
revoke all on function public.insuite_notify_request() from public, anon, authenticated;
drop trigger if exists insuite_guest_request_notify on public.insuite_service_requests;
create trigger insuite_guest_request_notify after insert on public.insuite_service_requests
for each row execute function public.insuite_notify_request();

-- Reassignment generates a new durable, employee-specific alert without
-- touching the normal cleaning assignment or the room's clean/dirty flag.
create or replace function public.insuite_notify_request_reassignment()
returns trigger language plpgsql security definer set search_path = ''
as $
declare _number text;
begin
  if new.assigned_to is null or new.assigned_to is not distinct from old.assigned_to then
    return new;
  end if;
  select room_number into _number from public.rooms where id = new.room_id;
  perform public.insuite_fanout_alert(
    new.organization_slug,new.hotel_id,new.room_id,
    'assignment:' || new.id::text || ':' || new.assigned_to::text,
    'guest_request',
    'New assigned guest request · Room ' || coalesce(_number,'?'),
    left(replace(new.request_type,'_',' ') || ' ×' || new.quantity::text,200),
    array[]::text[],new.assigned_to,new.id,null
  );
  return new;
end; $;
revoke all on function public.insuite_notify_request_reassignment() from public, anon, authenticated;
drop trigger if exists insuite_guest_request_reassignment on public.insuite_service_requests;
create trigger insuite_guest_request_reassignment
  after update of assigned_to on public.insuite_service_requests
  for each row execute function public.insuite_notify_request_reassignment();

create or replace function public.insuite_notify_guest_message()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare _number text;
begin
  if new.sender <> 'guest' then return new; end if;
  select room_number into _number from public.rooms where id = new.room_id;
  perform public.insuite_fanout_alert(
    new.organization_slug, new.hotel_id, new.room_id,
    'chat:' || new.id::text, 'guest_message',
    'New reception chat · Room ' || coalesce(_number,'?'),
    left(new.body, 160),
    array['reception','front_office','reception_manager','manager','top_management','top_management_manager'],
    null, null, new.id
  );
  return new;
end; $$;
revoke all on function public.insuite_notify_guest_message() from public, anon, authenticated;
drop trigger if exists insuite_guest_message_notify on public.insuite_messages;
create trigger insuite_guest_message_notify after insert on public.insuite_messages
for each row execute function public.insuite_notify_guest_message();

-- Each check-in starts a new private guest session. Checkout only revokes the
-- same reservation's session; a late checkout from an earlier booking must
-- never clear a newly checked-in guest's current session.
create or replace function public.insuite_reservation_session_transition()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  _previous_room uuid;
  _new_room uuid;
  _other_stay boolean;
begin
  if tg_op = 'INSERT' then
    if new.status::text <> 'checked_in' or new.room_id is null then return new; end if;
    _new_room := new.room_id;
  else
    if old.status::text = 'checked_in'
      and (new.status::text <> 'checked_in' or old.room_id is distinct from new.room_id)
      and old.room_id is not null then
      update public.insuite_devices
        set session_epoch = gen_random_uuid(), active_reservation_id = null,
            session_started_at = now()
      where room_id = old.room_id and active_reservation_id = old.id and is_active;
    end if;
    if new.status::text <> 'checked_in' or new.room_id is null then return new; end if;
    if old.status::text = 'checked_in' and old.room_id is not distinct from new.room_id then
      return new;
    end if;
    _new_room := new.room_id;
  end if;

  select exists(
    select 1 from public.reservations r
    where r.room_id = _new_room and r.id <> new.id
      and r.status::text = 'checked_in'
  ) into _other_stay;
  if _other_stay then return new; end if;

  update public.insuite_devices d
    set active_reservation_id = new.id, session_epoch = gen_random_uuid(),
        session_started_at = now()
  where d.room_id = _new_room and d.is_active
    and d.active_reservation_id is distinct from new.id
    and d.organization_slug = new.organization_slug
    and exists (select 1 from public.insuite_property_configs c
      where c.organization_slug = d.organization_slug and c.hotel_id = d.hotel_id
        and c.enabled = true)
    and exists (
      select 1 from public.rooms room
      join public.hotel_configurations hc on room.hotel = any(array[hc.hotel_id,hc.hotel_name])
      join public.organizations o on o.id = hc.organization_id
      where room.id = _new_room and room.organization_slug = d.organization_slug
        and hc.hotel_id = d.hotel_id and o.slug = d.organization_slug
    );
  return new;
end; $$;
revoke all on function public.insuite_reservation_session_transition() from public, anon, authenticated;
drop trigger if exists insuite_checkout_session_guard on public.reservations;
create trigger insuite_checkout_session_guard
  after insert or update of status, room_id on public.reservations
  for each row execute function public.insuite_reservation_session_transition();

-- Previo physical departures may be reflected in pms_change_events rather
-- than reservations.status (the sync intentionally preserves some local
-- checked-in statuses). Only reset a tablet if the *verified* checkout event
-- explicitly identifies the same Previo reservation currently bound to it.
-- An unrelated/late checkout event must not reset the next guest's session.
create or replace function public.insuite_confirmed_previo_checkout()
returns trigger language plpgsql security definer set search_path = ''
as $
begin
  if new.event_type <> 'checkout_confirmed'
    or new.source <> 'poll_checkouts'
    or new.auto_applied is distinct from true
    or new.room_id is null
    or nullif(btrim(coalesce(new.previo_reservation_id,'')), '') is null
  then return new; end if;

  update public.insuite_devices d
    set session_epoch = gen_random_uuid(),
        active_reservation_id = null, session_started_at = now()
    from public.reservations r
  where d.room_id = new.room_id and d.is_active
    and d.hotel_id = new.hotel_id
    and d.active_reservation_id = r.id
    and r.room_id = new.room_id
    and r.organization_slug = d.organization_slug
    and btrim(coalesce(r.source_reservation_id,'')) =
        btrim(new.previo_reservation_id)
    and exists (
      select 1 from public.hotel_configurations hc
      join public.organizations o on o.id = hc.organization_id
      where hc.hotel_id = d.hotel_id and o.slug = d.organization_slug
    );

  return new;
end; $;
revoke all on function public.insuite_confirmed_previo_checkout() from public, anon, authenticated;
drop trigger if exists insuite_verified_previo_checkout on public.pms_change_events;
create trigger insuite_verified_previo_checkout
  after insert on public.pms_change_events
  for each row execute function public.insuite_confirmed_previo_checkout();

-- Durable SLA reminder: no changes to room clean/dirty states or existing
-- housekeeping assignments. Duplicate escalations are blocked by level.
create or replace function public.insuite_escalate_overdue()
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  _r record;
  _number text;
  _count integer := 0;
  _rows integer := 0;
begin
  for _r in
    select r.* from public.insuite_service_requests r
    join public.insuite_devices d on d.id = r.device_id
      and d.is_active and d.session_epoch = r.session_epoch
    join public.insuite_property_configs c
      on c.organization_slug = r.organization_slug and c.hotel_id = r.hotel_id and c.enabled
    where r.status in ('submitted','accepted','in_progress')
      and r.escalation_level = 0
      and (
        (r.status = 'submitted' and r.created_at < now() - interval '5 minutes')
        or (r.status = 'accepted' and r.updated_at < now() - interval '15 minutes')
        or (r.status = 'in_progress' and r.updated_at < now() - interval '30 minutes')
      )
    order by r.created_at limit 100
    for update of r skip locked
  loop
    update public.insuite_service_requests
      set escalation_level = 1, escalated_at = now()
      where id = _r.id and escalation_level = 0;
    get diagnostics _rows = row_count;
    if _rows <> 1 then continue; end if;
    select room_number into _number from public.rooms where id = _r.room_id;
    perform public.insuite_fanout_alert(
      _r.organization_slug,_r.hotel_id,_r.room_id,
      'escalation:' || _r.id::text, 'escalation',
      'Guest request overdue · Room ' || coalesce(_number,'?'),
      left(replace(_r.request_type,'_',' ') || ' is still ' || _r.status, 180),
      array['manager','housekeeping_manager','maintenance_manager','reception_manager','reception','front_office','top_management','top_management_manager'],
      null, _r.id, null
    );
    _count := _count + 1;
  end loop;
  return _count;
end; $$;
revoke all on function public.insuite_escalate_overdue() from public, anon, authenticated;
grant execute on function public.insuite_escalate_overdue() to service_role;

-- Escalation is installed but intentionally NOT scheduled until a hotel
-- has completed guest-service and staff-notification pilot tests.
-- Schedule only once after validating alerts and on-duty routing:
-- SELECT cron.schedule('insuite-escalation-1m', '* * * * *',
--    'SELECT public.insuite_escalate_overdue();');
-- This avoids adding a production background job before the pilot is enabled.
