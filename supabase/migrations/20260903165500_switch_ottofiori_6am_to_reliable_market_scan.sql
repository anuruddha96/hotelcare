create or replace function public.invoke_ottofiori_market_scan(_force boolean default false)
returns bigint
language plpgsql
security definer
set search_path = public, cron, net
as $$
declare
  _anon_key text;
  _request_id bigint;
begin
  if not _force and extract(hour from timezone('Europe/Budapest', now())) <> 6 then
    return null;
  end if;

  -- Reuse the already configured project anon JWT from an existing internal
  -- cron job instead of duplicating credentials in migrations or source code.
  select (regexp_match(command, 'apikey[^A-Za-z0-9_-]+([A-Za-z0-9._-]+)'))[1]
    into _anon_key
  from cron.job
  where jobname = 'revenue-automation-scheduler-10min'
  limit 1;

  if _anon_key is null then
    raise exception 'Could not resolve project anon key from internal cron configuration';
  end if;

  select net.http_post(
    url := 'https://pcmszqqklkolvvlabohq.supabase.co/functions/v1/ottofiori-market-scan',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', _anon_key,
      'Authorization', 'Bearer ' || _anon_key
    ),
    body := '{"days":60}'::jsonb
  ) into _request_id;

  return _request_id;
end;
$$;

revoke all on function public.invoke_ottofiori_market_scan(boolean) from public;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'ottofiori-competitor-rate-scan-6am') then
    perform cron.unschedule('ottofiori-competitor-rate-scan-6am');
  end if;
end $$;

select cron.schedule(
  'ottofiori-competitor-rate-scan-6am',
  '0 4,5 * * *',
  $cron$select public.invoke_ottofiori_market_scan(false);$cron$
);