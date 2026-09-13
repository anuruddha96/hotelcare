-- Real background Web Push support for HotelCare.
--
-- This migration deliberately contains no private VAPID key or dispatch secret.
-- Those values are stored separately in Supabase Vault.

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_id_idx
  on public.push_subscriptions(user_id);

alter table public.push_subscriptions enable row level security;

revoke all on table public.push_subscriptions from anon, authenticated;

create or replace function public.register_push_subscription(
  _endpoint text,
  _p256dh text,
  _auth text,
  _user_agent text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  _user_id uuid := auth.uid();
  _id uuid;
begin
  if _user_id is null then
    raise exception 'Authentication required';
  end if;

  if nullif(trim(_endpoint), '') is null
     or nullif(trim(_p256dh), '') is null
     or nullif(trim(_auth), '') is null then
    raise exception 'Invalid push subscription';
  end if;

  insert into public.push_subscriptions (
    user_id, endpoint, p256dh, auth, user_agent, updated_at, last_seen_at
  )
  values (
    _user_id, _endpoint, _p256dh, _auth, _user_agent, now(), now()
  )
  on conflict (endpoint) do update
    set user_id = excluded.user_id,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        user_agent = excluded.user_agent,
        updated_at = now(),
        last_seen_at = now()
  returning id into _id;

  return _id;
end;
$$;

create or replace function public.unregister_push_subscription(_endpoint text)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  _user_id uuid := auth.uid();
  _deleted integer;
begin
  if _user_id is null then
    raise exception 'Authentication required';
  end if;

  delete from public.push_subscriptions
  where endpoint = _endpoint
    and user_id = _user_id;

  get diagnostics _deleted = row_count;
  return _deleted > 0;
end;
$$;

revoke all on function public.register_push_subscription(text, text, text, text) from public, anon;
revoke all on function public.unregister_push_subscription(text) from public, anon;
grant execute on function public.register_push_subscription(text, text, text, text) to authenticated;
grant execute on function public.unregister_push_subscription(text) to authenticated;

-- Edge Functions cannot query the Vault schema over the normal REST endpoint.
-- This service-role-only RPC exposes one named secret to the push sender while
-- keeping it completely unavailable to browser users.
create or replace function public.get_hotelcare_push_secret(_name text)
returns text
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  _secret text;
begin
  if _name not in ('hotelcare_vapid_private_key', 'hotelcare_push_dispatch_key') then
    raise exception 'Secret is not available';
  end if;

  select decrypted_secret
    into _secret
  from vault.decrypted_secrets
  where name = _name
  order by created_at desc
  limit 1;

  return _secret;
end;
$$;

revoke all on function public.get_hotelcare_push_secret(text) from public, anon, authenticated;
grant execute on function public.get_hotelcare_push_secret(text) to service_role;

-- Return users that should receive property-level operational notifications.
-- HotelCare historically stores assigned_hotel as either the canonical hotel id
-- or the display name, so both are intentionally matched here.
create or replace function public.hotelcare_push_recipients(
  _organization_slug text,
  _hotel_id text,
  _roles text[]
)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct p.id), '{}'::uuid[])
  from public.profiles p
  left join public.hotel_configurations hc
    on hc.hotel_id = _hotel_id
  where p.deleted_at is null
    and (
      p.is_super_admin is true
      or (
        p.organization_slug = _organization_slug
        and p.role::text = any(_roles)
        and (
          p.hotel_id::text = _hotel_id
          or p.assigned_hotel = _hotel_id
          or p.assigned_hotel = hc.hotel_name
          or (
            p.assigned_hotel is null
            and p.role::text = any(array['admin','top_management','top_management_manager'])
          )
        )
      )
    );
$$;

revoke all on function public.hotelcare_push_recipients(text, text, text[]) from public, anon, authenticated;
grant execute on function public.hotelcare_push_recipients(text, text, text[]) to service_role;

