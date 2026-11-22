-- Isolated SQL fixture for /bb restaurant security. No live guest data.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;

create schema if not exists auth;
create function auth.uid() returns uuid stable language sql as
  $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;

create table public.profiles (
  id uuid primary key,
  role text not null,
  deleted_at timestamptz
);
create table public.restaurant_reservations (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null,
  status text not null default 'booked',
  first_seen_at timestamptz,
  first_seen_by uuid,
  status_marked_at timestamptz,
  status_marked_by text
);
alter table public.restaurant_reservations enable row level security;
create function public.user_can_access_hotel(_uid uuid, _hotel_id text)
returns boolean stable language sql as $$ select _uid is not null $$;

-- Mimic the old, too-broad RLS rule and GRANTs (SQL migration replaces it).
create policy "Staff can view restaurant reservations of their hotel"
on public.restaurant_reservations for select to authenticated
using (public.user_can_access_hotel(auth.uid(),hotel_id::text));
grant all on public.restaurant_reservations to authenticated, anon;
grant select on public.profiles to authenticated;
grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
grant execute on function public.user_can_access_hotel(uuid,text) to authenticated, anon;

insert into public.profiles(id,role) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','breakfast_staff'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','housekeeping'),
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','reception'),
 ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','manager'),
 ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','breakfast_staff');
update public.profiles set deleted_at=now() where id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

insert into public.restaurant_reservations(id,hotel_id,status) values
 ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','booked');
