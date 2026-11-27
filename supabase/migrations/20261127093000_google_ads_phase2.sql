-- Phase 2: Google Ads read-only ingestion. All API access is mediated by
-- verified edge functions. No browser role can query any of these tables.
create table public.google_ads_connections (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 google_subject text not null, email text not null, connected_by uuid not null,
 status text not null default 'active' check(status in ('active','expired','disconnected')),
 last_error text, updated_at timestamptz not null default now(),
 unique(organization_id,google_subject), unique(id,organization_id)
);
create table public.google_ads_credentials (
 connection_id uuid primary key references public.google_ads_connections(id) on delete cascade,
 refresh_ciphertext text not null, updated_at timestamptz not null default now()
);
create table public.google_ads_oauth_states (
 state_hash text primary key, user_id uuid not null, organization_id uuid not null references public.organizations(id) on delete cascade,
 verifier_ciphertext text not null, redirect_uri text not null, expires_at timestamptz not null
);
create table public.google_ads_accounts (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 connection_id uuid not null, customer_id text not null check(customer_id ~ '^[0-9]{10}$'),
 login_customer_id text check(login_customer_id ~ '^[0-9]{10}$'), name text not null, currency text not null, time_zone text not null,
 account_status text not null default 'UNKNOWN', enabled boolean not null default false, available boolean not null default true,
 last_sync_at timestamptz, last_error text, discovery_at timestamptz not null default now(),
 foreign key(connection_id,organization_id) references public.google_ads_connections(id,organization_id) on delete cascade,
 unique(connection_id,customer_id)
);
-- Only one authorized source can actively ingest a customer within an organization.
create unique index google_ads_one_active_customer on public.google_ads_accounts(organization_id,customer_id) where enabled;
create table public.google_ads_campaigns (
 account_id uuid not null references public.google_ads_accounts(id) on delete cascade, campaign_id text not null,
 name text not null, status text not null, channel text not null, primary key(account_id,campaign_id)
);
create table public.google_ads_campaign_daily (
 account_id uuid not null references public.google_ads_accounts(id) on delete cascade,
 campaign_id text not null, day date not null, payload jsonb not null, primary key(account_id,day,campaign_id)
);
create table public.google_ads_budgets (
 account_id uuid not null references public.google_ads_accounts(id) on delete cascade, campaign_id text not null, payload jsonb not null,
 primary key(account_id,campaign_id)
);
create table public.google_ads_budget_history (
 account_id uuid not null references public.google_ads_accounts(id) on delete cascade, day date not null, campaign_id text not null,
 payload jsonb not null, primary key(account_id,day,campaign_id)
);
create table public.google_ads_sync_jobs (
 account_id uuid primary key references public.google_ads_accounts(id) on delete cascade,
 due_at timestamptz not null default now(), history_next_end date, last_recent_at timestamptz, last_month_at timestamptz,
 last_deep_at timestamptz, lease uuid, lease_until timestamptz, attempts integer not null default 0
);
create index google_ads_due_jobs on public.google_ads_sync_jobs(due_at);
create table public.google_ads_sync_logs (
 id bigint generated always as identity primary key, account_id uuid not null references public.google_ads_accounts(id) on delete cascade,
 started_at timestamptz not null default now(), outcome text not null, detail text, start_day date, end_day date
);
create table public.google_ads_api_usage (
 id bigint generated always as identity primary key, at timestamptz not null default clock_timestamp(),
 category text not null check(category in ('sync','interactive'))
);
create index google_ads_usage_at on public.google_ads_api_usage(at);
do $$
declare t text;
begin
 foreach t in array array['connections','credentials','oauth_states','accounts','campaigns','campaign_daily','budgets','budget_history','sync_jobs','sync_logs','api_usage'] loop
  execute format('alter table public.google_ads_%I enable row level security',t);
  execute format('revoke all on table public.google_ads_%I from public, anon, authenticated',t);
  execute format('grant select,insert,update,delete on table public.google_ads_%I to service_role',t);
 end loop;
