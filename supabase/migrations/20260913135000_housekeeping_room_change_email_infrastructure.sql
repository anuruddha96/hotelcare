-- Branded reception notifications for manual Checkout <-> Daily changes.

create table if not exists public.hotel_operational_contacts (
  id uuid primary key default gen_random_uuid(),
  organization_slug text not null,
  hotel_id text not null,
  hotel_name text not null,
  reception_email text,
  room_type_change_email_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_slug, hotel_id)
);

alter table public.hotel_operational_contacts enable row level security;

drop policy if exists "hotel operational contacts readable by org users" on public.hotel_operational_contacts;
create policy "hotel operational contacts readable by org users"
on public.hotel_operational_contacts for select
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.organization_slug = hotel_operational_contacts.organization_slug
      and p.deleted_at is null
  )
);

drop policy if exists "hotel operational contacts manageable by managers" on public.hotel_operational_contacts;
create policy "hotel operational contacts manageable by managers"
on public.hotel_operational_contacts for all
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.organization_slug = hotel_operational_contacts.organization_slug
      and p.deleted_at is null
      and p.role in ('manager','housekeeping_manager','admin','top_management','top_management_manager')
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.organization_slug = hotel_operational_contacts.organization_slug
      and p.deleted_at is null
      and p.role in ('manager','housekeeping_manager','admin','top_management','top_management_manager')
  )
);

create table if not exists public.housekeeping_room_change_email_log (
  id uuid primary key default gen_random_uuid(),
  organization_slug text not null,
  hotel_id text not null,
  room_id uuid,
  room_number text not null,
  business_date date not null,
  previous_type text not null check (previous_type in ('checkout','daily')),
  new_type text not null check (new_type in ('checkout','daily')),
  changed_by uuid,
  changed_by_name text,
  note text,
  recipient text not null,
  status text not null default 'pending' check (status in ('pending','sent','failed','skipped')),
  provider_message_id text,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.housekeeping_room_change_email_log enable row level security;

drop policy if exists "room change email log readable by org managers" on public.housekeeping_room_change_email_log;
create policy "room change email log readable by org managers"
on public.housekeeping_room_change_email_log for select
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.organization_slug = housekeeping_room_change_email_log.organization_slug
      and p.deleted_at is null
      and p.role in ('manager','housekeeping_manager','admin','top_management','top_management_manager','reception')
  )
);

do $$
begin
  if not exists (
    select 1 from vault.decrypted_secrets
    where name = 'housekeeping_room_change_email_worker_secret'
  ) then
    perform vault.create_secret(
      encode(gen_random_bytes(32), 'hex'),
      'housekeeping_room_change_email_worker_secret',
      'Authenticates database-triggered HotelCare housekeeping room change e-mails',
      null
    );
  end if;
end $$;

create or replace function public.housekeeping_room_change_email_worker_secret()
returns text
language sql
security definer
set search_path = public, vault
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = 'housekeeping_room_change_email_worker_secret'
  order by created_at desc
  limit 1;
$$;

revoke all on function public.housekeeping_room_change_email_worker_secret() from public, anon, authenticated;
grant execute on function public.housekeeping_room_change_email_worker_secret() to service_role;

-- Initial RD Hotels operational routing. The address is configurable afterwards
-- through hotel_operational_contacts without changing application code.
insert into public.hotel_operational_contacts (
  organization_slug,
  hotel_id,
  hotel_name,
  reception_email,
  room_type_change_email_enabled
)
values (
  'rdhotels',
  'ottofiori',
  'Hotel Ottofiori',
  'reception@ottofiori.hu',
  true
)
on conflict (organization_slug, hotel_id)
do update set
  hotel_name = excluded.hotel_name,
  reception_email = excluded.reception_email,
  room_type_change_email_enabled = excluded.room_type_change_email_enabled,
  updated_at = now();
