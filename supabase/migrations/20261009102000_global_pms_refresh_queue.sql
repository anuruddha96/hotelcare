-- One durable, tenant-checked queue for full Previo PMS refreshes.
-- Scheduled jobs are staggered by ten minutes; manual jobs overtake only waiting
-- automatic jobs, never the in-flight job. The worker is the sole executor.
create table if not exists public.pms_refresh_queue (
 id uuid primary key default gen_random_uuid(),
 business_date date not null,
 hotel_id text not null,
 target_key text not null,
 request_kind text not null check (request_kind in ('automatic','manual')),
 request_group_id uuid,
 status text not null default 'queued' check (status in ('queued','running','success','partial','failed')),
 available_at timestamptz not null default now(),
 requested_at timestamptz not null default now(),
 requested_by uuid references auth.users(id) on delete set null,
 started_at timestamptz,
 finished_at timestamptz,
 lease_expires_at timestamptz,
 attempt integer not null default 0,
 result jsonb,
 error_message text,
 constraint pms_refresh_queue_key_guard check (
   (target_key like 'hotel:%' or target_key like 'account:%')
   and length(target_key) between 7 and 120
 )
);
create unique index if not exists pms_refresh_one_auto_per_target_day
 on public.pms_refresh_queue(business_date,target_key)
 where request_kind='automatic';
create index if not exists pms_refresh_pending_order
 on public.pms_refresh_queue(status,request_kind,available_at,requested_at);
create index if not exists pms_refresh_group_lookup
 on public.pms_refresh_queue(request_group_id) where request_group_id is not null;
create index if not exists pms_refresh_running_lease
 on public.pms_refresh_queue(lease_expires_at) where status='running';

alter table public.pms_refresh_queue enable row level security;
revoke all on public.pms_refresh_queue from anon, authenticated;
grant select on public.pms_refresh_queue to authenticated;
drop policy if exists pms_refresh_own_request_read on public.pms_refresh_queue;
create policy pms_refresh_own_request_read on public.pms_refresh_queue
 for select to authenticated using (requested_by = auth.uid());
-- Authenticated callers never insert jobs directly; this SECURITY DEFINER
-- gateway verifies role, tenant, eligible target, and uses the database clock.
create or replace function public.enqueue_pms_manual_refresh(p_hotel_id text)
returns table (job_id uuid, request_group_id uuid, target_key text, status text)
language plpgsql security definer set search_path=public,pg_temp as $$
declare
 v_role text; v_org text; v_assigned text; v_hotel text; v_group uuid := gen_random_uuid();
 v_target record; v_normalized text;
begin
 if auth.uid() is null then raise exception 'Sign in to refresh PMS'; end if;
 select role,organization_slug,assigned_hotel
 into v_role,v_org,v_assigned from public.profiles where id=auth.uid();
 if v_role not in ('admin','top_management','top_management_manager','manager','housekeeping_manager','reception_manager','front_office')
 then raise exception 'Your role cannot request a PMS refresh'; end if;
 v_hotel := trim(coalesce(p_hotel_id,''));
 v_normalized := regexp_replace(lower(coalesce(v_assigned,'')), '[^a-z0-9]','','g');
 if v_org = 'slnt' then
   if v_hotel <> 'slnt-group' then raise exception 'Not your PMS portfolio'; end if;
   for v_target in
     select 'account:'||a.id::text as key from public.pms_accounts a
     where a.hotel_id='slnt-group' and a.organization_slug='slnt'
       and a.pms_type='previo' and a.is_active=true and a.sync_paused=false
     order by a.label,a.id
   loop
     insert into public.pms_refresh_queue AS q (business_date,hotel_id,target_key,request_kind,request_group_id,requested_by)
     values ((now() at time zone 'Europe/Budapest')::date,v_hotel,v_target.key,'manual',v_group,auth.uid())
     returning q.id,q.request_group_id,q.target_key,q.status into job_id,request_group_id,target_key,status;
     return next;
   end loop;
 elsif v_org = 'rdhotels' then
   if v_hotel not in ('memories-budapest','mika-downtown','ottofiori','gozsdu-court')
   then raise exception 'Unsupported hotel'; end if;
   if v_role not in ('admin','top_management','top_management_manager') and
     not (
       (v_hotel = 'ottofiori' and v_normalized in ('ottofiori','hotelottofiori')) or
       (v_hotel = 'mika-downtown' and v_normalized in ('mikadowntown','hotelmikadowntown')) or
       (v_hotel = 'memories-budapest' and v_normalized in ('memoriesbudapest','hotelmemoriesbudapest')) or
       (v_hotel = 'gozsdu-court' and v_normalized in ('gozsducourt','gozsducourtbudapest'))
     )
   then raise exception 'You cannot refresh another property'; end if;
   if not exists(select 1 from public.pms_configurations c where c.hotel_id=v_hotel and
       c.pms_type='previo' and c.is_active and c.sync_enabled)
   then raise exception 'Previo is not active for this hotel'; end if;
   insert into public.pms_refresh_queue AS q (business_date,hotel_id,target_key,request_kind,request_group_id,requested_by)
   values ((now() at time zone 'Europe/Budapest')::date,v_hotel,'hotel:'||v_hotel,'manual',v_group,auth.uid())
   returning q.id,q.request_group_id,q.target_key,q.status into job_id,request_group_id,target_key,status;
   return next;
 else
   raise exception 'Not a supported Previo portfolio';
 end if;
