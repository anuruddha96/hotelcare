-- Gozsdu Court Budapest ONLY: publish the manager's real cleaning size, verified
-- bed count and hotel-specific time targets into the already-loaded PMS metadata.
-- Do not fabricate sqm, beds, floors, pricing or alter any other hotel's data.
-- This avoids changing the shared Previo room query or generic auto assign UI.
CREATE OR REPLACE FUNCTION public.stamp_gozsdu_autoassign_mapping()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_checkout integer;
DECLARE v_service integer;
DECLARE v_available text;
BEGIN
  IF NEW.hotel NOT IN ('gozsdu-court', 'Gozsdu Court Budapest') THEN RETURN NEW; END IF;
  SELECT service_status INTO v_available
    FROM public.gozsdu_housekeeping_room_registry WHERE room_id = NEW.id;
  IF v_available = 'operating' AND NEW.cleaning_size IN ('small','medium','large','extra_large') THEN
    SELECT t.duration_minutes INTO v_checkout
      FROM public.hotel_cleaning_time_targets t
      JOIN public.hotel_configurations hc ON hc.id = t.hotel_configuration_id
      WHERE hc.hotel_id = 'gozsdu-court' AND t.cleaning_size = NEW.cleaning_size
        AND t.assignment_type = 'checkout_cleaning' LIMIT 1;
    SELECT t.duration_minutes INTO v_service
      FROM public.hotel_cleaning_time_targets t
      JOIN public.hotel_configurations hc ON hc.id = t.hotel_configuration_id
      WHERE hc.hotel_id = 'gozsdu-court' AND t.cleaning_size = NEW.cleaning_size
        AND t.assignment_type = 'daily_cleaning' LIMIT 1;
  END IF;
  NEW.pms_metadata := jsonb_set(COALESCE(NEW.pms_metadata, '{}'::jsonb), '{gozsduAutoAssign}',
    jsonb_build_object(
      'cleaningSize', CASE WHEN v_available = 'operating' THEN NEW.cleaning_size ELSE NULL END,
      'verifiedBedCount', CASE WHEN v_available = 'operating' THEN NEW.verified_bed_count ELSE NULL END,
      'checkoutMinutes', v_checkout,
      'serviceMinutes', v_service
    ), true);
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS zzz_gozsdu_autoassign_mapping ON public.rooms;
CREATE TRIGGER zzz_gozsdu_autoassign_mapping
BEFORE INSERT OR UPDATE OF hotel, cleaning_size, verified_bed_count, pms_metadata
ON public.rooms FOR EACH ROW EXECUTE FUNCTION public.stamp_gozsdu_autoassign_mapping();

-- When managers change a Gozsdu duration target, update only that property's
-- metadata. Existing assignments and their manual durations stay untouched.
CREATE OR REPLACE FUNCTION public.refresh_gozsdu_autoassign_target_metadata()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_hotel uuid;
BEGIN
  v_hotel := COALESCE(NEW.hotel_configuration_id, OLD.hotel_configuration_id);
  IF NOT EXISTS (SELECT 1 FROM public.hotel_configurations hc
                 WHERE hc.id = v_hotel AND hc.hotel_id = 'gozsdu-court') THEN RETURN NULL; END IF;
  UPDATE public.rooms r SET pms_metadata = COALESCE(r.pms_metadata, '{}'::jsonb)
  WHERE r.hotel IN ('gozsdu-court', 'Gozsdu Court Budapest');
  RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS trg_refresh_gozsdu_autoassign_targets ON public.hotel_cleaning_time_targets;
CREATE TRIGGER trg_refresh_gozsdu_autoassign_targets
AFTER INSERT OR UPDATE OR DELETE ON public.hotel_cleaning_time_targets
FOR EACH ROW EXECUTE FUNCTION public.refresh_gozsdu_autoassign_target_metadata();

-- Backfill only Gozsdu; 82 existing PMS room identities and assignments remain.
UPDATE public.rooms r SET pms_metadata = COALESCE(r.pms_metadata, '{}'::jsonb)
WHERE r.hotel IN ('gozsdu-court', 'Gozsdu Court Budapest');
