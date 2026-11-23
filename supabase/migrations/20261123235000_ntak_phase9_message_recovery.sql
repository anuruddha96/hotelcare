-- Phase 9: immutable resend links and auditable manual validation overrides.
ALTER TABLE public.ntak_messages ADD COLUMN IF NOT EXISTS resend_of uuid REFERENCES public.ntak_messages(id);
ALTER TABLE public.ntak_messages ADD COLUMN IF NOT EXISTS override_reason text CHECK (override_reason IS NULL OR (length(btrim(override_reason)) BETWEEN 1 AND 500));
ALTER TABLE public.ntak_messages ADD CONSTRAINT ntak_messages_resend_of_unique UNIQUE (resend_of);
ALTER TABLE public.ntak_daily_closures ADD COLUMN IF NOT EXISTS override_by uuid;
ALTER TABLE public.ntak_daily_closures ADD COLUMN IF NOT EXISTS override_reason text CHECK (override_reason IS NULL OR (length(btrim(override_reason)) BETWEEN 1 AND 500));

-- Notify only authorized leadership using the existing property-scoped push dispatch.
-- Do not send guest data, XML, booking references or offending values in push.
CREATE OR REPLACE FUNCTION public.ntak_notify_message_action()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (NEW.ntak_status IN ('VIZSGALANDO','TELJESEN_HIBAS') AND NEW.ntak_status IS DISTINCT FROM OLD.ntak_status)
     OR (NEW.state IN ('rejected','failed','blocked') AND NEW.state IS DISTINCT FROM OLD.state AND (NEW.ntak_status IS NULL OR NEW.ntak_status = 'BEFOGADVA')) THEN
    PERFORM public.hotelcare_dispatch_push(
      public.hotelcare_push_recipients(NEW.organization_slug, NEW.hotel_id, ARRAY['admin','top_management','top_management_manager']),
      'NTAK reporting needs attention', 'Open Reception reports to review an NTAK message.',
      '/reception', 'ntak-action-' || NEW.id::text, 'ntak-reporting-action',
      jsonb_build_object('hotelId', NEW.hotel_id, 'messageId', NEW.id)
    );
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'NTAK notification dispatch failed: %', SQLERRM;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.ntak_notify_message_action() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER ntak_message_action_push AFTER UPDATE OF ntak_status, state ON public.ntak_messages
FOR EACH ROW EXECUTE FUNCTION public.ntak_notify_message_action();
