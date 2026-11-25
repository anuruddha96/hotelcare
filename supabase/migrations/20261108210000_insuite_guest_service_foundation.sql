-- HotelCare In-Suite: isolated device-bound guest concierge foundation.
-- Deploy in staging before enabling any hotel. All access is through insuite-api.
create table if not exists public.insuite_property_configs (
  id uuid primary key default gen_random_uuid(),
  organization_slug text not null,
  hotel_id text not null,
  draft jsonb not null default '{}'::jsonb,
  published jsonb not null default '{}'::jsonb,
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (organization_slug, hotel_id)
);

create table if not exists public.insuite_devices (
  id uuid primary key default gen_random_uuid(),
  organization_slug text not null,
  hotel_id text not null,
  room_id uuid not null references public.rooms(id),
  label text not null default 'Room tablet',
  is_active boolean not null default true,
  pairing_hash text,
  pairing_expires_at timestamptz,
  device_token_hash text unique,
  pin_hash text,
  pin_failed_attempts integer not null default 0,
  pin_locked_until timestamptz,
  session_epoch uuid not null default gen_random_uuid(),
  paired_at timestamptz,
  last_seen_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now()
);
create unique index if not exists insuite_one_active_device_per_room
  on public.insuite_devices(room_id) where is_active = true;
create index if not exists insuite_devices_hotel
  on public.insuite_devices(organization_slug, hotel_id);

create table if not exists public.insuite_service_requests (
  id uuid primary key default gen_random_uuid(),
  organization_slug text not null,
  hotel_id text not null,
  room_id uuid not null references public.rooms(id),
  device_id uuid not null references public.insuite_devices(id),
  session_epoch uuid not null,
  client_request_id uuid not null,
  request_type text not null check (request_type in
    ('extra_towels','extra_pillow','blanket','amenities','water','room_cleaning','maintenance','taxi','call_back')),
  quantity integer not null default 1 check (quantity between 1 and 8),
  detail text not null default '',
  department text not null check (department in ('housekeeping','maintenance','reception')),
  priority text not null default 'high' check (priority in ('normal','high','urgent')),
  status text not null default 'submitted' check (status in
    ('submitted','accepted','in_progress','completed','unavailable','cancelled')),
  assigned_to uuid,
  assigned_room_work_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (device_id, client_request_id)
);
create index if not exists insuite_requests_hotel_status
 on public.insuite_service_requests(organization_slug, hotel_id, status, created_at desc);
create index if not exists insuite_requests_assignee
 on public.insuite_service_requests(assigned_to, status, created_at desc);

create table if not exists public.insuite_request_events (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.insuite_service_requests(id) on delete cascade,
  old_status text,
  new_status text not null,
  actor_user_id uuid,
  occurred_at timestamptz not null default now()
);
create index if not exists insuite_request_events_request_id on public.insuite_request_events(request_id, occurred_at);

create table if not exists public.insuite_messages (
  id uuid primary key default gen_random_uuid(),
  organization_slug text not null,
  hotel_id text not null,
  room_id uuid not null references public.rooms(id),
  device_id uuid not null references public.insuite_devices(id),
  session_epoch uuid not null,
  sender text not null check (sender in ('guest','reception')),
  sender_user_id uuid,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists insuite_messages_room_epoch
 on public.insuite_messages(device_id, session_epoch, created_at desc);
create index if not exists insuite_messages_hotel
 on public.insuite_messages(organization_slug, hotel_id, created_at desc);

-- Deny any direct browser Data API access, including room tablets.
-- The edge function verifies user role or a hashed room-bound device token.
alter table public.insuite_property_configs enable row level security;
alter table public.insuite_devices enable row level security;
alter table public.insuite_service_requests enable row level security;
alter table public.insuite_request_events enable row level security;
alter table public.insuite_messages enable row level security;

revoke all on public.insuite_property_configs from public, anon, authenticated;
revoke all on public.insuite_devices from public, anon, authenticated;
revoke all on public.insuite_service_requests from public, anon, authenticated;
revoke all on public.insuite_request_events from public, anon, authenticated;
revoke all on public.insuite_messages from public, anon, authenticated;
revoke all on sequence public.insuite_request_events_id_seq from public, anon, authenticated;

grant all on public.insuite_property_configs to service_role;
grant all on public.insuite_devices to service_role;
grant all on public.insuite_service_requests to service_role;
grant all on public.insuite_request_events to service_role;
grant all on public.insuite_messages to service_role;
grant usage, select on sequence public.insuite_request_events_id_seq to service_role;

comment on table public.insuite_devices is
 'Room-bound bearer credentials are SHA-256 hashed. Never return token hashes or staff PIN hashes to clients.';
comment on table public.insuite_messages is
 'Current guest session messages only are surfaced by insuite-api. Rotate session_epoch at every checkout.';
