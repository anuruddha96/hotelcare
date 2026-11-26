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
create type public.user_role as enum ('housekeeping','housekeeping_manager','manager','supervisor','top_management','top_management_manager','admin','breakfast_staff','reception','front_office','reception_manager');
create table public.profiles(id uuid primary key, organization_slug text, role public.user_role, deleted_at timestamptz, preferred_language text default 'en');
create table public.room_assignments(room_id uuid, organization_slug text, assigned_to uuid, assignment_date date, status text, assignment_type text, is_dnd boolean, pms_hold boolean not null default false, service_result text, notes text, id uuid primary key default gen_random_uuid());
create table public.breakfast_attendance(id uuid primary key, hotel_id text, organization_slug text, stay_date date, room_number text, served_count integer, location text, created_at timestamptz);
create table public.daily_overview_snapshots(hotel_id text, organization_slug text, business_date date, room_number text, pax integer, source text, captured_at timestamptz);
create table public.breakfast_roster(hotel_id text, organization_slug text, stay_date date, room_number text, pax integer, uploaded_at timestamptz);
-- Existing access helper contracts represented by deterministic test doubles.
-- Signature from production acceptance fixture supabase/tests/schema/ntak-production-helpers.sql; also used in 20261007130000_optimize_hot_rls_paths.sql.
create function public.get_user_organization_slug(user_id uuid) returns text language sql stable security definer set search_path = '' as $$ select p.organization_slug from public.profiles p where p.id=user_id $$;
-- Signature and user_role return type from supabase/tests/schema/ntak-production-helpers.sql; also used in 20261007130000_optimize_hot_rls_paths.sql.
create function public.get_user_role(user_id uuid) returns public.user_role language sql stable security definer set search_path = '' as $$ select p.role from public.profiles p where p.id=user_id $$;
-- Signature from supabase/tests/schema/ntak-production-helpers.sql, also used in 20261122083500_restaurant_reservation_staff_security.sql.
create function public.user_can_access_hotel(_uid uuid,_hotel_id text) returns boolean language sql stable security definer set search_path = '' as $$ select exists(select 1 from public.hotel_configurations h join public.organizations o on o.id=h.organization_id join public.profiles p on p.organization_slug=o.slug where h.hotel_id=_hotel_id and p.id=_uid) $$;
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

