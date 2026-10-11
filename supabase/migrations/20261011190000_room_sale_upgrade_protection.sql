-- Physical-room upgrade allocations. No migration activates shared inventory or sends mail.
-- Staff-facing writes must pass the authenticated inventory edge function.
create table if not exists public.room_sale_upgrade_rules (
  id uuid primary key default gen_random_uuid(),
  hotel_id text not null,
  organization_slug text not null,
  stay_date date not null,
  source_obk_id text not null,
  target_obk_id text not null,
  source_room_type_name text not null,
  target_room_type_name text not null,
  unit_count integer not null check (unit_count between 1 and 99),
  sell_mode text not null check (sell_mode in ('exclusive_transfer','shared_pool')),
  close_trigger text not null check (close_trigger in ('linked_booking','hotel_sellout')),
  status text not null default 'pending' check (status in ('pending','active','closed','needs_review')),
  actual_source_before integer,
  actual_target_before integer,
  physical_capacity integer not null check (physical_capacity > 0),
  booked_at_creation integer not null check (booked_at_creation >= 0),
  notify_mode text not null default 'admin_test' check (notify_mode in ('off','admin_test','reception')),
  last_checked_at timestamptz,
  last_error text,
  activated_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (source_obk_id <> target_obk_id),
  unique (hotel_id, stay_date, source_obk_id, target_obk_id)
);
create index if not exists room_sale_upgrade_rules_active_idx
  on public.room_sale_upgrade_rules(hotel_id,stay_date,status)
  where status in ('active','needs_review');

create table if not exists public.room_sale_upgrade_events (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.room_sale_upgrade_rules(id) on delete cascade,
  hotel_id text not null,
  organization_slug text not null,
  stay_date date not null,
  reservation_id text not null,
  room_key text not null,
  booked_room_type_name text not null,
  upgrade_room_type_name text not null,
  event_kind text not null check (event_kind in ('upgrade_review','shared_inventory_closed','inventory_warning')),
  delivery_state text not null default 'pending' check (delivery_state in ('pending','sent','failed','suppressed')),
  email_to text,
  sent_at timestamptz,
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  unique (rule_id, reservation_id, room_key, event_kind)
);
create index if not exists room_sale_upgrade_events_pending_idx
  on public.room_sale_upgrade_events(delivery_state,created_at)
  where delivery_state in ('pending','failed');

-- A short-lived lease prevents two manager requests from editing the same
-- property/date at once. This is NOT a replacement for OTA-side atomic inventory.
create table if not exists public.room_sale_upgrade_locks (
  hotel_id text not null,
  stay_date date not null,
  owner uuid not null,
  expires_at timestamptz not null,
  primary key (hotel_id,stay_date)
);
create or replace function public.claim_room_sale_upgrade_lock(
  p_hotel_id text, p_stay_date date, p_owner uuid
) returns boolean language plpgsql security definer set search_path = public as $$
begin
  insert into public.room_sale_upgrade_locks(hotel_id,stay_date,owner,expires_at)
  values (p_hotel_id,p_stay_date,p_owner,now()+interval '90 seconds')
  on conflict (hotel_id,stay_date) do update
    set owner=excluded.owner, expires_at=excluded.expires_at
    where room_sale_upgrade_locks.expires_at < now();
  return found;
end; $$;
create or replace function public.release_room_sale_upgrade_lock(
  p_hotel_id text, p_stay_date date, p_owner uuid
) returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.room_sale_upgrade_locks
  where hotel_id=p_hotel_id and stay_date=p_stay_date and owner=p_owner;
end; $$;
revoke all on function public.claim_room_sale_upgrade_lock(text,date,uuid) from public, anon, authenticated;
revoke all on function public.release_room_sale_upgrade_lock(text,date,uuid) from public, anon, authenticated;
grant execute on function public.claim_room_sale_upgrade_lock(text,date,uuid) to service_role;
grant execute on function public.release_room_sale_upgrade_lock(text,date,uuid) to service_role;

alter table public.room_sale_upgrade_rules enable row level security;
alter table public.room_sale_upgrade_events enable row level security;
alter table public.room_sale_upgrade_locks enable row level security;
create policy room_sale_upgrade_rules_staff_read
on public.room_sale_upgrade_rules for select to authenticated
using (exists (
 select 1 from public.profiles p
 where p.id=auth.uid() and p.deleted_at is null
 and (p.is_super_admin = true or (
   p.organization_slug = room_sale_upgrade_rules.organization_slug
   and p.role::text in ('admin','top_management','top_management_manager','manager','reception_manager')
 ))
));
create policy room_sale_upgrade_events_staff_read
on public.room_sale_upgrade_events for select to authenticated
using (exists (
 select 1 from public.profiles p
 where p.id=auth.uid() and p.deleted_at is null
 and (p.is_super_admin = true or (
   p.organization_slug=room_sale_upgrade_events.organization_slug
   and p.role::text in ('admin','top_management','top_management_manager','manager','reception_manager')
 ))
));
comment on table public.room_sale_upgrade_rules is 'Sell one physical room as a higher-category capacity upgrade without inventing new physical capacity. Shared activation requires a verified PMS/channel linked pool.';
