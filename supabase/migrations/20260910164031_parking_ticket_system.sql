-- Parking ticket inventory and issue workflow.
--
-- This module is intentionally isolated from maintenance tickets. Inventory
-- mutations are only available through the atomic functions below; the API
-- role receives SELECT access to the tables and EXECUTE access to the vetted
-- functions. Every issued-ticket mutation writes an audit event in the same
-- transaction.

create table public.parking_settings (
  id uuid primary key default gen_random_uuid(),
  organization_slug text not null,
  hotel_id text not null,
  provider_name text not null default 'Done Park',
  notification_emails text[] not null default '{}'::text[],
  default_validity_days integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint parking_settings_scope_unique unique (organization_slug, hotel_id),
  constraint parking_settings_provider_name_check
    check (char_length(btrim(provider_name)) between 1 and 100),
  constraint parking_settings_default_validity_days_check
    check (default_validity_days between 1 and 90)
);

create table public.parking_batches (
  id uuid primary key default gen_random_uuid(),
  organization_slug text not null,
  hotel_id text not null,
  range_start text not null,
  range_end text not null,
  range_prefix text not null,
  first_number bigint not null,
  last_number bigint not null,
  number_width integer not null,
  ticket_count integer not null,
  expires_on date,
  label text,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete restrict,
  constraint parking_batches_numbers_check check (first_number <= last_number),
  constraint parking_batches_width_check check (number_width between 1 and 20),
  constraint parking_batches_count_check check (ticket_count between 1 and 2000),
  constraint parking_batches_label_check check (label is null or char_length(label) <= 200)
);

create table public.parking_tickets (
  id uuid primary key default gen_random_uuid(),
  organization_slug text not null,
  hotel_id text not null,
  batch_id uuid not null references public.parking_batches(id) on delete cascade,
  reference text not null,
  reference_search text generated always as
    (regexp_replace(lower(reference), '[^a-z0-9]', '', 'g')) stored,
  status text not null default 'available',
  expires_on date,
  issued_at timestamptz,
  issued_by uuid references auth.users(id) on delete set null,
  valid_from date,
  valid_to date,
  reservation_ref text,
  reservation_search text generated always as
    (regexp_replace(lower(coalesce(reservation_ref, '')), '[^a-z0-9]', '', 'g')) stored,
  guest_name text,
  room_number text,
  notes text,
  voided_at timestamptz,
  voided_by uuid references auth.users(id) on delete set null,
  void_reason text,
  cancellation_reported_at timestamptz,
  cancellation_reported_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint parking_tickets_reference_unique
    unique (organization_slug, hotel_id, reference_search),
  constraint parking_tickets_status_check
    check (status in ('available', 'issued', 'void')),
  constraint parking_tickets_reference_check
    check (char_length(btrim(reference)) between 1 and 100 and reference_search <> ''),
  constraint parking_tickets_validity_check
    check (valid_from is null or valid_to is null or valid_to >= valid_from),
  constraint parking_tickets_reservation_check
    check (reservation_ref is null or char_length(reservation_ref) <= 200),
  constraint parking_tickets_guest_name_check
    check (guest_name is null or char_length(guest_name) <= 200),
  constraint parking_tickets_room_check
    check (room_number is null or char_length(room_number) <= 50),
  constraint parking_tickets_notes_check
    check (notes is null or char_length(notes) <= 1000),
  constraint parking_tickets_void_reason_check
    check (void_reason is null or char_length(void_reason) <= 500),
  constraint parking_tickets_state_check check (
    (status = 'available'
      and issued_at is null and issued_by is null
      and valid_from is null and valid_to is null
      and voided_at is null and voided_by is null)
    or
    (status = 'issued'
      and issued_at is not null and valid_from is not null and valid_to is not null
      and voided_at is null and voided_by is null)
    or
    (status = 'void'
      and issued_at is not null and valid_from is not null and valid_to is not null
      and voided_at is not null
      and nullif(btrim(void_reason), '') is not null)
  )
);

create table public.parking_ticket_events (
  id uuid primary key default gen_random_uuid(),
  organization_slug text not null,
  hotel_id text not null,
  ticket_id uuid not null references public.parking_tickets(id) on delete cascade,
  event_type text not null,
  actor_id uuid references auth.users(id) on delete set null,
  actor_name text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint parking_ticket_events_type_check
    check (event_type in ('issued', 'updated', 'voided', 'cancellation_reported', 'cancellation_reopened')),
  constraint parking_ticket_events_actor_name_check
    check (char_length(btrim(actor_name)) between 1 and 200),
  constraint parking_ticket_events_details_check
    check (jsonb_typeof(details) = 'object')
);

