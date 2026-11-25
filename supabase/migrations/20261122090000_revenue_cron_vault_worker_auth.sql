-- Pre-deploy security migration for HotelCare revenue workers.
-- Existing pg_cron jobs currently carry only the PUBLIC anon JWT in apikey.
-- Create a dedicated 256-bit credential in Supabase Vault and add it to
-- existing cron HTTP headers without changing schedules, URLs or bodies.
-- Apply THIS MIGRATION before deploying the protected Edge Functions.
--
-- The token is never committed, logged, returned to clients, or stored inside
-- cron.job command text: pg_cron retrieves it from Vault at execution time.

do $migration$
declare
  token_count integer;
  token_value text;
begin
  select count(*) into token_count
  from vault.secrets where name = 'hotelcare_revenue_cron_token';

  if token_count = 0 then
    perform vault.create_secret(
      replace(pg_catalog.gen_random_uuid()::text, '-', '') ||
      replace(pg_catalog.gen_random_uuid()::text, '-', ''),
      'hotelcare_revenue_cron_token',
      'Internal pg_cron authentication for revenue pricing workers'
    );
  elsif token_count <> 1 then
    raise exception 'Revenue cron Vault token is not uniquely configured';
  end if;

  select ds.decrypted_secret into token_value
  from vault.decrypted_secrets ds
  where ds.name = 'hotelcare_revenue_cron_token';
  if token_value is null or token_value !~ '^[0-9a-f]{64}$' then
    raise exception 'Revenue cron Vault token is malformed';
  end if;
end;
$migration$;

-- Only service_role is allowed to verify the schedule token.
-- This is a bounded boolean check; it never returns decrypted Vault content.
create or replace function public.hotelcare_verify_revenue_cron_token(
  _candidate text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $verify$
declare
  expected text;
begin
  if _candidate is null or _candidate !~ '^[0-9a-f]{64}$' then
    return false;
  end if;
  select ds.decrypted_secret into strict expected
    from vault.decrypted_secrets ds
    where ds.name = 'hotelcare_revenue_cron_token';
  return pg_catalog.sha256(pg_catalog.convert_to(_candidate, 'UTF8'))
      = pg_catalog.sha256(pg_catalog.convert_to(expected, 'UTF8'));
exception
  when no_data_found or too_many_rows then return false;
end;
$verify$;

revoke all on function public.hotelcare_verify_revenue_cron_token(text)
  from public, anon, authenticated;
grant execute on function public.hotelcare_verify_revenue_cron_token(text)
  to service_role;

-- Patch only known active revenue jobs. The public anon apikey stays present
-- for Supabase's request gateway, but it no longer grants privileged access.
-- The Vault header is cryptographically distinct from public API keys.
do $cron_migration$
declare
  job record;
  updated_command text;
  updated_count integer := 0;
begin
  for job in
    select jobid, jobname, command
    from cron.job
    where jobname in (
      'revenue-publish-queue-3min',
      'revenue-previo-sync-hourly',
      'revenue-automation-scheduler-10min'
    )
  loop
    if job.command like '%x-hotelcare-worker%' then
      continue;
    end if;

    updated_command := pg_catalog.regexp_replace(
      job.command,
      $pattern$(headers[[:space:]]*:=[[:space:]]*)('[^']*'::jsonb)$pattern$,
      $replacement$\1(\2 || jsonb_build_object('x-hotelcare-worker', (select ds.decrypted_secret from vault.decrypted_secrets ds where ds.name = 'hotelcare_revenue_cron_token')))$replacement$,
      'i'
    );

    if updated_command = job.command then
      raise exception 'Could not update protected header in cron job %', job.jobname;
    end if;
    -- cron.alter_job preserves the original schedule, active state and target.
    perform cron.alter_job(job_id := job.jobid, command := updated_command);
    updated_count := updated_count + 1;
  end loop;

  raise notice 'Revenue cron header migration updated % existing jobs', updated_count;
end;
$cron_migration$;
