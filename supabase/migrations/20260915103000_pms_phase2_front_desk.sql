-- HotelCare PMS Phase 2: Reservations v2 + Front Desk.
-- This migration keeps Previo authoritative for imported bookings during dual-run.
-- HotelCare-native manual reservations are managed through SECURITY DEFINER RPCs;
-- authenticated browser clients still receive no direct table write policies.

create table if not exists public.pms_property_settings (
  organization_slug text not null,
  hotel_id text not null,
  default_check_in time not null default '15:00',
  default_check_out time not null default '10:00',
  currency text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (organization_slug, hotel_id)
);

alter table public.pms_property_settings enable row level security;

create or replace function public.pms_user_can_access_hotel(
  p_organization_slug text,
  p_hotel_id text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.deleted_at is null
      and p.organization_slug = p_organization_slug
      and p.role in (
        'reception', 'front_office', 'manager', 'admin', 'top_management',
        'top_management_manager', 'reception_manager', 'back_office_manager',
        'housekeeping_manager', 'supervisor'
      )
      and (
        coalesce(p.is_super_admin, false)
        or p.role in ('admin', 'top_management')
        or p.assigned_hotel = p_hotel_id
        or exists (
          select 1
          from public.hotel_configurations hc
          where (hc.hotel_id = p_hotel_id or hc.hotel_name = p_hotel_id)
            and (hc.hotel_id = p.assigned_hotel or hc.hotel_name = p.assigned_hotel)
        )
      )
  );
$$;

create or replace function public.pms_user_can_manage_reservations(
  p_organization_slug text,
  p_hotel_id text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.deleted_at is null
      and p.organization_slug = p_organization_slug
      and p.role in (
        'reception', 'front_office', 'manager', 'admin', 'top_management',
        'top_management_manager', 'reception_manager', 'back_office_manager',
        'supervisor'
      )
      and public.pms_user_can_access_hotel(p_organization_slug, p_hotel_id)
  );
$$;

