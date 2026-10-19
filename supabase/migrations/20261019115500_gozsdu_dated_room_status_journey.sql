-- Gozsdu-only audit ledger for room reservation/occupancy transitions.
-- No existing room, reservation, assignment or inventory row is rewritten.
-- Contains only operational status + reservation IDs (no guest PII).
SET lock_timeout = '3s';
SET statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS public.gozsdu_room_state_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_slug text NOT NULL,
  hotel_id text NOT NULL DEFAULT 'gozsdu-court' CHECK (hotel_id = 'gozsdu-court'),
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  business_date date NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  source text NOT NULL DEFAULT 'room_sync',
  before_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_state jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_gozsdu_room_journey_room_date
  ON public.gozsdu_room_state_events (room_id, business_date DESC, recorded_at DESC);

ALTER TABLE public.gozsdu_room_state_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gozsdu_room_state_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.gozsdu_room_state_events TO authenticated;
DROP POLICY IF EXISTS gozsdu_room_state_events_scoped_read ON public.gozsdu_room_state_events;
CREATE POLICY gozsdu_room_state_events_scoped_read ON public.gozsdu_room_state_events
  FOR SELECT TO authenticated USING (
    (organization_slug = public.get_user_organization_slug((SELECT auth.uid()))
      OR public.is_super_admin((SELECT auth.uid())))
    AND public.user_can_access_hotel((SELECT auth.uid()), 'gozsdu-court')
  );

CREATE OR REPLACE FUNCTION public.hc_record_gozsdu_room_status_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  old_pms jsonb := COALESCE(OLD.pms_metadata, '{}'::jsonb);
  new_pms jsonb := COALESCE(NEW.pms_metadata, '{}'::jsonb);
  before_state jsonb;
  after_state jsonb;
  work_date date := (statement_timestamp() AT TIME ZONE 'Europe/Budapest')::date;
BEGIN
  IF NEW.hotel NOT IN ('gozsdu-court', 'Gozsdu Court Budapest')
    OR NEW.organization_slug IS NULL THEN
    RETURN NEW;
  END IF;

  before_state := jsonb_build_object(
    'reservationId', old_pms -> 'reservationId',
    'reservationStatusId', old_pms -> 'reservationStatusId',
    'arrivalDate', old_pms -> 'arrivalDate',
    'departureDate', old_pms -> 'departureDate',
    'arrivalToday', old_pms -> 'arrivalToday',
    'scheduledDepartureToday', old_pms -> 'scheduledDepartureToday',
    'checkedOutToday', old_pms -> 'checkedOutToday',
    'isNoShow', old_pms -> 'isNoShow',
    'noShowSource', old_pms -> 'noShowSource',
    'pmsOccupancyStatus', old_pms -> 'pmsOccupancyStatus',
    'pmsSyncDate', old_pms -> 'pmsSyncDate',
    'isCheckoutRoom', OLD.is_checkout_room,
    'housekeepingCondition', OLD.status
  );
  after_state := jsonb_build_object(
    'reservationId', new_pms -> 'reservationId',
    'reservationStatusId', new_pms -> 'reservationStatusId',
    'arrivalDate', new_pms -> 'arrivalDate',
    'departureDate', new_pms -> 'departureDate',
    'arrivalToday', new_pms -> 'arrivalToday',
    'scheduledDepartureToday', new_pms -> 'scheduledDepartureToday',
    'checkedOutToday', new_pms -> 'checkedOutToday',
    'isNoShow', new_pms -> 'isNoShow',
    'noShowSource', new_pms -> 'noShowSource',
    'pmsOccupancyStatus', new_pms -> 'pmsOccupancyStatus',
    'pmsSyncDate', new_pms -> 'pmsSyncDate',
    'isCheckoutRoom', NEW.is_checkout_room,
    'housekeepingCondition', NEW.status
  );
  IF before_state IS NOT DISTINCT FROM after_state THEN RETURN NEW; END IF;
  IF (new_pms ->> 'pmsSyncDate') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
    BEGIN work_date := (new_pms ->> 'pmsSyncDate')::date;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN NULL;
    END;
  END IF;

  INSERT INTO public.gozsdu_room_state_events (
    organization_slug, hotel_id, room_id, business_date, source, before_state, after_state
  ) VALUES (
    NEW.organization_slug, 'gozsdu-court', NEW.id, work_date,
    CASE WHEN NEW.pms_metadata IS DISTINCT FROM OLD.pms_metadata THEN 'previo_room_sync'
      ELSE 'housekeeping_action' END,
    before_state, after_state
  );
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS hc_record_gozsdu_room_status_change ON public.rooms;
CREATE TRIGGER hc_record_gozsdu_room_status_change
  AFTER UPDATE OF pms_metadata, is_checkout_room, status ON public.rooms
  FOR EACH ROW EXECUTE FUNCTION public.hc_record_gozsdu_room_status_change();

REVOKE ALL ON FUNCTION public.hc_record_gozsdu_room_status_change() FROM PUBLIC, anon, authenticated;
