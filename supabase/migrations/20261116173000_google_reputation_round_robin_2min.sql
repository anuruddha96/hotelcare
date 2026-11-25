-- Google Business review polling: spread requests across venues without increasing
-- the overall quota footprint. The worker selects ONE active connected listing
-- per two-minute tick. With 8 listings, each refreshes approximately every 16 min.
-- Manual worker requests without mode=round_robin still support full sync.
do $$
declare existing_job bigint;
begin
  for existing_job in
    select jobid from cron.job
    where jobname in ('google-reputation-worker-15min', 'google-reputation-round-robin-2min')
  loop
    perform cron.unschedule(existing_job);
  end loop;
end $$;

select cron.schedule(
  'google-reputation-round-robin-2min',
  '*/2 * * * *',
  $cron$
    select net.http_post(
      url := 'https://pcmszqqklkolvvlabohq.supabase.co/functions/v1/google-reputation-worker',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-worker-secret', public.get_google_reputation_worker_secret()
      ),
      body := jsonb_build_object(
        'trigger', 'cron',
        'mode', 'round_robin',
        'scheduled_at', now()
      )
    ) as request_id;
  $cron$
);