create or replace function public.pms_get_front_desk_feed(
  p_organization_slug text,
  p_hotel_id text,
  p_start_date date,
  p_end_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_reservations jsonb;
  v_rooms jsonb;
  v_snapshots jsonb;
  v_settings jsonb;
begin
  if not public.pms_user_can_access_hotel(p_organization_slug, p_hotel_id) then
    raise exception 'PMS access denied';
  end if;

  if p_end_date <= p_start_date or (p_end_date - p_start_date) > 62 then
    raise exception 'Invalid PMS board date window';
  end if;

  select coalesce(jsonb_agg(row_data order by row_data->>'arrival_date'), '[]'::jsonb)
  into v_reservations
  from (
    select jsonb_build_object(
      'id', r.id,
      'organization_slug', r.organization_slug,
      'hotel_id', r.hotel_id,
      'source_system', r.source_system,
      'source_channel', r.source_channel,
      'external_reservation_id', r.external_reservation_id,
      'confirmation_code', r.confirmation_code,
      'status', r.status,
      'arrival_date', r.arrival_date,
      'departure_date', r.departure_date,
      'adults', r.adults,
      'children', r.children,
      'primary_guest_name', r.primary_guest_name,
      'primary_guest_email', r.primary_guest_email,
      'primary_guest_phone', r.primary_guest_phone,
      'currency', r.currency,
      'total_amount', r.total_amount,
      'notes', r.notes,
      'created_at', r.created_at,
      'updated_at', r.updated_at,
      'rooms', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', rr.id,
          'room_type_id', rr.room_type_id,
          'room_id', rr.room_id,
          'external_room_id', rr.external_room_id,
          'adults', rr.adults,
          'children', rr.children,
          'assigned_at', rr.assigned_at,
          'nightly_rate', (
            select min(n.booked_rate_amount)
            from public.pms_reservation_nights n
            where n.reservation_room_id = rr.id
          ),
          'nightly_rate_max', (
            select max(n.booked_rate_amount)
            from public.pms_reservation_nights n
            where n.reservation_room_id = rr.id
          )
        ) order by rr.created_at)
        from public.pms_reservation_rooms rr
        where rr.reservation_id = r.id
      ), '[]'::jsonb)
    ) as row_data
    from public.pms_reservations r
    where r.organization_slug = p_organization_slug
      and r.hotel_id = p_hotel_id
      and r.arrival_date < p_end_date
      and r.departure_date > p_start_date
  ) q;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', rm.id,
    'room_number', rm.room_number,
    'room_name', rm.room_name,
    'room_type', rm.room_type,
    'room_category', rm.room_category,
    'floor_number', rm.floor_number,
    'status', rm.status,
    'is_dnd', rm.is_dnd,
    'is_checkout_room', rm.is_checkout_room
  ) order by rm.room_number), '[]'::jsonb)
  into v_rooms
  from public.rooms rm
  where rm.hotel = p_hotel_id
     or exists (
       select 1
       from public.hotel_configurations hc
       where (hc.hotel_id = p_hotel_id or hc.hotel_name = p_hotel_id)
         and (rm.hotel = hc.hotel_id or rm.hotel = hc.hotel_name)
     );

  -- Transitional read-only Previo adapter. It is deliberately separate from the
  -- canonical ledger so a snapshot can never be edited as if HotelCare owned it.
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id,
    'business_date', s.business_date,
    'room_number', s.room_number,
    'arrival_date', s.arrival_date,
    'departure_date', s.departure_date,
    'status', s.status,
    'guest_names', s.guest_names,
    'source', s.source
  ) order by s.business_date, s.room_number), '[]'::jsonb)
  into v_snapshots
  from public.daily_overview_snapshots s
  where (s.hotel_id = p_hotel_id or exists (
      select 1
      from public.hotel_configurations hc
      where (hc.hotel_id = p_hotel_id or hc.hotel_name = p_hotel_id)
        and (s.hotel_id = hc.hotel_id or s.hotel_id = hc.hotel_name)
    ))
    and s.business_date >= p_start_date
    and s.business_date < p_end_date;

  select coalesce(to_jsonb(ps), jsonb_build_object(
    'organization_slug', p_organization_slug,
    'hotel_id', p_hotel_id,
    'default_check_in', '15:00:00',
    'default_check_out', '10:00:00',
    'currency', 'EUR'
  ))
  into v_settings
  from public.pms_property_settings ps
  where ps.organization_slug = p_organization_slug
    and ps.hotel_id = p_hotel_id;

  return jsonb_build_object(
    'reservations', v_reservations,
    'rooms', v_rooms,
    'previo_snapshots', v_snapshots,
    'settings', v_settings,
    'can_manage', public.pms_user_can_manage_reservations(p_organization_slug, p_hotel_id)
  );
end;
$$;