-- Phase 2: real-role outbox and undo tests. Age the queue rather than wait
-- wall-clock minutes; receipt deadlines remain the database clock.
\ir ../migrations/20261126143000_housekeeping_breakfast_notifications.sql
update public.housekeeping_breakfast_signals set closed_at=now(),closed_reason='guest_in_room' where closed_at is null;
update public.profiles set preferred_language='hu' where id='20000000-0000-0000-0000-000000000001';
insert into public.housekeeping_automation_settings(organization_slug,hotel_id,breakfast_signal_enabled) values ('org-a','hotel-a',true),('org-b','hotel-b',false);
insert into public.rooms values
('30000000-0000-0000-0000-000000000201','org-a','Hotel A','201','dirty',false,false,'{}',null),
('30000000-0000-0000-0000-000000000202','org-a','hotel-a','202','dirty',false,false,'{}',null),
('30000000-0000-0000-0000-000000000203','org-a','Hotel A','203','dirty',false,false,'{}',null),
('30000000-0000-0000-0000-000000000204','org-a','Hotel A','204','dirty',true,false,'{}',null),
('30000000-0000-0000-0000-000000000205','org-a','Hotel A','205','dirty',false,false,'{}',null);
insert into public.room_assignments(room_id,organization_slug,assigned_to,assignment_date,status,assignment_type,is_dnd)
select id,'org-a','20000000-0000-0000-0000-000000000001',(now() at time zone 'Europe/Budapest')::date,'assigned','daily_cleaning',is_dnd
from public.rooms where room_number in ('201','202','203','204') and organization_slug='org-a';
insert into public.room_assignments(room_id,organization_slug,assigned_to,assignment_date,status,assignment_type,is_dnd)
values ('30000000-0000-0000-0000-000000000205','org-a','20000000-0000-0000-0000-000000000002',(now() at time zone 'Europe/Budapest')::date,'assigned','daily_cleaning',false);
insert into public.breakfast_attendance values
('40000000-0000-0000-0000-000000000201','hotel-a','org-a',(now() at time zone 'Europe/Budapest')::date,'201',1,'main',now()),
('40000000-0000-0000-0000-000000000202','hotel-a','org-a',(now() at time zone 'Europe/Budapest')::date,'202',1,'main',now()),
('40000000-0000-0000-0000-000000000203','hotel-a','org-a',(now() at time zone 'Europe/Budapest')::date,'203',1,'main',now()),
('40000000-0000-0000-0000-000000000204','hotel-a','org-a',(now() at time zone 'Europe/Budapest')::date,'204',1,'main',now()),
('40000000-0000-0000-0000-000000000205','hotel-a','org-a',(now() at time zone 'Europe/Budapest')::date,'205',1,'main',now()),
('40000000-0000-0000-0000-000000000206','hotel-a','org-a',(now() at time zone 'Europe/Budapest')::date,'202',1,'other',now()),
('40000000-0000-0000-0000-000000000207','hotel-b','org-b',(now() at time zone 'Europe/Budapest')::date,'105',1,'main',now());
insert into public.housekeeping_breakfast_mark_receipts(attendance_id,organization_slug,hotel_id,actor_id,token_hash,created_at)
select id,organization_slug,hotel_id,'20000000-0000-0000-0000-000000000004',repeat('a',64),created_at
from public.breakfast_attendance where id::text like '40000000-0000-0000-0000-00000000020%';
set role service_role;
do $
declare v record; ids uuid[]; claim uuid; batch_tag text; n integer;
begin
  perform public.record_breakfast_signal('hotel-a','201',1,'main','40000000-0000-0000-0000-000000000201');
  perform public.record_breakfast_signal('hotel-a','202',1,'main','40000000-0000-0000-0000-000000000202');
  perform public.record_breakfast_signal('hotel-a','203',1,'main','40000000-0000-0000-0000-000000000203');
  perform public.record_breakfast_signal('hotel-a','204',1,'main','40000000-0000-0000-0000-000000000204');
  perform public.record_breakfast_signal('hotel-a','205',1,'main','40000000-0000-0000-0000-000000000205');
  perform public.record_breakfast_signal('hotel-a','202',1,'other','40000000-0000-0000-0000-000000000206');
  if exists(select from public.record_breakfast_signal('hotel-b','105',1,'main','40000000-0000-0000-0000-000000000207')) then raise exception 'disabled hotel created signal'; end if;
  if public.enqueue_breakfast_pushes(null) <> 4 then raise exception 'wrong queue count'; end if;
  if public.enqueue_breakfast_pushes(null) <> 0 then raise exception 'duplicate queue rows'; end if;
  if exists(select from public.housekeeping_breakfast_push_outbox where room_number='204') then raise exception 'DND queued'; end if;
  if exists(select from public.claim_breakfast_pushes(10)) then raise exception 'push sent before batching window'; end if;
  if exists(select from public.breakfast_mark_push_status('20000000-0000-0000-0000-000000000004','hotel-a','org-a',array['40000000-0000-0000-0000-000000000201']::uuid[]) where housekeeping_informed) then raise exception 'queued is not delivered'; end if;
  update public.housekeeping_breakfast_push_outbox set queued_at=now()-interval '3 minutes' where user_id='20000000-0000-0000-0000-000000000001';
  select array_agg(q.id),min(q.claim_token::text)::uuid,min(q.tag),count(distinct q.tag) into ids,claim,batch_tag,n from public.claim_breakfast_pushes(10) q;
  if cardinality(ids)<>3 or n<>1 or batch_tag not like 'housekeeping-breakfast-batch-%' then raise exception 'burst did not combine'; end if;
  if exists(select from public.claim_breakfast_pushes(10)) then raise exception 'claim duplicated in-flight rows'; end if;
  if (select count(*) from public.revalidate_breakfast_pushes(claim,ids))<>3 then raise exception 'unexpected revalidation'; end if;
  if public.finish_breakfast_pushes(claim,ids,true)<>3 then raise exception 'finish wrong'; end if;
  if not exists(select from public.breakfast_mark_push_status('20000000-0000-0000-0000-000000000004','hotel-a','org-a',array['40000000-0000-0000-0000-000000000201']::uuid[]) where housekeeping_informed) then raise exception 'delivery receipt missing'; end if;
  if exists(select from public.breakfast_mark_push_status('20000000-0000-0000-0000-000000000003','hotel-a','org-a',array['40000000-0000-0000-0000-000000000201']::uuid[])) then raise exception 'receipt leaked to other actor'; end if;
  if public.undo_breakfast_mark('40000000-0000-0000-0000-000000000201',repeat('b',64),'20000000-0000-0000-0000-000000000004','hotel-a','org-a') then raise exception 'wrong undo token accepted'; end if;
  if public.undo_breakfast_mark('40000000-0000-0000-0000-000000000201',repeat('a',64),'20000000-0000-0000-0000-000000000003','hotel-a','org-a') then raise exception 'wrong actor accepted'; end if;
  if not public.undo_breakfast_mark('40000000-0000-0000-0000-000000000201',repeat('a',64),'20000000-0000-0000-0000-000000000004','hotel-a','org-a') then raise exception 'undo failed'; end if;
  if not public.undo_breakfast_mark('40000000-0000-0000-0000-000000000206',repeat('a',64),'20000000-0000-0000-0000-000000000004','hotel-a','org-a') then raise exception 'partial undo failed'; end if;
  if not exists(select from public.housekeeping_breakfast_signals where room_number='201' and guests_seen=0 and closed_reason='undone') then raise exception 'full undo did not close'; end if;
  if not exists(select from public.housekeeping_breakfast_signals where room_number='202' and guests_seen=1 and closed_at is null) then raise exception 'partial undo did not recalculate'; end if;
  if (select count(*) from public.housekeeping_breakfast_push_outbox q where kind='correction' and q.tag=batch_tag and state='pending') <> 2 then raise exception 'correction did not replace original tag'; end if;
  -- A mark not delivered must not enqueue a correction.
  if not public.undo_breakfast_mark('40000000-0000-0000-0000-000000000204',repeat('a',64),'20000000-0000-0000-0000-000000000004','hotel-a','org-a') then raise exception 'DND mark undo failed'; end if;
  if exists(select from public.housekeeping_breakfast_push_outbox where kind='correction' and room_number='204') then raise exception 'correction without original delivery'; end if;
