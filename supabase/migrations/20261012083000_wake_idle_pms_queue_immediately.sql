-- Wake the existing serial PMS queue immediately for manual manager requests.
-- The 1-minute cron remains as a fallback. Authorization stays with
-- enqueue_pms_manual_refresh; queue claims remain service-role-only and fenced.
-- pg_net sends only after the inserting transaction commits.
CREATE OR REPLACE FUNCTION public.wake_pms_manual_refresh_queue()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $$
BEGIN
  IF NEW.request_kind <> 'manual' THEN RETURN NEW; END IF;
  -- No call is needed when an execution already owns the global slot.
  -- That worker/next minute tick will claim the newly queued job.
  IF EXISTS (
    SELECT 1 FROM public.pms_refresh_queue
    WHERE status = 'running' AND lease_expires_at > now()
  ) THEN RETURN NEW; END IF;
  PERFORM net.http_post(
    url := 'https://pcmszqqklkolvvlabohq.supabase.co/functions/v1/pms-refresh-queue-worker',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-worker-secret',public.get_housekeeping_release_worker_secret()
    ),
    body := jsonb_build_object('trigger','manual_immediate','queued_job_id',NEW.id,'requested_at',now()),
    timeout_milliseconds := 210000
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Fail open to the durable queue; the minute cron is still the fallback.
  RAISE WARNING 'Immediate PMS queue wake failed, waiting for cron: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pms_manual_refresh_wake ON public.pms_refresh_queue;
CREATE TRIGGER pms_manual_refresh_wake
AFTER INSERT ON public.pms_refresh_queue
FOR EACH ROW WHEN (NEW.request_kind = 'manual')
EXECUTE FUNCTION public.wake_pms_manual_refresh_queue();

REVOKE ALL ON FUNCTION public.wake_pms_manual_refresh_queue() FROM PUBLIC;