create or replace function public.pms_create_manual_reservation(
  p_organization_slug text,
  p_hotel_id text,
  p_guest_name text,
  p_arrival_date date,
  p_departure_date date,
  p_room_id text,
  p_adults integer,
  p_children integer,
  p_nightly_rate numeric,
  p_currency text default 'EUR',
  p_guest_email text default null,
  p_guest_phone text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := gen_random_uuid();
  v_room_row_id uuid := gen_random_uuid();
  v_confirmation text;
  v_room_type text;
  v_result jsonb;
  v_nights integer;
begin
  if not public.pms_user_can_manage_reservations(p_organization_slug, p_hotel_id) then
    raise exception 'PMS reservation management denied';
  end if;

  if nullif(trim(p_guest_name), '') is null then
    raise exception 'Guest name is required';
  end if;
  if p_departure_date <= p_arrival_date then
    raise exception 'Departure date must be after arrival date';
  end if;
  if p_nightly_rate is null or p_nightly_rate < 0 then
    raise exception 'A non-negative nightly rate is required';
  end if;
  if p_adults is null or p_adults < 0 or p_children is null or p_children < 0 then
    raise exception 'Guest counts must be non-negative';
  end if;
  if p_currency !~ '^[A-Z]{3}$' then
    raise exception 'Currency must be a three-letter ISO code';
  end if;

  if nullif(p_room_id, '') is not null and exists (
    select 1
    from public.pms_reservation_rooms rr
    join public.pms_reservations r on r.id = rr.reservation_id
    where rr.organization_slug = p_organization_slug
      and rr.hotel_id = p_hotel_id
      and rr.room_id = p_room_id
      and r.status in ('tentative', 'confirmed', 'checked_in')
      and r.arrival_date < p_departure_date
      and r.departure_date > p_arrival_date
  ) then
    raise exception 'Room is already assigned to an overlapping active reservation';
  end if;

  select rm.room_type
  into v_room_type
  from public.rooms rm
  where rm.id::text = p_room_id
  limit 1;

  v_nights := p_departure_date - p_arrival_date;
  v_confirmation := 'HC-' || upper(substr(replace(v_id::text, '-', ''), 1, 8));

  insert into public.pms_reservations (
    id, organization_slug, hotel_id, source_system, source_channel,
    confirmation_code, status, arrival_date, departure_date, adults, children,
    primary_guest_name, primary_guest_email, primary_guest_phone,
    currency, total_amount, notes, created_by, updated_by
  ) values (
    v_id, p_organization_slug, p_hotel_id, 'hotelcare', 'manual',
    v_confirmation, 'confirmed', p_arrival_date, p_departure_date,
    p_adults, p_children, trim(p_guest_name), nullif(trim(p_guest_email), ''),
    nullif(trim(p_guest_phone), ''), upper(p_currency), p_nightly_rate * v_nights,
    nullif(trim(p_notes), ''), auth.uid(), auth.uid()
  );

  insert into public.pms_reservation_rooms (
    id, reservation_id, organization_slug, hotel_id, room_type_id, room_id,
    adults, children, assigned_at
  ) values (
    v_room_row_id, v_id, p_organization_slug, p_hotel_id, v_room_type,
    nullif(p_room_id, ''), p_adults, p_children,
    case when nullif(p_room_id, '') is null then null else now() end
  );

  insert into public.pms_reservation_nights (
    reservation_id, reservation_room_id, organization_slug, hotel_id,
    stay_date, booked_rate_amount, currency
  )
  select v_id, v_room_row_id, p_organization_slug, p_hotel_id,
         gs::date, p_nightly_rate, upper(p_currency)
  from generate_series(
    p_arrival_date::timestamp,
    (p_departure_date - 1)::timestamp,
    interval '1 day'
  ) gs;

  select to_jsonb(r) into v_result
  from public.pms_reservations r where r.id = v_id;

  insert into public.pms_reservation_events (
    reservation_id, organization_slug, hotel_id, event_type, actor_user_id,
    source_system, after_state, metadata
  ) values (
    v_id, p_organization_slug, p_hotel_id, 'created', auth.uid(),
    'hotelcare', v_result, jsonb_build_object('entry_point', 'front_desk_v2')
  );

  return v_result;
end;
$$;

create or replace function public.pms_update_manual_reservation(
  p_reservation_id uuid,
  p_patch jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.pms_reservations%rowtype;
  v_room public.pms_reservation_rooms%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_arrival date;
  v_departure date;
  v_room_id text;
  v_rate numeric;
  v_guest_name text;
  v_currency text;
  v_nights integer;
begin
  select * into v_old
  from public.pms_reservations
  where id = p_reservation_id
  for update;

  if not found then raise exception 'Reservation not found'; end if;
  if not public.pms_user_can_manage_reservations(v_old.organization_slug, v_old.hotel_id) then
    raise exception 'PMS reservation management denied';
  end if;
  if v_old.source_system <> 'hotelcare' then
    raise exception 'Imported reservations are read-only during PMS dual-run';
  end if;
  if v_old.status in ('checked_out', 'cancelled', 'no_show') then
    raise exception 'Terminal reservations cannot be edited';
  end if;

  select * into v_room
  from public.pms_reservation_rooms
  where reservation_id = p_reservation_id
  order by created_at
  limit 1
  for update;

  v_before := to_jsonb(v_old);
  v_arrival := case when p_patch ? 'arrival_date' then (p_patch->>'arrival_date')::date else v_old.arrival_date end;
  v_departure := case when p_patch ? 'departure_date' then (p_patch->>'departure_date')::date else v_old.departure_date end;
  v_room_id := case when p_patch ? 'room_id' then nullif(p_patch->>'room_id', '') else v_room.room_id end;
  v_guest_name := case when p_patch ? 'primary_guest_name' then nullif(trim(p_patch->>'primary_guest_name'), '') else v_old.primary_guest_name end;
  v_currency := case when p_patch ? 'currency' then upper(p_patch->>'currency') else v_old.currency end;

  if p_patch ? 'nightly_rate' then
    v_rate := (p_patch->>'nightly_rate')::numeric;
  else
    select min(booked_rate_amount) into v_rate
    from public.pms_reservation_nights
    where reservation_room_id = v_room.id;
  end if;

  if v_departure <= v_arrival then raise exception 'Departure date must be after arrival date'; end if;
  if v_guest_name is null then raise exception 'Guest name is required'; end if;
  if v_rate is null or v_rate < 0 then raise exception 'A non-negative nightly rate is required'; end if;
  if v_currency !~ '^[A-Z]{3}$' then raise exception 'Currency must be a three-letter ISO code'; end if;

  if v_room_id is not null and exists (
    select 1
    from public.pms_reservation_rooms rr
    join public.pms_reservations r on r.id = rr.reservation_id
    where rr.organization_slug = v_old.organization_slug
      and rr.hotel_id = v_old.hotel_id
      and rr.room_id = v_room_id
      and r.id <> p_reservation_id
      and r.status in ('tentative', 'confirmed', 'checked_in')
      and r.arrival_date < v_departure
      and r.departure_date > v_arrival
  ) then
    raise exception 'Room is already assigned to an overlapping active reservation';
  end if;

  v_nights := v_departure - v_arrival;

  update public.pms_reservations
  set arrival_date = v_arrival,
      departure_date = v_departure,
      primary_guest_name = v_guest_name,
      primary_guest_email = case when p_patch ? 'primary_guest_email' then nullif(trim(p_patch->>'primary_guest_email'), '') else primary_guest_email end,
      primary_guest_phone = case when p_patch ? 'primary_guest_phone' then nullif(trim(p_patch->>'primary_guest_phone'), '') else primary_guest_phone end,
      adults = case when p_patch ? 'adults' then (p_patch->>'adults')::integer else adults end,
      children = case when p_patch ? 'children' then (p_patch->>'children')::integer else children end,
      currency = v_currency,
      total_amount = v_rate * v_nights,
      notes = case when p_patch ? 'notes' then nullif(trim(p_patch->>'notes'), '') else notes end,
      updated_by = auth.uid(),
      updated_at = now()
  where id = p_reservation_id;

  update public.pms_reservation_rooms
  set room_id = v_room_id,
      assigned_at = case when v_room_id is null then null when room_id is distinct from v_room_id then now() else assigned_at end,
      adults = (select adults from public.pms_reservations where id = p_reservation_id),
      children = (select children from public.pms_reservations where id = p_reservation_id),
      updated_at = now()
  where id = v_room.id;

  delete from public.pms_reservation_nights where reservation_room_id = v_room.id;

  insert into public.pms_reservation_nights (
    reservation_id, reservation_room_id, organization_slug, hotel_id,
    stay_date, booked_rate_amount, currency
  )
  select p_reservation_id, v_room.id, v_old.organization_slug, v_old.hotel_id,
         gs::date, v_rate, v_currency
  from generate_series(v_arrival::timestamp, (v_departure - 1)::timestamp, interval '1 day') gs;

  select to_jsonb(r) into v_after from public.pms_reservations r where r.id = p_reservation_id;

  insert into public.pms_reservation_events (
    reservation_id, organization_slug, hotel_id, event_type, actor_user_id,
    source_system, before_state, after_state, metadata
  ) values (
    p_reservation_id, v_old.organization_slug, v_old.hotel_id, 'updated', auth.uid(),
    'hotelcare', v_before, v_after, jsonb_build_object('entry_point', 'front_desk_v2')
  );

  return v_after;
end;
$$;

create or replace function public.pms_transition_manual_reservation(
  p_reservation_id uuid,
  p_next_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.pms_reservations%rowtype;
  v_after jsonb;
  v_allowed boolean := false;
begin
  select * into v_old
  from public.pms_reservations
  where id = p_reservation_id
  for update;

  if not found then raise exception 'Reservation not found'; end if;
  if not public.pms_user_can_manage_reservations(v_old.organization_slug, v_old.hotel_id) then
    raise exception 'PMS reservation management denied';
  end if;
  if v_old.source_system <> 'hotelcare' then
    raise exception 'Imported reservations are read-only during PMS dual-run';
  end if;

  v_allowed := case v_old.status
    when 'tentative' then p_next_status in ('confirmed', 'cancelled')
    when 'confirmed' then p_next_status in ('checked_in', 'cancelled', 'no_show')
    when 'checked_in' then p_next_status = 'checked_out'
    else false
  end;

  if not v_allowed then
    raise exception 'Invalid reservation status transition: % -> %', v_old.status, p_next_status;
  end if;

  if p_next_status = 'checked_in' and not exists (
    select 1 from public.pms_reservation_rooms rr
    where rr.reservation_id = p_reservation_id and rr.room_id is not null
  ) then
    raise exception 'Assign a room before check-in';
  end if;

  update public.pms_reservations
  set status = p_next_status,
      updated_by = auth.uid(),
      updated_at = now()
  where id = p_reservation_id;

  select to_jsonb(r) into v_after from public.pms_reservations r where r.id = p_reservation_id;

  insert into public.pms_reservation_events (
    reservation_id, organization_slug, hotel_id, event_type, actor_user_id,
    source_system, before_state, after_state, metadata
  ) values (
    p_reservation_id, v_old.organization_slug, v_old.hotel_id, 'status_transition', auth.uid(),
    'hotelcare', to_jsonb(v_old), v_after,
    jsonb_build_object('from', v_old.status, 'to', p_next_status, 'entry_point', 'front_desk_v2')
  );

  return v_after;
end;
$$;

revoke all on function public.pms_user_can_access_hotel(text, text) from public;
revoke all on function public.pms_user_can_manage_reservations(text, text) from public;
revoke all on function public.pms_get_front_desk_feed(text, text, date, date) from public;
revoke all on function public.pms_create_manual_reservation(text, text, text, date, date, text, integer, integer, numeric, text, text, text, text) from public;
revoke all on function public.pms_update_manual_reservation(uuid, jsonb) from public;
revoke all on function public.pms_transition_manual_reservation(uuid, text) from public;

grant execute on function public.pms_get_front_desk_feed(text, text, date, date) to authenticated;
grant execute on function public.pms_create_manual_reservation(text, text, text, date, date, text, integer, integer, numeric, text, text, text, text) to authenticated;
grant execute on function public.pms_update_manual_reservation(uuid, jsonb) to authenticated;
grant execute on function public.pms_transition_manual_reservation(uuid, text) to authenticated;

comment on function public.pms_get_front_desk_feed(text, text, date, date) is
  'Phase 2 scoped front-desk feed: canonical HotelCare reservations plus read-only Previo snapshot fallback.';
comment on function public.pms_create_manual_reservation(text, text, text, date, date, text, integer, integer, numeric, text, text, text, text) is
  'Creates one-room HotelCare-native manual reservation with mandatory nightly booked-rate snapshots and audit event.';
comment on function public.pms_transition_manual_reservation(uuid, text) is
  'Applies validated front-desk lifecycle transitions to HotelCare-native reservations only.';
