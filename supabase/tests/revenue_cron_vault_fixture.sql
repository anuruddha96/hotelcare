-- In-memory Postgres 16 fixture for the Supabase Vault/pg_cron migration.
-- No real credentials, network calls or production data.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;

create schema vault;
create table vault.secrets (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  secret text not null,
  description text
);
create view vault.decrypted_secrets as
  select id, name, secret, secret as decrypted_secret from vault.secrets;

create function vault.create_secret(new_secret text, new_name text, new_description text default null, new_key_id uuid default null)
returns uuid language plpgsql as $$
declare new_id uuid := gen_random_uuid();
begin
  insert into vault.secrets(id,name,secret,description)
    values(new_id,new_name,new_secret,new_description);
  return new_id;
end;
$$;

create schema cron;
create table cron.job (
  jobid bigserial primary key,
  jobname text unique not null,
  schedule text not null,
  command text not null,
  active boolean not null default true
);
create function cron.alter_job(job_id bigint, schedule text default null, command text default null, database text default null, username text default null, active boolean default null)
returns void language plpgsql as $$
begin
 update cron.job set
   schedule = coalesce(alter_job.schedule, cron.job.schedule),
   command = coalesce(alter_job.command, cron.job.command),
   active = coalesce(alter_job.active, cron.job.active)
 where jobid=job_id;
end;
$$;

insert into cron.job(jobname,schedule,command) values
('revenue-publish-queue-3min','* * * * *',
 $job$select net.http_post(url:='https://example.supabase.co/functions/v1/revenue-publish-queue', headers:='{"Content-Type":"application/json","apikey":"public-anon-test"}'::jsonb, body:='{"trigger":"cron"}'::jsonb)$job$),
('revenue-previo-sync-hourly','0 * * * *',
 $job$select net.http_post(url:='https://example.supabase.co/functions/v1/revenue-engine-tick', headers:='{"Content-Type":"application/json","apikey":"public-anon-test"}'::jsonb, body:='{"trigger":"sync_only"}'::jsonb)$job$),
('revenue-automation-scheduler-10min','3-59/10 * * * *',
 $job$select net.http_post(url:='https://example.supabase.co/functions/v1/revenue-pickup-automation', headers:='{"Content-Type":"application/json","apikey":"public-anon-test"}'::jsonb, body:='{"scheduled":true}'::jsonb)$job$);
