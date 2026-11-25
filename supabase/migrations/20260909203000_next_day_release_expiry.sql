-- A plan should never remain Approved forever after the worker's retry window is
-- exhausted. Mark it Failed with an audit reason so managers can clearly see the
-- terminal state and deliberately reopen it as Draft if work still needs release.

create or replace function public.expire_stranded_next_day_housekeeping_releases()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  with expired as (
    update public.next_day_housekeeping_plans p
    set status = 'failed',
        release_revalidation_status = 'failed',
        release_revalidation_result = coalesce(p.release_revalidation_result, '{}'::jsonb)
          || jsonb_build_object(
            'expired', true,
            'expired_at', now(),
            'attempt_count', p.release_revalidation_attempt_count,
            'reason', case
              when p.release_revalidation_attempt_count >= 60 then 'maximum_revalidation_attempts_reached'
              else 'release_retry_window_expired'
            end
          ),
        last_error = case
          when p.release_revalidation_attempt_count >= 60
            then 'Automatic housekeeping release stopped after the maximum Previo revalidation attempts.'
          else 'Automatic housekeeping release retry window expired after 8 hours.'
        end
    where p.status = 'approved'
      and p.auto_release = true
      and p.scheduled_release_at <= now()
      and (
        p.scheduled_release_at <= now() - interval '8 hours'
        or (
          p.release_revalidation_attempt_count >= 60
          and coalesce(p.release_revalidation_attempted_at, p.scheduled_release_at) <= now() - interval '10 minutes'
        )
      )
    returning p.id
  )
  select count(*)::integer into v_count from expired;

  return v_count;
end;
$$;

revoke all on function public.expire_stranded_next_day_housekeeping_releases() from public;
revoke all on function public.expire_stranded_next_day_housekeeping_releases() from anon;
revoke all on function public.expire_stranded_next_day_housekeeping_releases() from authenticated;
grant execute on function public.expire_stranded_next_day_housekeeping_releases() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'hotelcare-expire-stranded-housekeeping-releases') then
      perform cron.unschedule('hotelcare-expire-stranded-housekeeping-releases');
    end if;
    perform cron.schedule(
      'hotelcare-expire-stranded-housekeeping-releases',
      '*/15 * * * *',
      'select public.expire_stranded_next_day_housekeeping_releases();'
    );
  end if;
end
$$;