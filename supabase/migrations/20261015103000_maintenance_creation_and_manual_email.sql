-- Notification at issue creation (stage 0), followed by configurable repair
-- deadline reminders (levels 1 and 2). 0 is NOT an overdue alert.
ALTER TABLE public.maintenance_escalation_settings
  ADD COLUMN IF NOT EXISTS creation_emails text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS notify_on_creation boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_property_staff boolean NOT NULL DEFAULT true;

ALTER TABLE public.maintenance_escalation_events
  DROP CONSTRAINT IF EXISTS maintenance_escalation_events_escalation_level_check;
ALTER TABLE public.maintenance_escalation_events
  ADD CONSTRAINT maintenance_escalation_events_escalation_level_check CHECK (escalation_level IN (0,1,2));
ALTER TABLE public.maintenance_escalation_events
  DROP CONSTRAINT IF EXISTS maintenance_escalation_events_status_check;
ALTER TABLE public.maintenance_escalation_events
  ADD CONSTRAINT maintenance_escalation_events_status_check CHECK (status IN ('pending','claimed','sent','failed','skipped'));

CREATE OR REPLACE FUNCTION public.enqueue_new_maintenance_email()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_secret text;
BEGIN
 IF NEW.department <> 'maintenance' THEN RETURN NEW; END IF;
 INSERT INTO public.maintenance_escalation_events
   (ticket_id,organization_slug,hotel,escalation_level,threshold_at,status,attempt_count)
 VALUES (NEW.id,NEW.organization_slug,NEW.hotel,0,coalesce(NEW.created_at,now()),'pending',0)
 ON CONFLICT (ticket_id,escalation_level) DO NOTHING;
 -- pg_net dispatches AFTER commit, so this is near-immediate. The minute
 -- scheduler is a durable backup if the network or secrets are unavailable.
 BEGIN
   SELECT decrypted_secret INTO v_secret
     FROM vault.decrypted_secrets WHERE name = 'maintenance_escalation_worker_secret' LIMIT 1;
   IF v_secret IS NOT NULL THEN
     PERFORM net.http_post(
       url := 'https://pcmszqqklkolvvlabohq.supabase.co/functions/v1/maintenance-sla-escalation',
       headers := jsonb_build_object('Content-Type','application/json','x-worker-secret',v_secret),
       body := jsonb_build_object('trigger','ticket_created','ticket_id',NEW.id),
       timeout_milliseconds := 120000
     );
   END IF;
 EXCEPTION WHEN OTHERS THEN
   RAISE WARNING 'Maintenance notification dispatch queued but wakeup failed: %',SQLERRM;
 END;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enqueue_new_maintenance_email() FROM PUBLIC,anon,authenticated;

DROP TRIGGER IF EXISTS maintenance_ticket_creation_notification ON public.tickets;
CREATE TRIGGER maintenance_ticket_creation_notification
AFTER INSERT ON public.tickets FOR EACH ROW
EXECUTE FUNCTION public.enqueue_new_maintenance_email();

-- Preserve the existing unique(ticket_id, escalation_level) dedupe protection.
CREATE OR REPLACE FUNCTION public.claim_maintenance_escalation_event(
  p_ticket_id uuid,p_organization_slug text,p_hotel text,
  p_escalation_level smallint,p_threshold_at timestamptz,p_recipient_emails text[]
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid;
BEGIN
 IF p_escalation_level NOT IN (0,1,2) THEN RAISE EXCEPTION 'Invalid notification stage'; END IF;
 INSERT INTO public.maintenance_escalation_events
   (ticket_id,organization_slug,hotel,escalation_level,threshold_at,recipient_emails,status,attempt_count,error_message)
 VALUES (p_ticket_id,p_organization_slug,p_hotel,p_escalation_level,p_threshold_at,p_recipient_emails,'claimed',1,NULL)
 ON CONFLICT (ticket_id,escalation_level) DO UPDATE SET
   status='claimed',threshold_at=excluded.threshold_at,
   recipient_emails=excluded.recipient_emails,
   attempt_count=public.maintenance_escalation_events.attempt_count+1,
   error_message=NULL,updated_at=now()
 WHERE public.maintenance_escalation_events.attempt_count<5 AND (
   public.maintenance_escalation_events.status='pending'
   OR (public.maintenance_escalation_events.status='failed'
       AND public.maintenance_escalation_events.updated_at<now()-interval '5 minutes')
   OR (public.maintenance_escalation_events.status='claimed'
       AND public.maintenance_escalation_events.updated_at<now()-interval '15 minutes')
 )
 RETURNING id INTO v_id;
 RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_maintenance_escalation_event(uuid,text,text,smallint,timestamptz,text[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_maintenance_escalation_event(uuid,text,text,smallint,timestamptz,text[]) TO service_role;

-- Audit every explicit top-manager notification. Only the worker (service
-- role) writes; hotel-scoped top managers can read these entries.
CREATE TABLE IF NOT EXISTS public.maintenance_manual_email_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
 organization_slug text NOT NULL,
 hotel text NOT NULL,
 requested_by uuid NOT NULL REFERENCES public.profiles(id),
 recipient_id uuid NOT NULL REFERENCES public.profiles(id),
 recipient_email text NOT NULL,
 note text,
 status text NOT NULL CHECK(status IN ('claimed','sent','failed','skipped')),
 provider_message_id text,
 error_message text,
 created_at timestamptz NOT NULL DEFAULT now(),
 sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS maintenance_manual_email_events_ticket ON public.maintenance_manual_email_events(ticket_id,created_at DESC);
ALTER TABLE public.maintenance_manual_email_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Scoped top managers read their manual email audit"
 ON public.maintenance_manual_email_events FOR SELECT TO authenticated
 USING (public.can_manage_maintenance_escalation(organization_slug,hotel));
REVOKE ALL ON public.maintenance_manual_email_events FROM anon,authenticated;
GRANT SELECT ON public.maintenance_manual_email_events TO authenticated;

-- Durable backup for immediate notifications without waiting 10 minutes.
DO $$ DECLARE v_job record; BEGIN
 FOR v_job IN SELECT jobid FROM cron.job WHERE jobname='hotelcare-maintenance-sla-escalation' LOOP
   PERFORM cron.unschedule(v_job.jobid);
 END LOOP;
 PERFORM cron.schedule('hotelcare-maintenance-sla-escalation','* * * * *',
 $job$
 SELECT net.http_post(
   url := 'https://pcmszqqklkolvvlabohq.supabase.co/functions/v1/maintenance-sla-escalation',
   headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-worker-secret',(SELECT decrypted_secret FROM vault.decrypted_secrets
         WHERE name='maintenance_escalation_worker_secret' LIMIT 1)),
   body := jsonb_build_object('trigger','cron','scheduled_at',now()),
   timeout_milliseconds := 120000
 ) AS request_id;
 $job$);
END $$;
