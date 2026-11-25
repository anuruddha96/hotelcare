-- Assert cron job schedules, targets, public gateway keys and Vault token
-- compatibility without ever emitting the secret itself.
do $test$
declare
  good_token text;
  c integer;
  job record;
begin
  select count(*), max(secret) into c,good_token
  from vault.secrets where name='hotelcare_revenue_cron_token';
  if c<>1 or good_token !~ '^[0-9a-f]{64}$' then
    raise exception 'Vault worker token invalid or missing';
  end if;

  if not public.hotelcare_verify_revenue_cron_token(good_token) then
    raise exception 'Service role Vault verification rejected valid worker token';
  end if;
  if public.hotelcare_verify_revenue_cron_token(repeat('0',64)) or
     public.hotelcare_verify_revenue_cron_token('bad') or
     public.hotelcare_verify_revenue_cron_token(null) then
    raise exception 'Invalid worker tokens were accepted';
  end if;
  if has_function_privilege('anon','public.hotelcare_verify_revenue_cron_token(text)','EXECUTE')
     or has_function_privilege('authenticated','public.hotelcare_verify_revenue_cron_token(text)','EXECUTE')
     or not has_function_privilege('service_role','public.hotelcare_verify_revenue_cron_token(text)','EXECUTE') then
    raise exception 'RPC permission boundary was not applied';
  end if;

  for job in select * from cron.job loop
    if job.command not like '%x-hotelcare-worker%' or
       job.command not like '%vault.decrypted_secrets%' or
       job.command not like '%public-anon-test%' or
       job.command like '%' || good_token || '%' or
       not job.active then
      raise exception 'Cron job % has incorrect credentials or modified active state',job.jobname;
    end if;
    if job.jobname='revenue-publish-queue-3min' and
        (job.schedule<>'* * * * *' or job.command not like '%revenue-publish-queue%') then
      raise exception 'Publisher schedule changed';
    end if;
    if job.jobname='revenue-previo-sync-hourly' and
        (job.schedule<>'0 * * * *' or job.command not like '%sync_only%') then
      raise exception 'Previo sync schedule changed';
    end if;
    if job.jobname='revenue-automation-scheduler-10min' and
        (job.schedule<>'3-59/10 * * * *' or job.command not like '%"scheduled":true%') then
      raise exception 'Pricing scheduler cadence or payload changed';
    end if;
  end loop;
  raise notice 'Revenue cron Vault authentication passed all integration assertions';
end;
$test$;
