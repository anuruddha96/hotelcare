-- Isolated disposable database only. Minimal contract fixtures, not a production schema clone.
\set ON_ERROR_STOP on
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
grant usage on schema auth to authenticated, service_role;
create function auth.uid() returns uuid language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;

create table public.organizations(id uuid primary key, slug text unique not null);
create table public.hotel_configurations(hotel_id text primary key, hotel_name text not null, organization_id uuid, breakfast_enabled boolean, is_active boolean);
create table public.housekeeping_automation_settings(organization_slug text, hotel_id text, primary key(organization_slug,hotel_id));
create table public.rooms(id uuid primary key, organization_slug text, hotel text, room_number text, status text, is_dnd boolean, is_checkout_room boolean, pms_metadata jsonb, notes text);
create table public.profiles(id uuid primary key, organization_slug text, role text, deleted_at timestamptz);
create table public.room_assignments(room_id uuid, organization_slug text, assigned_to uuid, assignment_date date, status text, assignment_type text, is_dnd boolean, pms_hold boolean not null default false, service_result text, notes text);
create table public.breakfast_attendance(id uuid primary key, hotel_id text, organization_slug text, stay_date date, room_number text, served_count integer, location text, created_at timestamptz);
create table public.daily_overview_snapshots(hotel_id text, organization_slug text, business_date date, room_number text, pax integer, source text, captured_at timestamptz);
create table public.breakfast_roster(hotel_id text, organization_slug text, stay_date date, room_number text, pax integer, uploaded_at timestamptz);
-- Existing access helper contracts represented by deterministic test doubles.
create function public.get_user_organization_slug(user_id uuid) returns text language sql stable security definer set search_path = '' as $$ select p.organization_slug from public.profiles p where p.id=user_id $$;
create function public.get_user_role(user_id uuid) returns text language sql stable security definer set search_path = '' as $$ select p.role from public.profiles p where p.id=user_id $$;
create function public.user_can_access_hotel(_hotel_id text,_uid uuid) returns boolean language sql stable security definer set search_path = '' as $$ select exists(select 1 from public.hotel_configurations h join public.organizations o on o.id=h.organization_id join public.profiles p on p.organization_slug=o.slug where h.hotel_id=_hotel_id and p.id=_uid) $$;
grant select on public.room_assignments to authenticated;
alter table public.room_assignments enable row level security;
create policy scratch_assignment_read on public.room_assignments for select to authenticated using (assigned_to=auth.uid());
create publication supabase_realtime;

\ir ../migrations/20261126124500_housekeeping_breakfast_signals.sql

insert into public.organizations values ('10000000-0000-0000-0000-000000000001','org-a'),('10000000-0000-0000-0000-000000000002','org-b');
insert into public.hotel_configurations values ('hotel-a','Hotel A','10000000-0000-0000-0000-000000000001',true,true),('hotel-b','Hotel B','10000000-0000-0000-0000-000000000002',true,true);
insert into public.profiles values
('20000000-0000-0000-0000-000000000001','org-a','housekeeping',null),
('20000000-0000-0000-0000-000000000002','org-a','housekeeping',null),
('20000000-0000-0000-0000-000000000003','org-b','housekeeping',null),
('20000000-0000-0000-0000-000000000004','org-a','housekeeping_manager',null);
insert into public.rooms values
('30000000-0000-0000-0000-000000000001','org-a','Hotel A','105','dirty',false,false,'{}',null),
('30000000-0000-0000-0000-000000000002','org-a','hotel-a','107','dirty',false,false,'{}',null),
('30000000-0000-0000-0000-000000000003','org-b','Hotel B','105','dirty',false,false,'{}',null),
('30000000-0000-0000-0000-000000000004','org-a','Hotel A','109','dirty',false,true,'{}',null),
('30000000-0000-0000-0000-000000000005','org-a','Hotel A','111','dirty',false,false,'{}',null);
insert into public.room_assignments(room_id,organization_slug,assigned_to,assignment_date,status,assignment_type,is_dnd) values
('30000000-0000-0000-0000-000000000001','org-a','20000000-0000-0000-0000-000000000001',(now() at time zone 'Europe/Budapest')::date,'assigned','daily_cleaning',false),
('30000000-0000-0000-0000-000000000002','org-a','20000000-0000-0000-0000-000000000002',(now() at time zone 'Europe/Budapest')::date,'assigned','daily_cleaning',false),
('30000000-0000-0000-0000-000000000003','org-b','20000000-0000-0000-0000-000000000003',(now() at time zone 'Europe/Budapest')::date,'assigned','daily_cleaning',false),
('30000000-0000-0000-0000-000000000004','org-a','20000000-0000-0000-0000-000000000001',(now() at time zone 'Europe/Budapest')::date,'assigned','checkout_cleaning',false);
insert into public.breakfast_roster values ('hotel-a','org-a',(now() at time zone 'Europe/Budapest')::date,'105',2,now());
insert into public.breakfast_attendance values
('40000000-0000-0000-0000-000000000001','hotel-a','org-a',(now() at time zone 'Europe/Budapest')::date,'105',1,'main',now()),
('40000000-0000-0000-0000-000000000002','hotel-a','org-a',(now() at time zone 'Europe/Budapest')::date,'105',1,'other',now()),
('40000000-0000-0000-0000-000000000003','hotel-a','org-a',(now() at time zone 'Europe/Budapest')::date,'107',1,'main',now()),
('40000000-0000-0000-0000-000000000004','hotel-a','org-a',(now() at time zone 'Europe/Budapest')::date - 1,'111',1,'main',now()),
('40000000-0000-0000-0000-000000000005','hotel-a','org-a',(now() at time zone 'Europe/Budapest')::date,'999',1,'main',now()),
('40000000-0000-0000-0000-000000000006','hotel-a','org-a',(now() at time zone 'Europe/Budapest')::date,'109',1,'main',now()),
('40000000-0000-0000-0000-000000000007','hotel-a','org-a',(now() at time zone 'Europe/Budapest')::date,'111',1,'main',now());

