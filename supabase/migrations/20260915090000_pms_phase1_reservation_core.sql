-- HotelCare PMS Phase 1: canonical reservation foundation.
-- ADDITIVE/DARK migration: no triggers or writes into the existing Previo sync,
-- rate tables, channel manager, or housekeeping production paths.

create table if not exists public.pms_reservations (
  id uuid primary key default gen_random_uuid(),
  organization_slug text not null,
  hotel_id text not null,
  source_system text not null default 'hotelcare',
  source_channel text,
  external_reservation_id text,
  confirmation_code text,
  status text not null default 'tentative'
    check (status in ('tentative', 'confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show')),
  arrival_date date not null,
  departure_date date not null,
  adults integer not null default 1 check (adults >= 0),
  children integer not null default 0 check (children >= 0),
  primary_guest_name text,
  primary_guest_email text,
  primary_guest_phone text,
  currency text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  total_amount numeric(12,2) check (total_amount is null or total_amount >= 0),
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pms_reservations_valid_stay check (departure_date > arrival_date),
  constraint pms_reservations_id_scope_key unique (id, organization_slug, hotel_id)
);

create unique index if not exists pms_reservations_external_identity_uidx
  on public.pms_reservations (organization_slug, hotel_id, lower(source_system), external_reservation_id)
  where external_reservation_id is not null;

create index if not exists pms_reservations_hotel_dates_idx
  on public.pms_reservations (organization_slug, hotel_id, arrival_date, departure_date);

create index if not exists pms_reservations_hotel_status_idx
  on public.pms_reservations (organization_slug, hotel_id, status);

create table if not exists public.pms_reservation_rooms (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null,
  organization_slug text not null,
  hotel_id text not null,
  room_type_id text,
  room_id text,
  external_room_id text,
  adults integer not null default 1 check (adults >= 0),
  children integer not null default 0 check (children >= 0),
  assigned_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pms_reservation_rooms_reservation_scope_fk
    foreign key (reservation_id, organization_slug, hotel_id)
    references public.pms_reservations (id, organization_slug, hotel_id)
    on delete cascade,
  constraint pms_reservation_rooms_id_scope_key
    unique (id, reservation_id, organization_slug, hotel_id)
);

create index if not exists pms_reservation_rooms_reservation_idx
  on public.pms_reservation_rooms (reservation_id);

create index if not exists pms_reservation_rooms_hotel_room_idx
  on public.pms_reservation_rooms (organization_slug, hotel_id, room_id)
  where room_id is not null;

create table if not exists public.pms_reservation_nights (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null,
  reservation_room_id uuid not null,
  organization_slug text not null,
  hotel_id text not null,
  stay_date date not null,
  booked_rate_amount numeric(12,2) not null check (booked_rate_amount >= 0),
  tax_amount numeric(12,2) not null default 0 check (tax_amount >= 0),
  currency text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  rate_plan_code text,
  source_rate_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pms_reservation_nights_room_scope_fk
    foreign key (reservation_room_id, reservation_id, organization_slug, hotel_id)
    references public.pms_reservation_rooms (id, reservation_id, organization_slug, hotel_id)
    on delete cascade,
  constraint pms_reservation_nights_room_date_key unique (reservation_room_id, stay_date)
);

create index if not exists pms_reservation_nights_hotel_date_idx
  on public.pms_reservation_nights (organization_slug, hotel_id, stay_date);

create index if not exists pms_reservation_nights_reservation_idx
  on public.pms_reservation_nights (reservation_id, stay_date);

create table if not exists public.pms_reservation_events (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null,
  organization_slug text not null,
  hotel_id text not null,
  event_type text not null,
  actor_user_id uuid,
  source_system text not null default 'hotelcare',
  idempotency_key text,
  before_state jsonb,
  after_state jsonb,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  constraint pms_reservation_events_reservation_scope_fk
    foreign key (reservation_id, organization_slug, hotel_id)
    references public.pms_reservations (id, organization_slug, hotel_id)
    on delete cascade
);

create unique index if not exists pms_reservation_events_idempotency_uidx
  on public.pms_reservation_events (organization_slug, hotel_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists pms_reservation_events_reservation_idx
  on public.pms_reservation_events (reservation_id, occurred_at desc);

create table if not exists public.pms_external_events (
  id uuid primary key default gen_random_uuid(),
  organization_slug text not null,
  hotel_id text not null,
  provider text not null,
  external_event_id text not null,
  entity_type text not null default 'reservation',
  payload_hash text,
  payload jsonb not null default '{}'::jsonb,
  processing_status text not null default 'received'
    check (processing_status in ('received', 'processing', 'applied', 'ignored', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pms_external_events_provider_event_key
    unique (organization_slug, hotel_id, provider, external_event_id)
);

create index if not exists pms_external_events_work_queue_idx
  on public.pms_external_events (processing_status, received_at)
  where processing_status in ('received', 'failed');

-- These tables intentionally expose no authenticated policies in Phase 1.
-- service_role/server-side code can populate them during later controlled phases;
-- the browser cannot make them authoritative merely because the schema exists.
alter table public.pms_reservations enable row level security;
alter table public.pms_reservation_rooms enable row level security;
alter table public.pms_reservation_nights enable row level security;
alter table public.pms_reservation_events enable row level security;
alter table public.pms_external_events enable row level security;

comment on table public.pms_reservations is
  'Canonical HotelCare PMS reservations. Phase 1 is dark/additive; existing Previo production sync remains authoritative.';
comment on table public.pms_reservation_nights is
  'Per-night booked-rate snapshots. booked_rate_amount is mandatory to prevent price-less nights from corrupting ADR.';
comment on table public.pms_reservation_events is
  'Append-oriented reservation audit/event history for future PMS workflows.';
comment on table public.pms_external_events is
  'Idempotent inbox for future Previo/channel reservation events.';