-- Fire-and-forget delivery to the Web Push Edge Function. A notification outage
-- must never block a booking, assignment, PMS sync, or revenue transaction.
create or replace function public.hotelcare_dispatch_push(
  _user_ids uuid[],
  _title text,
  _body text,
  _url text,
  _tag text,
  _event_type text,
  _data jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public, vault, net
as $$
declare
  _secret text;
  _request_id bigint;
begin
  if coalesce(array_length(_user_ids, 1), 0) = 0 then
    return null;
  end if;

  select decrypted_secret
    into _secret
  from vault.decrypted_secrets
  where name = 'hotelcare_push_dispatch_key'
  order by created_at desc
  limit 1;

  if _secret is null then
    raise warning 'HotelCare push dispatch secret is not configured';
    return null;
  end if;

  select net.http_post(
    url := 'https://pcmszqqklkolvvlabohq.supabase.co/functions/v1/send-push-notification',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-hotelcare-push-secret', _secret
    ),
    body := jsonb_build_object(
      'userIds', _user_ids,
      'title', _title,
      'body', _body,
      'url', _url,
      'tag', _tag,
      'eventType', _event_type,
      'data', coalesce(_data, '{}'::jsonb)
    ),
    timeout_milliseconds := 5000
  ) into _request_id;

  return _request_id;
exception when others then
  raise warning 'HotelCare push dispatch failed: %', sqlerrm;
  return null;
end;
$$;

revoke all on function public.hotelcare_dispatch_push(uuid[], text, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.hotelcare_dispatch_push(uuid[], text, text, text, text, text, jsonb) to service_role;

-- Housekeeper room assignment / reassignment notifications.
create or replace function public.hotelcare_notify_room_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _room record;
  _is_new_assignment boolean;
  _title text;
  _body text;
  _org text;
begin
  if new.assigned_to is null then
    return new;
  end if;

  _is_new_assignment := tg_op = 'INSERT'
    or old.assigned_to is distinct from new.assigned_to
    or old.assignment_type is distinct from new.assignment_type;

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

  _org := coalesce(_room.organization_slug, 'rdhotels');
  _title := case when coalesce(_room.is_checkout_room, false)
    then 'New checkout room'
    else 'New room assignment'
  end;
  _body := 'Room ' || _room.room_number || ' · ' ||
    initcap(replace(coalesce(new.assignment_type, 'cleaning'), '_', ' '));

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
      'assignmentType', new.assignment_type,
      'checkout', coalesce(_room.is_checkout_room, false)
    )
  );

  return new;
end;
$$;

drop trigger if exists hotelcare_push_room_assignment on public.room_assignments;
create trigger hotelcare_push_room_assignment
after insert or update of assigned_to, assignment_type
on public.room_assignments
for each row execute function public.hotelcare_notify_room_assignment();

-- A room can become a checkout after it has already been assigned. Notify the
-- currently assigned housekeeper in that case as well.
create or replace function public.hotelcare_notify_checkout_room()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _assignment record;
  _org text;
begin
  if coalesce(old.is_checkout_room, false) = coalesce(new.is_checkout_room, false)
     or new.is_checkout_room is not true then
    return new;
  end if;

  select ra.id, ra.assigned_to
    into _assignment
  from public.room_assignments ra
  where ra.room_id = new.id
    and ra.assignment_date = current_date
    and ra.assigned_to is not null
  order by ra.created_at desc nulls last
  limit 1;

  if _assignment.assigned_to is null then
    return new;
  end if;

  _org := coalesce(new.organization_slug, 'rdhotels');
  perform public.hotelcare_dispatch_push(
    array[_assignment.assigned_to]::uuid[],
    'New checkout room',
    'Room ' || new.room_number || ' is now a checkout',
    '/' || _org || '?tab=housekeeping',
    'housekeeping-assignment-' || _assignment.id::text,
    'checkout_room',
    jsonb_build_object(
      'assignmentId', _assignment.id,
      'roomId', new.id,
      'roomNumber', new.room_number,
      'checkout', true
    )
  );

  return new;
end;
$$;