end $$;
grant usage,select on sequence public.google_ads_sync_logs_id_seq,public.google_ads_api_usage_id_seq to service_role;

-- Reserve conservatively per HTTP request including pages and failures.
-- Rolling 24h, serialized across all organizations using this project.
create function public.google_ads_reserve_operation(p_category text) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare n bigint; total bigint;
begin
 if p_category not in ('sync','interactive') then return false; end if;
 perform pg_advisory_xact_lock(62110927);
 select count(*),count(*) filter(where category=p_category) into total,n
 from public.google_ads_api_usage where at>clock_timestamp()-interval '24 hours';
 if total>=2304 or n>=case when p_category='sync' then 1728 else 576 end then return false; end if;
 insert into public.google_ads_api_usage(category) values(p_category);
 return true;
end $$;

-- Atomic attach: preserve existing credentials if Google omits a refresh token.
create function public.google_ads_attach(p_org uuid,p_user uuid,p_subject text,p_email text,p_cipher text) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare cid uuid;
begin
 insert into public.google_ads_connections(organization_id,google_subject,email,connected_by)
 values(p_org,p_subject,p_email,p_user)
 on conflict(organization_id,google_subject) do update set email=excluded.email,connected_by=excluded.connected_by,status='active',last_error=null,updated_at=now()
 returning id into cid;
 if p_cipher is not null then
  insert into public.google_ads_credentials(connection_id,refresh_ciphertext) values(cid,p_cipher)
  on conflict(connection_id) do update set refresh_ciphertext=excluded.refresh_ciphertext,updated_at=now();
 elsif not exists(select 1 from public.google_ads_credentials where connection_id=cid) then
  raise exception 'NO_REFRESH_TOKEN';
 end if;
 return cid;
end $$;
create function public.google_ads_disconnect(p_org uuid,p_connection uuid) returns boolean
language plpgsql security invoker set search_path = '' as $$
begin
 update public.google_ads_connections set status='disconnected',updated_at=now() where id=p_connection and organization_id=p_org;
 if not found then return false; end if;
 delete from public.google_ads_credentials where connection_id=p_connection;
 update public.google_ads_accounts set enabled=false where connection_id=p_connection;
 delete from public.google_ads_sync_jobs where account_id in(select id from public.google_ads_accounts where connection_id=p_connection);
 return true;
end $$;
create function public.google_ads_enable_account(p_org uuid,p_account uuid,p_enabled boolean) returns boolean
language plpgsql security invoker set search_path = '' as $$
begin
 update public.google_ads_accounts a set enabled=p_enabled where a.id=p_account and a.organization_id=p_org
 and (not p_enabled or (a.available and exists(select 1 from public.google_ads_connections c where c.id=a.connection_id and c.status='active')));
 if not found then return false; end if;
 if p_enabled then
  insert into public.google_ads_sync_jobs(account_id,history_next_end)
  select id, (now() at time zone time_zone)::date-31 from public.google_ads_accounts where id=p_account
  on conflict(account_id) do update set due_at=least(google_ads_sync_jobs.due_at,now());
 else delete from public.google_ads_sync_jobs where account_id=p_account;
 end if;
 return true;
end $$;

-- One lease per account; skip locked rows across worker invocations.
create function public.google_ads_claim_job(p_org uuid default null,p_account uuid default null) returns setof public.google_ads_sync_jobs
language plpgsql security invoker set search_path = '' as $$
begin
 return query
 with chosen as (
  select j.account_id from public.google_ads_sync_jobs j
  join public.google_ads_accounts a on a.id=j.account_id
  join public.google_ads_connections c on c.id=a.connection_id
  where a.enabled and a.available and c.status='active'
   and (p_org is null or a.organization_id=p_org) and (p_account is null or a.id=p_account)
   and (j.lease_until is null or j.lease_until<now())
   and (j.due_at<=now() or (p_account is not null and j.attempts=0))
  order by j.due_at,j.account_id limit 1 for update of j skip locked
 )
 update public.google_ads_sync_jobs j set lease=gen_random_uuid(),lease_until=now()+interval '10 minutes'
 from chosen where j.account_id=chosen.account_id returning j.*;