end $$;
revoke all on function public.enqueue_pms_manual_refresh(text) from public,anon;
grant execute on function public.enqueue_pms_manual_refresh(text) to authenticated;

-- Atomic claim: the advisory transaction lock serializes competing cron calls
-- and any currently running (unexpired) job blocks all other hotels/accounts.
create or replace function public.claim_next_pms_refresh()
returns setof public.pms_refresh_queue language plpgsql security definer
set search_path=public,pg_temp as $$
declare v_id uuid;
begin
 if auth.role() <> 'service_role' then raise exception 'Worker only'; end if;
 perform pg_advisory_xact_lock(882001, 20261009);
 -- Ten-minute lease is longer than the maximum Edge execution lifetime.
 update public.pms_refresh_queue set status='failed',finished_at=now(),
   error_message='Worker lease expired; inspect before manually retrying',lease_expires_at=null
 where status='running' and lease_expires_at <= now();
 if exists(select 1 from public.pms_refresh_queue where status='running') then return; end if;
 select q.id into v_id from public.pms_refresh_queue q
 where q.status='queued' and q.available_at<=now()
   and (q.request_kind='manual' or not exists (
     select 1 from public.pms_refresh_queue p
     where p.request_kind='automatic'
       and p.started_at > now() - interval '10 minutes'
   ))
 order by case when q.request_kind='manual' then 0 else 1 end,
          q.available_at,q.requested_at,q.id limit 1 for update skip locked;
 if v_id is null then return; end if;
 return query update public.pms_refresh_queue q set
   status='running', started_at=now(),lease_expires_at=now()+interval '10 minutes',
   attempt=q.attempt+1 where q.id=v_id returning q.*;
end $$;
revoke all on function public.claim_next_pms_refresh() from public,anon,authenticated;
grant execute on function public.claim_next_pms_refresh() to service_role;

create or replace function public.finish_pms_refresh(
 p_job_id uuid,p_status text,p_result jsonb default null,p_error text default null
) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if auth.role() <> 'service_role' then raise exception 'Worker only'; end if;
 if p_status not in ('success','partial','failed') then raise exception 'Invalid completion status'; end if;
 update public.pms_refresh_queue set status=p_status,finished_at=now(),
   lease_expires_at=null,result=p_result,error_message=p_error
 where id=p_job_id and status='running';
 return found;
end $$;
revoke all on function public.finish_pms_refresh(uuid,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.finish_pms_refresh(uuid,text,jsonb,text) to service_role;

-- The existing ten-minute job must be retired only after the new worker has
-- been deployed and verified. Deployment runbook handles this cutover.
