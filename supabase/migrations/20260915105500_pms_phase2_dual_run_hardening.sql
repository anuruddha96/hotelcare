-- HotelCare PMS Phase 2 hardening.
-- Use the existing Previo-backed reservations table as the read-only dual-run
-- source for future stays and prevent HotelCare-native bookings from claiming
-- a physical room that Previo already controls for overlapping dates.

create or replace function public.pms_guard_reservation_room_scope()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_room_type text;
  v_physical_room_id uuid;
  v_arrival date;
  v_departure date;
  v_status text;
begin
  if new.room_id is null then
    return new;
  end if;

  select rm.id, rm.room_type
  into v_physical_room_id, v_room_type
  from public.rooms rm
  where rm.id::text = new.room_id
    and (
      rm.hotel = new.hotel_id
      or exists (
        select 1
        from public.hotel_configurations hc
        where (hc.hotel_id = new.hotel_id or hc.hotel_name = new.hotel_id)
          and (rm.hotel = hc.hotel_id or rm.hotel = hc.hotel_name)
      )
    )
  limit 1;

  if not found then
    raise exception 'Room does not belong to this hotel';
  end if;

  select r.arrival_date, r.departure_date, r.status
  into v_arrival, v_departure, v_status
  from public.pms_reservations r
  where r.id = new.reservation_id
    and r.organization_slug = new.organization_slug
    and r.hotel_id = new.hotel_id;

  if not found then
    raise exception 'Reservation does not belong to this hotel';
  end if;

  if v_status in ('tentative', 'confirmed', 'checked_in') then
    if exists (
      select 1
      from public.pms_reservation_rooms other_room
      join public.pms_reservations other_reservation
        on other_reservation.id = other_room.reservation_id
      where other_room.id <> new.id
        and other_room.organization_slug = new.organization_slug
        and other_room.hotel_id = new.hotel_id
        and other_room.room_id = new.room_id
        and other_reservation.status in ('tentative', 'confirmed', 'checked_in')
        and other_reservation.arrival_date < v_departure
        and other_reservation.departure_date > v_arrival
    ) then
      raise exception 'Room is already assigned to an overlapping HotelCare reservation';
    end if;

    if exists (
      select 1
      from public.reservations legacy
      where legacy.organization_slug = new.organization_slug
        and legacy.room_id = v_physical_room_id
        and legacy.check_in_date < v_departure
        and legacy.check_out_date > v_arrival
        and legacy.status::text not in ('cancelled', 'no_show', 'checked_out')
    ) then
      raise exception 'Room is already occupied by an overlapping Previo reservation';
    end if;
  end if;

  new.room_type_id := v_room_type;
  return new;
end;
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
  v_previo_reservations jsonb;
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
  where rm.organization_slug = p_organization_slug
    and (
      rm.hotel = p_hotel_id
      or exists (
        select 1
        from public.hotel_configurations hc
        where (hc.hotel_id = p_hotel_id or hc.hotel_name = p_hotel_id)
          and (rm.hotel = hc.hotel_id or rm.hotel = hc.hotel_name)
      )
    );

  -- The existing `reservations` table is the current Previo-backed reservation
  -- mirror and contains future stays. Shape it like the transitional snapshot
  -- adapter expected by the Phase 2 client, but keep it strictly read-only.
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', legacy.id,
    'business_date', legacy.check_in_date,
    'room_number', coalesce(rm.room_number, 'UNASSIGNED'),
    'arrival_date', legacy.check_in_date,
    'departure_date', legacy.check_out_date,
    'status', legacy.status::text,
    'guest_names', coalesce(nullif(trim(legacy.pms_guest_name), ''), 'Guest'),
    'source', coalesce(legacy.source, 'previo')
  ) order by legacy.check_in_date, rm.room_number nulls last), '[]'::jsonb)
  into v_previo_reservations
  from public.reservations legacy
  left join public.rooms rm on rm.id = legacy.room_id
  where legacy.organization_slug = p_organization_slug
    and (
      legacy.hotel_id = p_hotel_id
      or exists (
        select 1
        from public.hotel_configurations hc
        where (hc.hotel_id = p_hotel_id or hc.hotel_name = p_hotel_id)
          and (legacy.hotel_id = hc.hotel_id or legacy.hotel_id = hc.hotel_name)
      )
    )
    and legacy.check_in_date < p_end_date
    and legacy.check_out_date > p_start_date
    and legacy.status::text not in ('cancelled', 'no_show', 'checked_out');

  select coalesce(
    (
      select to_jsonb(ps)
      from public.pms_property_settings ps
      where ps.organization_slug = p_organization_slug
        and ps.hotel_id = p_hotel_id
    ),
    jsonb_build_object(
      'organization_slug', p_organization_slug,
      'hotel_id', p_hotel_id,
      'default_check_in', '15:00:00',
      'default_check_out', '10:00:00',
      'currency', 'EUR'
    )
  ) into v_settings;

  return jsonb_build_object(
    'reservations', v_reservations,
    'rooms', v_rooms,
    'previo_snapshots', v_previo_reservations,
    'settings', v_settings,
    'can_manage', public.pms_user_can_manage_reservations(p_organization_slug, p_hotel_id)
  );
end;
$$;

comment on function public.pms_guard_reservation_room_scope() is
  'Prevents cross-property assignment and overlapping HotelCare/Previo room claims during PMS dual-run.';
comment on function public.pms_get_front_desk_feed(text, text, date, date) is
  'Phase 2 feed: canonical HotelCare reservations plus the existing Previo-backed reservations mirror as read-only stays.';