end $;
reset role;
do $
begin
  if exists(select 1 from public.breakfast_attendance where id='40000000-0000-0000-0000-000000000201') then raise exception 'undone attendance still exists'; end if;
  if has_table_privilege('authenticated','public.housekeeping_breakfast_mark_receipts','select') or has_table_privilege('anon','public.housekeeping_breakfast_push_outbox','select') then raise exception 'private queue exposed'; end if;
  if has_function_privilege('authenticated','public.claim_breakfast_pushes(integer)','execute') or has_function_privilege('anon','public.undo_breakfast_mark(uuid,text,uuid,text,text)','execute') then raise exception 'privileged RPC exposed'; end if;
end $;
-- Reassignment to B while the window has more than ten minutes remaining.
update public.room_assignments set assigned_to='20000000-0000-0000-0000-000000000002' where room_id='30000000-0000-0000-0000-000000000203';
set role service_role;
do $
declare v record; ids uuid[]; claim uuid;
begin
  if public.enqueue_breakfast_pushes(null)<>1 then raise exception 'new assignee not queued exactly once'; end if;
  if not exists(select from public.housekeeping_breakfast_push_outbox where room_number='203' and user_id='20000000-0000-0000-0000-000000000002' and state='pending') then raise exception 'new assignee incorrect'; end if;
  update public.housekeeping_breakfast_push_outbox set queued_at=now()-interval '3 minutes' where room_number='205' and state='pending';
  -- Mark the correction(s) and a single independent arrival as failed to
  -- simulate provider failure, without losing either the mark or signal.
  for v in select * from public.claim_breakfast_pushes(10) loop
    perform public.finish_breakfast_pushes(v.claim_token,array[v.id],false);
  end loop;
  if exists(select from public.breakfast_mark_push_status('20000000-0000-0000-0000-000000000004','hotel-a','org-a',array['40000000-0000-0000-0000-000000000205']::uuid[]) where housekeeping_informed) then raise exception 'failed push marked informed'; end if;
  if not exists(select from public.housekeeping_breakfast_signals where room_number='205' and closed_at is null) then raise exception 'push failure lost signal'; end if;
end $;
reset role;
do $ begin if not exists(select from public.breakfast_attendance where id='40000000-0000-0000-0000-000000000205') then raise exception 'push failure lost attendance'; end if; end $;
-- Phase 2 rollback on scratch only. Remove zero-count fixture rows so the
-- original stricter count constraint can be restored.
drop function public.breakfast_mark_push_status(uuid,text,text,uuid[]);
drop function public.undo_breakfast_mark(uuid,text,uuid,text,text);
drop function public.finish_breakfast_pushes(uuid,uuid[],boolean);
drop function public.queue_breakfast_push_correction(uuid,uuid);
drop function public.revalidate_breakfast_pushes(uuid,uuid[]);
drop function public.claim_breakfast_pushes(integer);
drop function public.enqueue_breakfast_pushes(uuid);
drop function public.breakfast_push_candidates(uuid);
drop trigger breakfast_notification_cycle on public.housekeeping_breakfast_signals;
drop function public.breakfast_notification_cycle_trigger();
drop table public.housekeeping_breakfast_push_outbox,public.housekeeping_breakfast_mark_receipts;
delete from public.housekeeping_breakfast_signals where guests_seen=0;
alter table public.housekeeping_breakfast_signals drop constraint housekeeping_breakfast_signals_guests_seen_check;
alter table public.housekeeping_breakfast_signals add constraint housekeeping_breakfast_signals_guests_seen_check check(guests_seen>0);
alter table public.housekeeping_breakfast_signals drop column notification_cycle;
alter table public.housekeeping_automation_settings drop column breakfast_push_enabled;

-- Verify rollback on the disposable database.
alter publication supabase_realtime drop table public.housekeeping_breakfast_signals;
drop function public.close_breakfast_signal(uuid,text);
drop function public.record_breakfast_signal(text,text,integer,text,uuid);
drop table public.housekeeping_breakfast_signals;
alter table public.housekeeping_automation_settings drop column breakfast_signal_enabled, drop column breakfast_signal_window_minutes;
