-- Secure scheduler wiring for the maintenance SLA escalation worker.
-- The worker secret lives in Supabase Vault and is never exposed to browser roles.

do $$
begin
  if not exists (
    select 1 from vault.secrets where name = 'maintenance_escalation_worker_secret'
  ) then
    perform vault.create_secret(
      encode(gen_random_bytes(32), 'hex'),
      'maintenance_escalation_worker_secret',
      'HotelCare maintenance SLA escalation worker secret'
    );
  end if;
end;
$$;

create or replace function public.get_maintenance_escalation_worker_secret()
returns text
language sql
stable
security definer
set search_path = public, vault
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = 'maintenance_escalation_worker_secret'
  limit 1;
$$;

revoke all on function public.get_maintenance_escalation_worker_secret() from public, anon, authenticated;
grant execute on function public.get_maintenance_escalation_worker_secret() to service_role;

do $$
declare
  existing_job record;
begin
  for existing_job in
    select jobid from cron.job where jobname = 'hotelcare-maintenance-sla-escalation'
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;

  perform cron.schedule(
    'hotelcare-maintenance-sla-escalation',
    '*/10 * * * *',
    $job$
      select net.http_post(
        url := 'https://pcmszqqklkolvvlabohq.supabase.co/functions/v1/maintenance-sla-escalation',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-worker-secret', (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'maintenance_escalation_worker_secret'
            limit 1
          )
        ),
        body := jsonb_build_object('trigger', 'cron', 'scheduled_at', now()),
        timeout_milliseconds := 120000
      ) as request_id;
    $job$
  );
end;
$$;
