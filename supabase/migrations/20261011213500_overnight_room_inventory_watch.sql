-- A temporary watch for a real room marketed in two Previo room types.
-- Applies to any canonical hotel, but creation/updates are server-only.
create table if not exists public.room_sale_overnight_watches (
  id uuid primary key default gen_random_uuid(),
  hotel_id text not null,
  organization_slug text not null,
  stay_date date not null,
  first_obk_id text not null,
  second_obk_id text not null,
  baseline_confirmed integer not null check (baseline_confirmed >= 0),
  baseline_refs text[] not null,
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status text not null default 'active'
    check (status in ('active','triggered','closed','needs_review','expired')),
  triggered_at timestamptz,
  triggered_reservation text,
  last_checked_at timestamptz,
  closed_at timestamptz,
  last_error text,
  email_sent_at timestamptz,
  created_at timestamptz not null default now(),
  check (first_obk_id <> second_obk_id),
  check (expires_at > starts_at),
  unique (hotel_id, stay_date, first_obk_id, second_obk_id)
);
create index if not exists room_sale_overnight_active_idx
  on public.room_sale_overnight_watches(status,expires_at)
  where status in ('active','triggered','needs_review');
alter table public.room_sale_overnight_watches enable row level security;
create policy "Top managers view own property watch"
on public.room_sale_overnight_watches for select to authenticated
using (
  exists(select 1 from public.profiles p where p.id=auth.uid()
    and p.role::text in ('admin','top_management_manager','top_management')
    and public.user_can_access_hotel(auth.uid(),room_sale_overnight_watches.hotel_id)
  )
);
comment on table public.room_sale_overnight_watches is
'Best-effort Previo post-booking closure for cross-category room offers; cannot prevent two simultaneous external channel bookings.';
