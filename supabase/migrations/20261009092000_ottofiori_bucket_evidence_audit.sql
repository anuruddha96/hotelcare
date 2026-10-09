-- Ottofiori only: classify from fresh PMS evidence, not unrelated note/metadata writes.
CREATE OR REPLACE FUNCTION public.hc_ottofiori_bucket_evidence_changed(
  p_old jsonb, p_new jsonb
) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT EXISTS (
    SELECT 1 FROM unnest(ARRAY[
      'pmsSyncDate','lastPmsRefreshDate','lastServerMorningSyncAt',
      'departureDate','arrivalDate','scheduledDepartureToday',
      'scheduledDepartureTomorrow','checkedOutToday','notArrived','occupiedToday',
      'isNoShow','manual_no_show','manual_daily','manual_checkout','manual_moved_at',
      'dailyOverviewDepartureDate','dailyOverviewDepartureSource','reservationStatusId'
    ]) AS evidence(key)
    WHERE (coalesce(p_old,'{}'::jsonb)->evidence.key)
          IS DISTINCT FROM (coalesce(p_new,'{}'::jsonb)->evidence.key)
  );
$$;
COMMENT ON FUNCTION public.hc_ottofiori_bucket_evidence_changed(jsonb,jsonb) IS
  'Pure decision on which reservation/manager fields require checkout reconciliation; cosmetic updates do not.';

-- Restricted metadata-free audit: do not copy guest names, notes or reservations.
CREATE TABLE IF NOT EXISTS public.pms_room_bucket_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_date date NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  hotel text NOT NULL,
  room_id uuid NOT NULL,
  room_number text NOT NULL,
  old_checkout boolean,
  new_checkout boolean,
  old_scheduled boolean,
  new_scheduled boolean,
  old_sync_date text,
  new_sync_date text,
  old_source text,
  new_source text,
  writer text NOT NULL DEFAULT current_user
);
CREATE INDEX IF NOT EXISTS pms_room_bucket_audit_room_time
  ON public.pms_room_bucket_audit(room_id,recorded_at DESC);
ALTER TABLE public.pms_room_bucket_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pms_room_bucket_audit FROM anon,authenticated;
GRANT SELECT,INSERT ON public.pms_room_bucket_audit TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.pms_room_bucket_audit_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.hc_audit_ottofiori_bucket_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, pg_temp AS $$
BEGIN
  IF NEW.hotel IS DISTINCT FROM 'Hotel Ottofiori' THEN RETURN NEW; END IF;
  IF OLD.is_checkout_room IS DISTINCT FROM NEW.is_checkout_room
     OR OLD.pms_metadata->>'scheduledDepartureToday'
        IS DISTINCT FROM NEW.pms_metadata->>'scheduledDepartureToday'
  THEN
    INSERT INTO public.pms_room_bucket_audit (
      business_date,hotel,room_id,room_number,
      old_checkout,new_checkout,old_scheduled,new_scheduled,
      old_sync_date,new_sync_date,old_source,new_source
    ) VALUES (
      (now() AT TIME ZONE 'Europe/Budapest')::date,
      NEW.hotel,NEW.id,NEW.room_number,
      OLD.is_checkout_room,NEW.is_checkout_room,
      nullif(OLD.pms_metadata->>'scheduledDepartureToday','')::boolean,
      nullif(NEW.pms_metadata->>'scheduledDepartureToday','')::boolean,
      OLD.pms_metadata->>'pmsSyncDate',NEW.pms_metadata->>'pmsSyncDate',
      OLD.pms_metadata->>'lastServerMorningSyncSource',
      NEW.pms_metadata->>'lastServerMorningSyncSource'
    );
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS zzz_hc_audit_ottofiori_bucket_change ON public.rooms;
CREATE TRIGGER zzz_hc_audit_ottofiori_bucket_change
AFTER UPDATE OF is_checkout_room,pms_metadata ON public.rooms
FOR EACH ROW EXECUTE FUNCTION public.hc_audit_ottofiori_bucket_change();
