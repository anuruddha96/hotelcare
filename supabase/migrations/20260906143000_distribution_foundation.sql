-- HotelCare Distribution foundation.
--
-- These tables are intentionally server-only at first. RLS is enabled and no
-- direct browser policies are granted. Supabase Edge Functions/service-role
-- code must validate role + hotel access before reading or changing them.
-- OTA credentials are NEVER stored in these tables; only a server-side
-- secret_ref may be persisted.

create table if not exists public.distribution_connections (
  id uuid primary key default gen_random_uuid(),
  hotel_id text not null,
  organization_slug text,
  provider text not null check (provider in (
    'channex', 'previo', 'booking', 'expedia', 'agoda', 'trip',
    'airbnb', 'hoteltonight', 'szallas'
  )),
  channel text not null check (channel in (
    'booking', 'expedia', 'agoda', 'trip', 'airbnb', 'hoteltonight', 'szallas'
  )),
  external_property_id text not null,
  status text not null default 'draft' check (status in (
    'draft', 'connecting', 'active', 'degraded', 'disabled', 'error'
  )),
  capabilities text[] not null default '{}',
  secret_ref text,
  metadata jsonb not null default '{}'::jsonb,
  last_health_check_at timestamptz,
  last_health_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (hotel_id, provider, channel, external_property_id)
);

create index if not exists distribution_connections_hotel_idx
  on public.distribution_connections (hotel_id, status);
create index if not exists distribution_connections_org_idx
  on public.distribution_connections (organization_slug, hotel_id);

create table if not exists public.distribution_room_mappings (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.distribution_connections(id) on delete cascade,
  hotel_id text not null,
  hotelcare_room_type_id text not null,
  external_room_type_id text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, hotelcare_room_type_id),
  unique (connection_id, external_room_type_id)
);

create index if not exists distribution_room_mappings_hotel_idx
  on public.distribution_room_mappings (hotel_id, connection_id);

create table if not exists public.distribution_rate_mappings (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.distribution_connections(id) on delete cascade,
  hotel_id text not null,
  hotelcare_rate_plan_id text not null,
  external_rate_plan_id text not null,
  hotelcare_room_type_id text,
  external_room_type_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, hotelcare_rate_plan_id, hotelcare_room_type_id),
  unique (connection_id, external_rate_plan_id, external_room_type_id)
);

create index if not exists distribution_rate_mappings_hotel_idx
  on public.distribution_rate_mappings (hotel_id, connection_id);

create table if not exists public.distribution_change_sets (
  id uuid primary key default gen_random_uuid(),
  hotel_id text not null,
  organization_slug text,
  source text not null check (source in (
    'manual', 'revenue_engine', 'ai_agent', 'pms_sync', 'system'
  )),
  mode text not null default 'preview' check (mode in ('preview', 'execute')),
  status text not null default 'draft' check (status in (
    'draft', 'pending_approval', 'approved', 'executing', 'succeeded',
    'partially_succeeded', 'failed', 'cancelled'
  )),
  reason text,
  requested_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists distribution_change_sets_hotel_status_idx
  on public.distribution_change_sets (hotel_id, status, created_at desc);

create table if not exists public.distribution_change_items (
  id uuid primary key default gen_random_uuid(),
  change_set_id uuid not null references public.distribution_change_sets(id) on delete cascade,
  connection_id uuid not null references public.distribution_connections(id) on delete restrict,
  channel text not null check (channel in (
    'booking', 'expedia', 'agoda', 'trip', 'airbnb', 'hoteltonight', 'szallas'
  )),
  kind text not null check (kind in (
    'ari', 'reservation_sync', 'property_content', 'room_content', 'photo', 'promotion'
  )),
  payload jsonb not null,
  status text not null default 'pending' check (status in (
    'pending', 'validated', 'executing', 'succeeded', 'failed', 'skipped'
  )),
  idempotency_key text not null,
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  external_reference text,
  provider_response_redacted jsonb,
  executed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, idempotency_key)
);

create index if not exists distribution_change_items_set_idx
  on public.distribution_change_items (change_set_id, status);
create index if not exists distribution_change_items_pending_idx
  on public.distribution_change_items (status, created_at)
  where status in ('pending', 'validated', 'failed');

create table if not exists public.distribution_audit_log (
  id bigint generated by default as identity primary key,
  hotel_id text not null,
  connection_id uuid references public.distribution_connections(id) on delete set null,
  change_set_id uuid references public.distribution_change_sets(id) on delete set null,
  change_item_id uuid references public.distribution_change_items(id) on delete set null,
  actor_id uuid,
  event text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists distribution_audit_log_hotel_idx
  on public.distribution_audit_log (hotel_id, created_at desc);
create index if not exists distribution_audit_log_change_set_idx
  on public.distribution_audit_log (change_set_id, created_at);

alter table public.distribution_connections enable row level security;
alter table public.distribution_room_mappings enable row level security;
alter table public.distribution_rate_mappings enable row level security;
alter table public.distribution_change_sets enable row level security;
alter table public.distribution_change_items enable row level security;
alter table public.distribution_audit_log enable row level security;

comment on table public.distribution_connections is
  'HotelCare server-side OTA/channel connectivity records. Credentials remain in secrets, never in this table.';
comment on table public.distribution_change_sets is
  'Auditable proposal/approval boundary for manual, revenue-engine and AI distribution actions.';
comment on table public.distribution_change_items is
  'Provider-targeted executable items with idempotency and redacted execution results.';