drop trigger if exists hotelcare_push_checkout_room on public.rooms;
create trigger hotelcare_push_checkout_room
after update of is_checkout_room
on public.rooms
for each row execute function public.hotelcare_notify_checkout_room();

-- New booking notifications for property managers / admins.
create or replace function public.hotelcare_notify_new_reservation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _users uuid[];
  _org text;
  _hotel text;
  _source text;
  _body text;
begin
  _org := coalesce(new.organization_slug, 'rdhotels');
  _hotel := new.hotel_id::text;

  select public.hotelcare_push_recipients(
    _org,
    _hotel,
    array['manager','admin','top_management','top_management_manager']::text[]
  ) into _users;

  _source := nullif(trim(coalesce(new.source, '')), '');
  _body := case when _source is null then '' else initcap(_source) || ' · ' end ||
    to_char(new.check_in_date, 'DD Mon') || ' → ' || to_char(new.check_out_date, 'DD Mon');

  perform public.hotelcare_dispatch_push(
    _users,
    'New booking',
    _body,
    '/' || _org || '?tab=reservations',
    'reservation-' || new.id::text,
    'new_booking',
    jsonb_build_object(
      'reservationId', new.id,
      'reservationNumber', new.reservation_number,
      'hotelId', new.hotel_id,
      'source', new.source,
      'checkIn', new.check_in_date,
      'checkOut', new.check_out_date
    )
  );

  return new;
end;
$$;

drop trigger if exists hotelcare_push_new_reservation on public.reservations;
create trigger hotelcare_push_new_reservation
after insert on public.reservations
for each row execute function public.hotelcare_notify_new_reservation();

-- Revenue automation result notifications. The tag is property-scoped so a run
-- that updates many dates produces one useful lock-screen item rather than spam.
create or replace function public.hotelcare_notify_revenue_automation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _users uuid[];
  _title text;
  _body text;
  _org text;
  _hotel text;
begin
  _org := coalesce(new.organization_slug, 'rdhotels');
  _hotel := new.hotel_id::text;

  select public.hotelcare_push_recipients(
    _org,
    _hotel,
    array['admin','top_management','top_management_manager','manager']::text[]
  ) into _users;

  if coalesce(new.failed_count, 0) > 0
     or lower(coalesce(new.severity, '')) in ('warning','error','critical') then
    _title := 'Pricing automation needs attention';
  else
    _title := 'Automated pricing updated';
  end if;

  _body := nullif(trim(coalesce(new.summary, '')), '');
  if _body is null then
    _body := coalesce(new.pushed_count, 0)::text || ' rate updates published';
    if coalesce(new.failed_count, 0) > 0 then
      _body := _body || ' · ' || new.failed_count::text || ' failed';
    end if;
  end if;
  _body := left(_body, 180);

  perform public.hotelcare_dispatch_push(
    _users,
    _title,
    _body,
    '/' || _org || '?tab=revenue',
    'revenue-automation-' || _hotel,
    'revenue_automation',
    jsonb_build_object(
      'hotelId', new.hotel_id,
      'notificationId', new.id,
      'automationRunId', new.automation_run_id,
      'pushedCount', new.pushed_count,
      'failedCount', new.failed_count,
      'severity', new.severity
    )
  );

  return new;
end;
$$;

drop trigger if exists hotelcare_push_revenue_automation on public.revenue_automation_notifications;
create trigger hotelcare_push_revenue_automation
after insert on public.revenue_automation_notifications
for each row execute function public.hotelcare_notify_revenue_automation();

-- Material housekeeping automation problems for managers.
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
  if tg_op = 'UPDATE' and old.status is not distinct from new.status then
    return new;
  end if;

  _org := coalesce(new.organization_slug, 'rdhotels');
  _hotel := new.hotel_id::text;

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

drop trigger if exists hotelcare_push_housekeeping_alert on public.housekeeping_automation_alerts;
create trigger hotelcare_push_housekeeping_alert
after insert or update of status on public.housekeeping_automation_alerts
for each row execute function public.hotelcare_notify_housekeeping_alert();