create table public.parking_user_access (
  id uuid primary key default gen_random_uuid(),
  organization_slug text not null,
  hotel_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  access_level text not null,
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint parking_user_access_scope_unique
    unique (organization_slug, hotel_id, user_id),
  constraint parking_user_access_level_check
    check (access_level in ('issue', 'manage'))
);

create index parking_batches_scope_created_idx
  on public.parking_batches (organization_slug, hotel_id, created_at desc);
create index parking_tickets_scope_status_idx
  on public.parking_tickets (organization_slug, hotel_id, status, updated_at desc);
create index parking_tickets_scope_issued_idx
  on public.parking_tickets (organization_slug, hotel_id, issued_at desc)
  where issued_at is not null;
create index parking_tickets_reservation_prefix_idx
  on public.parking_tickets
  (organization_slug, hotel_id, reservation_search text_pattern_ops)
  where reservation_search <> '';
create index parking_events_ticket_created_idx
  on public.parking_ticket_events (ticket_id, created_at desc);
create index parking_access_user_scope_idx
  on public.parking_user_access (user_id, organization_slug, hotel_id);

create or replace function public.parking_normalize_reference(_value text)
returns text
language sql
immutable
parallel safe
set search_path = public
as $$
  select regexp_replace(lower(coalesce(_value, '')), '[^a-z0-9]', '', 'g')
$$;