end $$;

-- Replace a fully fetched date window atomically, including rows Google removed
-- during attribution restatement. No partial result may advance the watermark.
create function public.google_ads_commit_report(p_account uuid,p_lease uuid,p_start date,p_end date,p_rows jsonb,p_budgets jsonb,p_today date,p_kind text,p_history_next date) returns boolean
language plpgsql security invoker set search_path = '' as $$
begin
 if not exists(select 1 from public.google_ads_sync_jobs j join public.google_ads_accounts a on a.id=j.account_id
 join public.google_ads_connections c on c.id=a.connection_id where j.account_id=p_account and j.lease=p_lease and j.lease_until>now()
 and a.enabled and a.available and c.status='active' for update of j) then return false; end if;
 delete from public.google_ads_campaign_daily where account_id=p_account and day between p_start and p_end;
 insert into public.google_ads_campaign_daily(account_id,campaign_id,day,payload)
 select p_account,r->>'campaignId',(r->>'date')::date,r from jsonb_array_elements(p_rows) r;
 insert into public.google_ads_campaigns(account_id,campaign_id,name,status,channel)
 select distinct on(r->>'campaignId') p_account,r->>'campaignId',r->>'name',r->>'status',r->>'channel'
 from jsonb_array_elements(p_rows) r order by r->>'campaignId',r->>'date' desc
 on conflict(account_id,campaign_id) do update set name=excluded.name,status=excluded.status,channel=excluded.channel;
 delete from public.google_ads_budgets where account_id=p_account;
 insert into public.google_ads_budgets(account_id,campaign_id,payload)
 select p_account,b->>'campaignId',b from jsonb_array_elements(p_budgets) b;
 delete from public.google_ads_budget_history where account_id=p_account and day=p_today;
 insert into public.google_ads_budget_history(account_id,day,campaign_id,payload)
 select p_account,p_today,b->>'campaignId',b from jsonb_array_elements(p_budgets) b;
 update public.google_ads_accounts set last_sync_at=now(),last_error=null where id=p_account;
 update public.google_ads_sync_jobs set
  due_at=now()+interval '1 hour',lease=null,lease_until=null,attempts=0,
  last_recent_at=case when p_kind in ('recent','month','deep') then now() else last_recent_at end,
  last_month_at=case when p_kind in ('month','deep') then now() else last_month_at end,
  last_deep_at=case when p_kind='deep' then now() else last_deep_at end,
  history_next_end=case when p_kind='history' then p_history_next else history_next_end end
 where account_id=p_account;
 insert into public.google_ads_sync_logs(account_id,outcome,detail,start_day,end_day) values(p_account,'success',p_kind,p_start,p_end);
 return true;
end $$;
create function public.google_ads_fail_job(p_account uuid,p_lease uuid,p_code text) returns boolean
language plpgsql security invoker set search_path = '' as $$
begin
 update public.google_ads_sync_jobs set lease=null,lease_until=null,attempts=attempts+1,
 due_at=now()+least(interval '24 hours',interval '5 minutes'*power(2,least(attempts,8)))
 where account_id=p_account and lease=p_lease;
 if not found then return false; end if;
 update public.google_ads_accounts set last_error=p_code where id=p_account;
 insert into public.google_ads_sync_logs(account_id,outcome,detail) values(p_account,'error',p_code);
 return true;
end $$;
do $$
declare f regprocedure;
begin
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('google_ads_reserve_operation','google_ads_attach','google_ads_disconnect','google_ads_enable_account','google_ads_claim_job','google_ads_commit_report','google_ads_fail_job')
 loop execute format('revoke all on function %s from public,anon,authenticated',f); execute format('grant execute on function %s to service_role',f); end loop;
end $$;