set role service_role;
do $$
declare v record;
begin
  select * into v from public.record_breakfast_signal('hotel-a','105',1,'main','40000000-0000-0000-0000-000000000001');
  if not found or not v.promotable or v.user_id <> '20000000-0000-0000-0000-000000000001' then raise exception 'eligible recipient wrong'; end if;
  perform public.record_breakfast_signal('hotel-a','105',1,'other','40000000-0000-0000-0000-000000000002');
  perform public.record_breakfast_signal('hotel-a','105',1,'other','40000000-0000-0000-0000-000000000002');
  perform public.record_breakfast_signal('hotel-a','107',1,'main','40000000-0000-0000-0000-000000000003');
  if exists(select from public.record_breakfast_signal('hotel-a','111',1,'main','40000000-0000-0000-0000-000000000004')) then raise exception 'historical mark created signal'; end if;
  if exists(select from public.record_breakfast_signal('hotel-a','999',1,'main','40000000-0000-0000-0000-000000000005')) then raise exception 'unknown room created signal'; end if;
  select * into v from public.record_breakfast_signal('hotel-a','109',1,'main','40000000-0000-0000-0000-000000000006');
  if not found or v.promotable or v.user_id is not null then raise exception 'checkout promoted'; end if;
  select * into v from public.record_breakfast_signal('hotel-a','111',1,'main','40000000-0000-0000-0000-000000000007');
  if not found or v.promotable or v.user_id is not null then raise exception 'unassigned room promoted or lost'; end if;
end $$;
reset role;
do $$
begin
  if (select count(*) from public.housekeeping_breakfast_signals) <> 4 then raise exception 'wrong signal count'; end if;
  if not exists(select 1 from public.housekeeping_breakfast_signals where room_number='105' and guests_seen=2 and guests_expected=2 and cardinality(locations)=2 and cardinality(attendance_ids)=2) then raise exception 'idempotency or partial count incorrect'; end if;
  if has_function_privilege('anon','public.record_breakfast_signal(text,text,integer,text,uuid)','execute') or has_function_privilege('authenticated','public.record_breakfast_signal(text,text,integer,text,uuid)','execute') then raise exception 'record RPC exposed'; end if;
  if has_table_privilege('authenticated','public.housekeeping_breakfast_signals','update') or has_column_privilege('authenticated','public.housekeeping_breakfast_signals','attendance_ids','select') then raise exception 'staff write or private field exposed'; end if;
end $$;

set role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',false);
do $$
declare own_id uuid;
begin
  if (select count(id) from public.housekeeping_breakfast_signals) <> 2 then raise exception 'housekeeper A sees wrong rooms'; end if;
  if exists(select id from public.housekeeping_breakfast_signals where room_number='107') then raise exception 'housekeeper A sees B room'; end if;
  select id into own_id from public.housekeeping_breakfast_signals where room_number='105';
  if not public.close_breakfast_signal(own_id,'guest_in_room') then raise exception 'own dismissal failed'; end if;
end $$;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',false);
do $$ begin if (select count(id) from public.housekeeping_breakfast_signals) <> 1 then raise exception 'housekeeper B sees wrong rooms'; end if; end $$;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',false);
do $$ begin if (select count(id) from public.housekeeping_breakfast_signals) <> 0 then raise exception 'tenant isolation failed'; end if; end $$;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',false);
do $$ begin if (select count(id) from public.housekeeping_breakfast_signals) <> 4 then raise exception 'manager access incorrect'; end if; end $$;
reset role;

-- Verify rollback on the disposable database.
alter publication supabase_realtime drop table public.housekeeping_breakfast_signals;
drop function public.close_breakfast_signal(uuid,text);
drop function public.record_breakfast_signal(text,text,integer,text,uuid);
drop table public.housekeeping_breakfast_signals;
alter table public.housekeeping_automation_settings drop column breakfast_signal_enabled, drop column breakfast_signal_window_minutes;
