-- HotelCare In-Suite phase 3: staff-confirmed food/amenity orders and facility/transport booking requests.
-- No PMS/folio charging or third-party booking is performed by this migration.
create table if not exists public.insuite_catalog_items (
  id uuid primary key default gen_random_uuid(),
  organization_slug text not null,
  hotel_id text not null,
  kind text not null check (kind in ('breakfast','room_service','minibar')),
  name text not null check (length(btrim(name)) between 2 and 150),
  description text not null default '',
  image_url text,
  allergens text not null default '',
  price numeric(12,2) not null check (price >= 0 and price <= 1000000),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  is_active boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists insuite_catalog_hotel on public.insuite_catalog_items
  (organization_slug,hotel_id,kind,is_active,sort_order);
alter table public.insuite_catalog_items enable row level security;
revoke all on public.insuite_catalog_items from public, anon, authenticated;
grant all on public.insuite_catalog_items to service_role;

create table if not exists public.insuite_orders (
  id uuid primary key default gen_random_uuid(),
  organization_slug text not null,
  hotel_id text not null,
  room_id uuid not null references public.rooms(id),
  device_id uuid not null references public.insuite_devices(id),
  reservation_id uuid not null references public.reservations(id),
  session_epoch uuid not null,
  client_request_id uuid not null,
  kind text not null check (kind in ('breakfast','room_service','minibar')),
  requested_at timestamptz,
  notes text not null default '',
  currency text not null,
  quoted_total numeric(12,2) not null check (quoted_total >= 0),
  status text not null default 'submitted' check (status in
    ('submitted','confirmed','preparing','on_the_way','delivered','declined','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(device_id,client_request_id)
);
create index if not exists insuite_orders_hotel on public.insuite_orders
  (organization_slug,hotel_id,created_at desc);
create index if not exists insuite_orders_room on public.insuite_orders
  (room_id,session_epoch,created_at desc);
alter table public.insuite_orders enable row level security;
revoke all on public.insuite_orders from public, anon, authenticated;
grant all on public.insuite_orders to service_role;

create table if not exists public.insuite_order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.insuite_orders(id) on delete cascade,
  catalog_item_id uuid not null references public.insuite_catalog_items(id),
  name_snapshot text not null,
  unit_price numeric(12,2) not null,
  quantity integer not null check (quantity between 1 and 8),
  line_total numeric(12,2) not null,
  unique(order_id,catalog_item_id)
);
create index if not exists insuite_order_lines_by_order on public.insuite_order_lines(order_id);
alter table public.insuite_order_lines enable row level security;
revoke all on public.insuite_order_lines from public, anon, authenticated;
grant all on public.insuite_order_lines to service_role;

create table if not exists public.insuite_booking_requests (
  id uuid primary key default gen_random_uuid(),
  organization_slug text not null,
  hotel_id text not null,
  room_id uuid not null references public.rooms(id),
  device_id uuid not null references public.insuite_devices(id),
  reservation_id uuid not null references public.reservations(id),
  session_epoch uuid not null,
  client_request_id uuid not null,
  kind text not null check (kind in ('taxi','gym','spa','sauna','jacuzzi')),
  starts_at timestamptz not null,
  party_size integer not null check (party_size between 1 and 8),
  notes text not null default '',
  status text not null default 'requested' check (status in
    ('requested','confirmed','declined','cancelled','completed')),
  staff_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(device_id,client_request_id)
);
create index if not exists insuite_bookings_hotel
  on public.insuite_booking_requests(organization_slug,hotel_id,status,starts_at);
alter table public.insuite_booking_requests enable row level security;
revoke all on public.insuite_booking_requests from public, anon, authenticated;
grant all on public.insuite_booking_requests to service_role;

-- Atomic checkout-vs-request guard. Every guest-originated or reception
-- chat insert uses a row lock on the room device, so an overlapping checkout
-- cannot leave behind an unverified post-checkout service request.
create or replace function public.insuite_active_session_insert_guard()
returns trigger language plpgsql security definer set search_path = ''
as $
declare _d public.insuite_devices%rowtype;
begin
  select * into _d from public.insuite_devices
    where id = new.device_id and is_active for share;
  if not found
    or _d.session_epoch is distinct from new.session_epoch
    or _d.active_reservation_id is null
    or _d.room_id is distinct from new.room_id
    or _d.organization_slug is distinct from new.organization_slug
    or _d.hotel_id is distinct from new.hotel_id
  then raise exception 'Tablet session is no longer valid'; end if;
  if not exists (select 1 from public.reservations r
    where r.id = _d.active_reservation_id
      and r.room_id = _d.room_id and r.organization_slug = _d.organization_slug
      and r.status::text = 'checked_in')
  then raise exception 'No verified active guest stay'; end if;
  if tg_table_name = 'insuite_booking_requests' then
    if new.reservation_id is distinct from _d.active_reservation_id then
      raise exception 'Booking is not attached to this guest stay';
    end if;
  end if;
  return new;
end; $;
revoke all on function public.insuite_active_session_insert_guard() from public, anon, authenticated;
drop trigger if exists insuite_request_active_session on public.insuite_service_requests;
create trigger insuite_request_active_session before insert on public.insuite_service_requests
  for each row execute function public.insuite_active_session_insert_guard();
drop trigger if exists insuite_message_active_session on public.insuite_messages;
create trigger insuite_message_active_session before insert on public.insuite_messages
  for each row execute function public.insuite_active_session_insert_guard();
drop trigger if exists insuite_booking_active_session on public.insuite_booking_requests;
create trigger insuite_booking_active_session before insert on public.insuite_booking_requests
  for each row execute function public.insuite_active_session_insert_guard();

-- Atomic server-side repricing from the active property catalog. The browser
-- sends only IDs and quantities; quoted_total can never be supplied by a guest.
-- The function executes exclusively under the already verified service-role API.
create or replace function public.insuite_create_order(
  _device_id uuid, _session_epoch uuid, _client_request_id uuid,
  _kind text, _requested_at timestamptz, _notes text, _items jsonb
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  _device public.insuite_devices%rowtype;
  _entry jsonb;
  _item public.insuite_catalog_items%rowtype;
  _id uuid;
  _qty integer;
  _line jsonb;
  _lines jsonb := '[]'::jsonb;
  _total numeric(12,2) := 0;
  _currency text := '';
  _count integer := 0;
  _order_id uuid;
  _existing public.insuite_orders%rowtype;
begin
  select * into _device from public.insuite_devices where id = _device_id and is_active for share;
  if not found or _device.session_epoch is distinct from _session_epoch
      or _device.active_reservation_id is null then raise exception 'Active stay required'; end if;
  if not exists (select 1 from public.reservations r
    where r.id = _device.active_reservation_id and r.room_id = _device.room_id
      and r.organization_slug = _device.organization_slug and r.status::text = 'checked_in')
  then raise exception 'Active stay not confirmed'; end if;
  if not exists (select 1 from public.insuite_property_configs c
    where c.organization_slug = _device.organization_slug and c.hotel_id = _device.hotel_id
      and c.enabled and c.published -> 'services' ->> _kind = 'true')
  then raise exception 'Ordering category disabled'; end if;
  if _kind not in ('breakfast','room_service','minibar')
    or _items is null or jsonb_typeof(_items) <> 'array'
    or jsonb_array_length(_items) not between 1 and 12
    or _requested_at is null or _requested_at < now() - interval '5 minutes'
    or _requested_at > now() + interval '7 days'
    or char_length(coalesce(_notes,'')) > 400 then
    raise exception 'Invalid order details';
  end if;
  select * into _existing from public.insuite_orders
   where device_id = _device_id and client_request_id = _client_request_id;
  if found then
    return jsonb_build_object('id',_existing.id,'status',_existing.status,'currency',_existing.currency,
                              'quoted_total',_existing.quoted_total,'repeated',true);
  end if;
  for _entry in select value from jsonb_array_elements(_items) loop
    _id := (_entry ->> 'id')::uuid;
    _qty := (_entry ->> 'quantity')::integer;
    if _qty not between 1 and 8
      or _lines @> jsonb_build_array(jsonb_build_object('id',_id)) then
       raise exception 'Invalid item quantity or duplicate item';
    end if;
    select * into _item from public.insuite_catalog_items
      where id = _id and organization_slug = _device.organization_slug
        and hotel_id = _device.hotel_id and kind = _kind and is_active;
    if not found then raise exception 'Menu item unavailable'; end if;
    if _currency <> '' and _currency <> _item.currency then
      raise exception 'Mixed currencies not permitted';
    end if;
    _currency := _item.currency;
    _total := _total + _item.price * _qty;
    _lines := _lines || jsonb_build_array(
      jsonb_build_object('id',_id,'name',_item.name,'price',_item.price,'quantity',_qty)
    );
    _count := _count + 1;
  end loop;
  if _total > 1000000 then raise exception 'Order exceeds review limit'; end if;
  insert into public.insuite_orders (
    organization_slug,hotel_id,room_id,device_id,reservation_id,session_epoch,
    client_request_id,kind,requested_at,notes,currency,quoted_total
  ) values (
    _device.organization_slug,_device.hotel_id,_device.room_id,_device_id,
    _device.active_reservation_id,_session_epoch,_client_request_id,
    _kind,_requested_at,_notes,_currency,_total
  )
  on conflict(device_id,client_request_id) do nothing
  returning id into _order_id;
  if _order_id is null then
    select * into _existing from public.insuite_orders
      where device_id = _device_id and client_request_id = _client_request_id;
    return jsonb_build_object('id',_existing.id,'status',_existing.status,'currency',_existing.currency,
                              'quoted_total',_existing.quoted_total,'repeated',true);
  end if;
  for _line in select value from jsonb_array_elements(_lines) loop
    insert into public.insuite_order_lines
      (order_id,catalog_item_id,name_snapshot,unit_price,quantity,line_total)
    values (_order_id,(_line->>'id')::uuid,_line->>'name',
      (_line->>'price')::numeric,(_line->>'quantity')::integer,
      (_line->>'price')::numeric * (_line->>'quantity')::integer);
  end loop;
  return jsonb_build_object('id',_order_id,'status','submitted',
    'currency',_currency,'quoted_total',_total,'repeated',false);
end; $$;
revoke all on function public.insuite_create_order(uuid,uuid,uuid,text,timestamptz,text,jsonb)
 from public, anon, authenticated;
grant execute on function public.insuite_create_order(uuid,uuid,uuid,text,timestamptz,text,jsonb)
 to service_role;

create or replace function public.insuite_order_notification()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare _number text;
begin
  select room_number into _number from public.rooms where id = new.room_id;
  perform public.insuite_fanout_alert(
    new.organization_slug,new.hotel_id,new.room_id,
    'order:' || new.id::text,'order',
    'New guest food order · Room ' || coalesce(_number,'?'),
    left(new.kind || ' · ' || new.quoted_total::text || ' ' || new.currency || ' · Staff confirmation required',200),
    array['reception','front_office','reception_manager','manager','breakfast_staff','top_management','top_management_manager'],
    null,null,null
  );
  return new;
end; $$;
revoke all on function public.insuite_order_notification() from public, anon, authenticated;
drop trigger if exists insuite_order_notification on public.insuite_orders;
create trigger insuite_order_notification
after insert on public.insuite_orders for each row execute function public.insuite_order_notification();

create or replace function public.insuite_booking_notification()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare _number text;
begin
  select room_number into _number from public.rooms where id = new.room_id;
  perform public.insuite_fanout_alert(
    new.organization_slug,new.hotel_id,new.room_id,
    'booking:' || new.id::text,'booking',
    'Guest reservation request · Room ' || coalesce(_number,'?'),
    left(new.kind || ' · ' || to_char(new.starts_at at time zone 'Europe/Budapest','YYYY-MM-DD HH24:MI')
      || ' · Confirmation required',200),
    array['reception','front_office','reception_manager','manager','top_management','top_management_manager'],
    null,null,null
  );
  return new;
end; $$;
revoke all on function public.insuite_booking_notification() from public, anon, authenticated;
drop trigger if exists insuite_booking_notification on public.insuite_booking_requests;
create trigger insuite_booking_notification
after insert on public.insuite_booking_requests for each row execute function public.insuite_booking_notification();
