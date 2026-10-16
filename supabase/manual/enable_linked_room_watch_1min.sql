-- OPTIONAL POST-APPROVAL OPERATIONS SCRIPT. NOT a Supabase migration.
-- Apply only after the PR, schema, worker deployment, and separate
-- live-inventory authorization have been approved.
--
-- First create a Vault secret named 'hotelcare_linked_room_service_role_key'
-- containing the project's service-role token. Never put the token in git.
-- This worker accepts ONLY the service-role Authorization bearer.
do $$
begin
  if not exists(
    select 1 from vault.secrets where name='hotelcare_linked_room_service_role_key'
  ) then
    raise exception 'Configure Vault hotelcare_linked_room_service_role_key before enabling scheduler';
  end if;
end $$;

do $$
declare existing_job record;
begin
  for existing_job in
    select jobid from cron.job where jobname='hotelcare-linked-room-watch-1min'
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;
  perform cron.schedule('hotelcare-linked-room-watch-1min','* * * * *',
  $job$
    select net.http_post(
      url:='https://pcmszqqklkolvvlabohq.supabase.co/functions/v1/room-sale-overnight-watch',
      headers:=jsonb_build_object(
        'Content-Type','application/json',
        'Authorization','Bearer ' || (
          select decrypted_secret from vault.decrypted_secrets
          where name='hotelcare_linked_room_service_role_key' limit 1
        )
      ),
      body:=jsonb_build_object('trigger','cron','kind','linked_room_1min'),
      timeout_milliseconds:=55000
    ) as request_id;
  $job$);
end $$;
-- Rollback when needed:
-- select cron.unschedule('hotelcare-linked-room-watch-1min');