create or replace function public.parking_access_level(
  _organization_slug text,
  _hotel_id text
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role public.user_role;
  v_org text;
  v_super boolean;
  v_grant text;
begin
  if v_uid is null or nullif(btrim(_organization_slug), '') is null
     or nullif(btrim(_hotel_id), '') is null then
    return 'none';
  end if;

  if not exists (
    select 1
    from public.hotel_configurations h
    join public.organizations o on o.id = h.organization_id
    where h.hotel_id = _hotel_id
      and o.slug = _organization_slug
      and coalesce(h.is_active, true)
  ) then
    return 'none';
  end if;

  select p.role, p.organization_slug, coalesce(p.is_super_admin, false)
    into v_role, v_org, v_super
  from public.profiles p
  where p.id = v_uid and p.deleted_at is null;

  if not found or (not v_super and v_org is distinct from _organization_slug) then
    return 'none';
  end if;

  if not v_super and not public.user_can_access_hotel(v_uid, _hotel_id) then
    return 'none';
  end if;

  if v_super or v_role in (
    'admin'::public.user_role,
    'top_management'::public.user_role,
    'top_management_manager'::public.user_role,
    'manager'::public.user_role,
    'reception_manager'::public.user_role,
    'back_office_manager'::public.user_role
  ) then
    return 'manage';
  end if;

  if v_role in ('reception'::public.user_role, 'front_office'::public.user_role) then
    return 'issue';
  end if;

  select a.access_level into v_grant
  from public.parking_user_access a
  where a.organization_slug = _organization_slug
    and a.hotel_id = _hotel_id
    and a.user_id = v_uid;

  return coalesce(v_grant, 'none');
end;
$$;

alter table public.parking_settings enable row level security;
alter table public.parking_batches enable row level security;
alter table public.parking_tickets enable row level security;
alter table public.parking_ticket_events enable row level security;
alter table public.parking_user_access enable row level security;

create policy parking_settings_select
on public.parking_settings for select to authenticated
using (public.parking_access_level(organization_slug, hotel_id) <> 'none');

create policy parking_batches_select
on public.parking_batches for select to authenticated
using (public.parking_access_level(organization_slug, hotel_id) <> 'none');

create policy parking_tickets_select
on public.parking_tickets for select to authenticated
using (public.parking_access_level(organization_slug, hotel_id) <> 'none');

create policy parking_events_select
on public.parking_ticket_events for select to authenticated
using (public.parking_access_level(organization_slug, hotel_id) <> 'none');

create policy parking_access_select
on public.parking_user_access for select to authenticated
using (public.parking_access_level(organization_slug, hotel_id) = 'manage');

revoke all on table public.parking_settings from anon, authenticated;
revoke all on table public.parking_batches from anon, authenticated;
revoke all on table public.parking_tickets from anon, authenticated;
revoke all on table public.parking_ticket_events from anon, authenticated;
revoke all on table public.parking_user_access from anon, authenticated;

grant select on table public.parking_settings to authenticated;
grant select on table public.parking_batches to authenticated;
grant select on table public.parking_tickets to authenticated;
grant select on table public.parking_ticket_events to authenticated;
grant select on table public.parking_user_access to authenticated;
grant all on table public.parking_settings to service_role;
grant all on table public.parking_batches to service_role;
grant all on table public.parking_tickets to service_role;
grant all on table public.parking_ticket_events to service_role;
grant all on table public.parking_user_access to service_role;

create or replace function public.parking_save_settings(
  _organization_slug text,
  _hotel_id text,
  _provider_name text,
  _notification_emails text[],
  _default_validity_days integer
)
returns public.parking_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_settings public.parking_settings%rowtype;
  v_emails text[];
  v_invalid_email text;
begin
  if v_uid is null or public.parking_access_level(_organization_slug, _hotel_id) <> 'manage' then
    raise exception 'You do not have permission to manage parking settings' using errcode = '42501';
  end if;

  if char_length(btrim(coalesce(_provider_name, ''))) not between 1 and 100 then
    raise exception 'Provider name must be between 1 and 100 characters';
  end if;
  if _default_validity_days not between 1 and 90 then
    raise exception 'Default validity must be between 1 and 90 days';
  end if;

  select min(btrim(email)) into v_invalid_email
  from unnest(coalesce(_notification_emails, '{}'::text[])) as email
  where btrim(email) !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$';
  if v_invalid_email is not null then
    raise exception 'Invalid notification email: %', v_invalid_email;
  end if;

  select coalesce(array_agg(distinct lower(btrim(email)) order by lower(btrim(email))), '{}'::text[])
    into v_emails
  from unnest(coalesce(_notification_emails, '{}'::text[])) as email
  where nullif(btrim(email), '') is not null;

  insert into public.parking_settings (
    organization_slug, hotel_id, provider_name, notification_emails,
    default_validity_days, updated_by
  ) values (
    _organization_slug, _hotel_id, btrim(_provider_name), v_emails,
    _default_validity_days, v_uid
  )
  on conflict (organization_slug, hotel_id) do update set
    provider_name = excluded.provider_name,
    notification_emails = excluded.notification_emails,
    default_validity_days = excluded.default_validity_days,
    updated_at = now(),
    updated_by = v_uid
  returning * into v_settings;

  return v_settings;
end;
$$;

create or replace function public.parking_create_batch(
  _organization_slug text,
  _hotel_id text,
  _range_start text,
  _range_end text,
  _expires_on date,
  _label text default null
)
returns public.parking_batches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_start text := btrim(coalesce(_range_start, ''));
  v_end text := btrim(coalesce(_range_end, ''));
  v_start_digits text;
  v_end_digits text;
  v_prefix text;
  v_end_prefix text;
  v_first bigint;
  v_last bigint;
  v_width integer;
  v_count integer;
  v_conflicts integer;
  v_first_conflict text;
  v_batch public.parking_batches%rowtype;
begin
  if v_uid is null or public.parking_access_level(_organization_slug, _hotel_id) <> 'manage' then
    raise exception 'You do not have permission to manage parking inventory' using errcode = '42501';
  end if;

  if char_length(v_start) not between 1 and 100 or char_length(v_end) not between 1 and 100 then
    raise exception 'Enter a valid first and last ticket reference';
  end if;

  v_start_digits := substring(v_start from '([0-9]+)$');
  v_end_digits := substring(v_end from '([0-9]+)$');
  if v_start_digits is null or v_end_digits is null
     or char_length(v_start_digits) > 18 or char_length(v_end_digits) > 18 then
    raise exception 'Ticket references must end with a number of up to 18 digits';
  end if;

  v_prefix := left(v_start, char_length(v_start) - char_length(v_start_digits));
  v_end_prefix := left(v_end, char_length(v_end) - char_length(v_end_digits));
  if v_end_prefix = '' then
    v_end_prefix := v_prefix;
  end if;
  if v_end_prefix is distinct from v_prefix then
    raise exception 'The first and last ticket references must use the same prefix';
  end if;

  v_first := v_start_digits::bigint;
  v_last := v_end_digits::bigint;
  v_width := greatest(char_length(v_start_digits), char_length(v_end_digits));
  if v_last < v_first then
    raise exception 'The last ticket number must be greater than or equal to the first';
  end if;

  if (v_last - v_first + 1) not between 1 and 2000 then
    raise exception 'A ticket batch must contain between 1 and 2000 tickets';
  end if;
  v_count := (v_last - v_first + 1)::integer;
  if _expires_on is not null and _expires_on < (now() at time zone 'Europe/Budapest')::date then
    raise exception 'The batch expiry date cannot be in the past';
  end if;
  if _label is not null and char_length(_label) > 200 then
    raise exception 'Batch label cannot exceed 200 characters';
  end if;

  -- Serialize inventory creation for this hotel. The unique constraint remains
  -- the final guard, but the lock lets us return a clear all-or-nothing error.
  perform pg_advisory_xact_lock(hashtextextended(_organization_slug || ':' || _hotel_id, 0));

  select count(*)::integer, min(t.reference)
    into v_conflicts, v_first_conflict
  from generate_series(v_first, v_last) as number
  join public.parking_tickets t
    on t.organization_slug = _organization_slug
   and t.hotel_id = _hotel_id
   and t.reference_search = public.parking_normalize_reference(
     v_prefix || lpad(number::text, v_width, '0')
   );

  if v_conflicts > 0 then
    raise exception 'This range overlaps % existing ticket(s), starting with %',
      v_conflicts, v_first_conflict using errcode = '23505';
  end if;

  insert into public.parking_batches (
    organization_slug, hotel_id, range_start, range_end, range_prefix,
    first_number, last_number, number_width, ticket_count, expires_on,
    label, created_by
  ) values (
    _organization_slug, _hotel_id,
    v_prefix || lpad(v_first::text, v_width, '0'),
    v_prefix || lpad(v_last::text, v_width, '0'),
    v_prefix, v_first, v_last, v_width, v_count, _expires_on,
    nullif(btrim(_label), ''), v_uid
  ) returning * into v_batch;

  insert into public.parking_tickets (
    organization_slug, hotel_id, batch_id, reference, expires_on
  )
  select _organization_slug, _hotel_id, v_batch.id,
    v_prefix || lpad(number::text, v_width, '0'), _expires_on
  from generate_series(v_first, v_last) as number;

  return v_batch;
end;
$$;

create or replace function public.parking_delete_batch(_batch_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch public.parking_batches%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into v_batch
  from public.parking_batches
  where id = _batch_id
  for update;
  if not found then
    raise exception 'Parking batch not found';
  end if;
  if public.parking_access_level(v_batch.organization_slug, v_batch.hotel_id) <> 'manage' then
    raise exception 'You do not have permission to manage parking inventory' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.parking_tickets
    where batch_id = _batch_id and status <> 'available'
  ) then
    raise exception 'This batch cannot be deleted because one or more tickets have already been used';
  end if;

  delete from public.parking_batches where id = _batch_id;
end;
$$;

create or replace function public.parking_issue_ticket(
  _organization_slug text,
  _hotel_id text,
  _reference text,
  _valid_from date,
  _valid_to date,
  _reservation_ref text default null,
  _guest_name text default null,
  _room_number text default null,
  _notes text default null
)
returns public.parking_tickets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_ticket public.parking_tickets%rowtype;
  v_actor_name text;
  v_reservation text := nullif(btrim(_reservation_ref), '');
  v_guest text := nullif(btrim(_guest_name), '');
  v_room text := nullif(btrim(_room_number), '');
begin
  if v_uid is null or public.parking_access_level(_organization_slug, _hotel_id) = 'none' then
    raise exception 'You do not have permission to issue parking tickets' using errcode = '42501';
  end if;
  if public.parking_normalize_reference(_reference) = '' then
    raise exception 'Enter a ticket reference';
  end if;
  if _valid_from is null or _valid_to is null or _valid_to < _valid_from then
    raise exception 'Enter a valid date range';
  end if;
  if (_valid_to - _valid_from) > 89 then
    raise exception 'A parking ticket can be valid for at most 90 days';
  end if;
  if v_reservation is null and v_guest is null and v_room is null then
    raise exception 'Add a reservation number, guest name, or room number';
  end if;
  if char_length(coalesce(_notes, '')) > 1000 then
    raise exception 'Notes cannot exceed 1000 characters';
  end if;

  select * into v_ticket
  from public.parking_tickets
  where organization_slug = _organization_slug
    and hotel_id = _hotel_id
    and reference_search = public.parking_normalize_reference(_reference)
  for update;
  if not found then
    raise exception 'Ticket % is not in this hotel inventory', btrim(_reference);
  end if;
  if v_ticket.status <> 'available' then
    raise exception 'Ticket % is already %', v_ticket.reference, v_ticket.status;
  end if;
  if v_ticket.expires_on is not null and v_ticket.expires_on < _valid_to then
    raise exception 'Ticket % expires on %', v_ticket.reference, v_ticket.expires_on;
  end if;

  select coalesce(nullif(btrim(p.full_name), ''), p.email, v_uid::text)
    into v_actor_name
  from public.profiles p where p.id = v_uid;

  update public.parking_tickets set
    status = 'issued',
    issued_at = now(),
    issued_by = v_uid,
    valid_from = _valid_from,
    valid_to = _valid_to,
    reservation_ref = v_reservation,
    guest_name = v_guest,
    room_number = v_room,
    notes = nullif(btrim(_notes), ''),
    updated_at = now(),
    updated_by = v_uid
  where id = v_ticket.id
  returning * into v_ticket;

  insert into public.parking_ticket_events (
    organization_slug, hotel_id, ticket_id, event_type,
    actor_id, actor_name, details
  ) values (
    v_ticket.organization_slug, v_ticket.hotel_id, v_ticket.id, 'issued',
    v_uid, coalesce(v_actor_name, v_uid::text),
    jsonb_build_object(
      'reference', v_ticket.reference,
      'valid_from', v_ticket.valid_from,
      'valid_to', v_ticket.valid_to,
      'reservation_ref', v_ticket.reservation_ref,
      'guest_name', v_ticket.guest_name,
      'room_number', v_ticket.room_number
    )
  );

  return v_ticket;
end;
$$;

create or replace function public.parking_update_ticket(
  _ticket_id uuid,
  _valid_from date,
  _valid_to date,
  _reservation_ref text default null,
  _guest_name text default null,
  _room_number text default null,
  _notes text default null
)
returns public.parking_tickets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_before public.parking_tickets%rowtype;
  v_ticket public.parking_tickets%rowtype;
  v_actor_name text;
  v_reservation text := nullif(btrim(_reservation_ref), '');
  v_guest text := nullif(btrim(_guest_name), '');
  v_room text := nullif(btrim(_room_number), '');
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into v_before
  from public.parking_tickets
  where id = _ticket_id
  for update;
  if not found then
    raise exception 'Parking ticket not found';
  end if;
  if public.parking_access_level(v_before.organization_slug, v_before.hotel_id) = 'none' then
    raise exception 'You do not have permission to update this parking ticket' using errcode = '42501';
  end if;
  if v_before.status <> 'issued' then
    raise exception 'Only issued tickets can be updated';
  end if;
  if v_before.cancellation_reported_at is not null then
    raise exception 'Reopen the cancellation record before changing this ticket';
  end if;
  if _valid_from is null or _valid_to is null or _valid_to < _valid_from then
    raise exception 'Enter a valid date range';
  end if;
  if (_valid_to - _valid_from) > 89 then
    raise exception 'A parking ticket can be valid for at most 90 days';
  end if;
  if v_before.expires_on is not null and v_before.expires_on < _valid_to then
    raise exception 'Ticket % expires on %', v_before.reference, v_before.expires_on;
  end if;
  if v_reservation is null and v_guest is null and v_room is null then
    raise exception 'Add a reservation number, guest name, or room number';
  end if;
  if char_length(coalesce(_notes, '')) > 1000 then
    raise exception 'Notes cannot exceed 1000 characters';
  end if;

  select coalesce(nullif(btrim(p.full_name), ''), p.email, v_uid::text)
    into v_actor_name
  from public.profiles p where p.id = v_uid;

  update public.parking_tickets set
    valid_from = _valid_from,
    valid_to = _valid_to,
    reservation_ref = v_reservation,
    guest_name = v_guest,
    room_number = v_room,
    notes = nullif(btrim(_notes), ''),
    updated_at = now(),
    updated_by = v_uid
  where id = v_before.id
  returning * into v_ticket;

  insert into public.parking_ticket_events (
    organization_slug, hotel_id, ticket_id, event_type,
    actor_id, actor_name, details
  ) values (
    v_ticket.organization_slug, v_ticket.hotel_id, v_ticket.id, 'updated',
    v_uid, coalesce(v_actor_name, v_uid::text),
    jsonb_build_object(
      'before', jsonb_build_object(
        'valid_from', v_before.valid_from, 'valid_to', v_before.valid_to,
        'reservation_ref', v_before.reservation_ref, 'guest_name', v_before.guest_name,
        'room_number', v_before.room_number, 'notes', v_before.notes
      ),
      'after', jsonb_build_object(
        'valid_from', v_ticket.valid_from, 'valid_to', v_ticket.valid_to,
        'reservation_ref', v_ticket.reservation_ref, 'guest_name', v_ticket.guest_name,
        'room_number', v_ticket.room_number, 'notes', v_ticket.notes
      )
    )
  );

  return v_ticket;
end;
$$;

create or replace function public.parking_void_ticket(
  _ticket_id uuid,
  _reason text
)
returns public.parking_tickets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_ticket public.parking_tickets%rowtype;
  v_actor_name text;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into v_ticket
  from public.parking_tickets
  where id = _ticket_id
  for update;
  if not found then
    raise exception 'Parking ticket not found';
  end if;
  if public.parking_access_level(v_ticket.organization_slug, v_ticket.hotel_id) <> 'manage' then
    raise exception 'You do not have permission to void parking tickets' using errcode = '42501';
  end if;
  if v_ticket.status <> 'issued' then
    raise exception 'Only issued tickets can be voided';
  end if;
  if v_ticket.cancellation_reported_at is not null then
    raise exception 'Reopen the cancellation record before voiding this ticket';
  end if;
  if char_length(btrim(coalesce(_reason, ''))) not between 3 and 500 then
    raise exception 'Enter a void reason between 3 and 500 characters';
  end if;

  select coalesce(nullif(btrim(p.full_name), ''), p.email, v_uid::text)
    into v_actor_name
  from public.profiles p where p.id = v_uid;

  update public.parking_tickets set
    status = 'void',
    voided_at = now(),
    voided_by = v_uid,
    void_reason = btrim(_reason),
    updated_at = now(),
    updated_by = v_uid
  where id = v_ticket.id
  returning * into v_ticket;

  insert into public.parking_ticket_events (
    organization_slug, hotel_id, ticket_id, event_type,
    actor_id, actor_name, details
  ) values (
    v_ticket.organization_slug, v_ticket.hotel_id, v_ticket.id, 'voided',
    v_uid, coalesce(v_actor_name, v_uid::text),
    jsonb_build_object('reason', v_ticket.void_reason)
  );

  return v_ticket;
end;
$$;

create or replace function public.parking_set_cancellation_reported(
  _ticket_id uuid,
  _reported boolean
)
returns public.parking_tickets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_ticket public.parking_tickets%rowtype;
  v_actor_name text;
  v_event_type text;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into v_ticket
  from public.parking_tickets
  where id = _ticket_id
  for update;
  if not found then
    raise exception 'Parking ticket not found';
  end if;
  if public.parking_access_level(v_ticket.organization_slug, v_ticket.hotel_id) <> 'manage' then
    raise exception 'You do not have permission to manage cancellation records' using errcode = '42501';
  end if;
  if v_ticket.status <> 'issued'
     or v_ticket.valid_to >= (now() at time zone 'Europe/Budapest')::date then
    raise exception 'Only expired issued tickets can be marked as reported';
  end if;
  if _reported and v_ticket.cancellation_reported_at is not null then
    return v_ticket;
  end if;
  if not _reported and v_ticket.cancellation_reported_at is null then
    return v_ticket;
  end if;

  select coalesce(nullif(btrim(p.full_name), ''), p.email, v_uid::text)
    into v_actor_name
  from public.profiles p where p.id = v_uid;
  v_event_type := case when _reported then 'cancellation_reported' else 'cancellation_reopened' end;

  update public.parking_tickets set
    cancellation_reported_at = case when _reported then now() else null end,
    cancellation_reported_by = case when _reported then v_uid else null end,
    updated_at = now(),
    updated_by = v_uid
  where id = v_ticket.id
  returning * into v_ticket;

  insert into public.parking_ticket_events (
    organization_slug, hotel_id, ticket_id, event_type,
    actor_id, actor_name, details
  ) values (
    v_ticket.organization_slug, v_ticket.hotel_id, v_ticket.id, v_event_type,
    v_uid, coalesce(v_actor_name, v_uid::text), '{}'::jsonb
  );

  return v_ticket;
end;
$$;

create or replace function public.parking_search_tickets(
  _organization_slug text,
  _hotel_id text,
  _query text default '',
  _status text default 'all',
  _limit integer default 100
)
returns setof public.parking_tickets
language sql
stable
security invoker
set search_path = public
as $$
  select t.*
  from public.parking_tickets t
  where t.organization_slug = _organization_slug
    and t.hotel_id = _hotel_id
    and public.parking_access_level(t.organization_slug, t.hotel_id) <> 'none'
    and (
      public.parking_normalize_reference(_query) = ''
      or t.reference_search like '%' || public.parking_normalize_reference(_query) || '%'
      or t.reservation_search like '%' || public.parking_normalize_reference(_query) || '%'
      or lower(coalesce(t.guest_name, '')) like '%' || lower(btrim(_query)) || '%'
      or lower(coalesce(t.room_number, '')) like '%' || lower(btrim(_query)) || '%'
    )
    and case _status
      when 'available' then t.status = 'available'
      when 'issued' then t.status = 'issued' and t.valid_to >= (now() at time zone 'Europe/Budapest')::date
      when 'expired' then t.status = 'issued' and t.valid_to < (now() at time zone 'Europe/Budapest')::date
      when 'void' then t.status = 'void'
      else true
    end
  order by
    case
      when t.reference_search = public.parking_normalize_reference(_query) then 0
      when t.reservation_search = public.parking_normalize_reference(_query) then 1
      else 2
    end,
    t.updated_at desc
  limit least(greatest(coalesce(_limit, 100), 1), 250)
$$;

create or replace function public.parking_stock_summary(
  _organization_slug text,
  _hotel_id text
)
returns table (
  total bigint,
  available bigint,
  active bigint,
  expired bigint,
  void bigint,
  unreported_expired bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    count(*)::bigint,
    count(*) filter (where t.status = 'available')::bigint,
    count(*) filter (where t.status = 'issued' and t.valid_to >= (now() at time zone 'Europe/Budapest')::date)::bigint,
    count(*) filter (where t.status = 'issued' and t.valid_to < (now() at time zone 'Europe/Budapest')::date)::bigint,
    count(*) filter (where t.status = 'void')::bigint,
    count(*) filter (
      where t.status = 'issued' and t.valid_to < (now() at time zone 'Europe/Budapest')::date
        and t.cancellation_reported_at is null
    )::bigint
  from public.parking_tickets t
  where t.organization_slug = _organization_slug
    and t.hotel_id = _hotel_id
    and public.parking_access_level(t.organization_slug, t.hotel_id) <> 'none'
$$;

create or replace function public.parking_list_batches(
  _organization_slug text,
  _hotel_id text
)
returns table (
  id uuid,
  range_start text,
  range_end text,
  ticket_count integer,
  expires_on date,
  label text,
  created_at timestamptz,
  created_by uuid,
  available bigint,
  issued bigint,
  void bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    b.id, b.range_start, b.range_end, b.ticket_count, b.expires_on,
    b.label, b.created_at, b.created_by,
    count(t.id) filter (where t.status = 'available')::bigint as available,
    count(t.id) filter (where t.status = 'issued')::bigint as issued,
    count(t.id) filter (where t.status = 'void')::bigint as void
  from public.parking_batches b
  left join public.parking_tickets t on t.batch_id = b.id
  where b.organization_slug = _organization_slug
    and b.hotel_id = _hotel_id
    and public.parking_access_level(b.organization_slug, b.hotel_id) <> 'none'
  group by b.id
  order by b.created_at desc
$$;

create or replace function public.parking_list_users(
  _organization_slug text,
  _hotel_id text
)
returns table (
  user_id uuid,
  full_name text,
  email text,
  role text,
  role_access text,
  granted_access text,
  effective_access text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.parking_access_level(_organization_slug, _hotel_id) <> 'manage' then
    raise exception 'You do not have permission to manage parking access' using errcode = '42501';
  end if;

  return query
  select
    p.id,
    p.full_name,
    p.email,
    p.role::text,
    case
      when coalesce(p.is_super_admin, false) or p.role in (
        'admin'::public.user_role, 'top_management'::public.user_role,
        'top_management_manager'::public.user_role, 'manager'::public.user_role,
        'reception_manager'::public.user_role, 'back_office_manager'::public.user_role
      ) then 'manage'
      when p.role in ('reception'::public.user_role, 'front_office'::public.user_role) then 'issue'
      else 'none'
    end as role_access,
    coalesce(a.access_level, 'none') as granted_access,
    case
      when coalesce(p.is_super_admin, false) or p.role in (
        'admin'::public.user_role, 'top_management'::public.user_role,
        'top_management_manager'::public.user_role, 'manager'::public.user_role,
        'reception_manager'::public.user_role, 'back_office_manager'::public.user_role
      ) then 'manage'
      when p.role in ('reception'::public.user_role, 'front_office'::public.user_role) then 'issue'
      else coalesce(a.access_level, 'none')
    end as effective_access
  from public.profiles p
  left join public.parking_user_access a
    on a.user_id = p.id
   and a.organization_slug = _organization_slug
   and a.hotel_id = _hotel_id
  where p.deleted_at is null
    and p.organization_slug = _organization_slug
    and public.user_can_access_hotel(p.id, _hotel_id)
  order by p.full_name, p.email;
end;
$$;

create or replace function public.parking_set_user_access(
  _organization_slug text,
  _hotel_id text,
  _user_id uuid,
  _access_level text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or public.parking_access_level(_organization_slug, _hotel_id) <> 'manage' then
    raise exception 'You do not have permission to manage parking access' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = _user_id
      and p.deleted_at is null
      and p.organization_slug = _organization_slug
      and public.user_can_access_hotel(p.id, _hotel_id)
  ) then
    raise exception 'The selected user does not belong to this hotel';
  end if;
  if _access_level not in ('none', 'issue', 'manage') then
    raise exception 'Invalid parking access level';
  end if;

  if _access_level = 'none' then
    delete from public.parking_user_access
    where organization_slug = _organization_slug
      and hotel_id = _hotel_id
      and user_id = _user_id;
  else
    insert into public.parking_user_access (
      organization_slug, hotel_id, user_id, access_level, granted_by
    ) values (
      _organization_slug, _hotel_id, _user_id, _access_level, v_uid
    )
    on conflict (organization_slug, hotel_id, user_id) do update set
      access_level = excluded.access_level,
      granted_by = v_uid,
      updated_at = now();
  end if;

  return jsonb_build_object('user_id', _user_id, 'access_level', _access_level);
end;
$$;

revoke all on function public.parking_normalize_reference(text) from public, anon;
revoke all on function public.parking_access_level(text, text) from public, anon;
revoke all on function public.parking_save_settings(text, text, text, text[], integer) from public, anon;
revoke all on function public.parking_create_batch(text, text, text, text, date, text) from public, anon;
revoke all on function public.parking_delete_batch(uuid) from public, anon;
revoke all on function public.parking_issue_ticket(text, text, text, date, date, text, text, text, text) from public, anon;
revoke all on function public.parking_update_ticket(uuid, date, date, text, text, text, text) from public, anon;
revoke all on function public.parking_void_ticket(uuid, text) from public, anon;
revoke all on function public.parking_set_cancellation_reported(uuid, boolean) from public, anon;
revoke all on function public.parking_search_tickets(text, text, text, text, integer) from public, anon;
revoke all on function public.parking_stock_summary(text, text) from public, anon;
revoke all on function public.parking_list_batches(text, text) from public, anon;
revoke all on function public.parking_list_users(text, text) from public, anon;
revoke all on function public.parking_set_user_access(text, text, uuid, text) from public, anon;

grant execute on function public.parking_normalize_reference(text) to authenticated, service_role;
grant execute on function public.parking_access_level(text, text) to authenticated, service_role;
grant execute on function public.parking_save_settings(text, text, text, text[], integer) to authenticated, service_role;
grant execute on function public.parking_create_batch(text, text, text, text, date, text) to authenticated, service_role;
grant execute on function public.parking_delete_batch(uuid) to authenticated, service_role;
grant execute on function public.parking_issue_ticket(text, text, text, date, date, text, text, text, text) to authenticated, service_role;
grant execute on function public.parking_update_ticket(uuid, date, date, text, text, text, text) to authenticated, service_role;
grant execute on function public.parking_void_ticket(uuid, text) to authenticated, service_role;
grant execute on function public.parking_set_cancellation_reported(uuid, boolean) to authenticated, service_role;
grant execute on function public.parking_search_tickets(text, text, text, text, integer) to authenticated, service_role;
grant execute on function public.parking_stock_summary(text, text) to authenticated, service_role;
grant execute on function public.parking_list_batches(text, text) to authenticated, service_role;
grant execute on function public.parking_list_users(text, text) to authenticated, service_role;
grant execute on function public.parking_set_user_access(text, text, uuid, text) to authenticated, service_role;
