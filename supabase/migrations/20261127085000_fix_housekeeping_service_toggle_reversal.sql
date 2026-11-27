-- Preserve the latest deliberate service toggle, not the previous same-day choice.
-- Keep existing tenant/RLS permissions and PMS/checkout/reservation guards intact.
CREATE OR REPLACE FUNCTION public.hc_stamp_portfolio_manual_service_override()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  v_today date := (statement_timestamp() AT TIME ZONE 'Europe/Budapest')::date;
  v_meta jsonb := coalesce(NEW.pms_metadata,'{}'::jsonb);
  v_reservation_key text;
BEGIN
  IF v_today < DATE '2026-09-25' THEN RETURN NEW; END IF;

  IF (
      NEW.towel_change_required IS DISTINCT FROM OLD.towel_change_required
      OR NEW.linen_change_required IS DISTINCT FROM OLD.linen_change_required
    )
    AND (
      NEW.pms_metadata IS NOT DISTINCT FROM OLD.pms_metadata
      -- The earlier Memories-only trigger stamps the date before this one
      -- runs. That one internal change is not a PMS refresh.
      OR (
        lower(btrim(coalesce(NEW.hotel,''))) IN ('hotel memories budapest','memories budapest','memories-budapest')
        AND v_meta ->> 'memoriesServiceManualOverrideDate' = v_today::text
        AND (v_meta - 'memoriesServiceManualOverrideDate') IS NOT DISTINCT FROM
            (coalesce(OLD.pms_metadata,'{}'::jsonb) - 'memoriesServiceManualOverrideDate')
      )
    )
    AND coalesce(v_meta ->> 'memoriesPmsColumnPresent','false') <> 'true'
    AND auth.uid() IS NOT NULL
  THEN
    v_reservation_key := coalesce(
      v_meta ->> 'reservationId',
      v_meta ->> 'reservation_id',
      v_meta ->> 'bookingId',
      v_meta ->> 'booking_id',
      v_meta ->> 'guestReservationId',
      v_meta ->> 'roomId'
    );

    NEW.pms_metadata := jsonb_set(
      v_meta - 'hotelcareManualServiceClearDate',
      '{hotelcareManualServiceOverride}',
      jsonb_strip_nulls(
        jsonb_build_object(
          'businessDate', v_today::text,
          'towel', coalesce(NEW.towel_change_required,false),
          'changeRoom', coalesce(NEW.linen_change_required,false),
          'reservationKey', v_reservation_key,
          'source', 'manual',
          'actor', auth.uid()::text,
          'updatedAt', statement_timestamp()
        )
      ),
      true
    );
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS a_hc_portfolio_stamp_manual_service_override ON public.rooms;
CREATE TRIGGER a_hc_portfolio_stamp_manual_service_override
BEFORE UPDATE OF towel_change_required, linen_change_required
ON public.rooms
FOR EACH ROW
EXECUTE FUNCTION public.hc_stamp_portfolio_manual_service_override();

-- Re-apply today's explicit human T/C decision after property-specific rule
-- triggers and PMS-shaped updates. A checkout, a different reservation, or an
-- explicit clear marker ends the override. Old-day overrides are removed from
-- the live mirror on its next update, while the finalized historical copy stays.
CREATE OR REPLACE FUNCTION public.hc_reapply_portfolio_manual_service_override()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  v_today date := (statement_timestamp() AT TIME ZONE 'Europe/Budapest')::date;
  v_old_meta jsonb := coalesce(OLD.pms_metadata,'{}'::jsonb);
  v_new_meta jsonb := coalesce(NEW.pms_metadata,'{}'::jsonb);
  v_override jsonb := v_old_meta -> 'hotelcareManualServiceOverride';
  v_incoming jsonb := v_new_meta -> 'hotelcareManualServiceOverride';
  v_override_date text := v_override ->> 'businessDate';
  v_old_key text := v_override ->> 'reservationKey';
  v_new_key text;
BEGIN
  IF v_today < DATE '2026-09-25' THEN RETURN NEW; END IF;

  -- The early stamp records this statement's NEW manual choice. Do not
  -- replace it with yesterday's or an earlier same-day OLD choice.
  IF v_incoming IS DISTINCT FROM v_override
     AND auth.uid() IS NOT NULL
     AND v_incoming ->> 'actor' = auth.uid()::text
     AND v_incoming ->> 'source' = 'manual'
     AND v_incoming ->> 'businessDate' = v_today::text
     AND v_incoming -> 'updatedAt' = to_jsonb(statement_timestamp())
  THEN
    v_override := v_incoming;
    v_override_date := v_override ->> 'businessDate';
    v_old_key := v_override ->> 'reservationKey';
  END IF;

  IF v_override_date IS NULL THEN RETURN NEW; END IF;

  IF v_override_date < v_today::text THEN
    NEW.pms_metadata := v_new_meta - 'hotelcareManualServiceOverride';
    RETURN NEW;
  END IF;

  IF v_override_date IS DISTINCT FROM v_today::text
     OR v_new_meta ->> 'hotelcareManualServiceClearDate' = v_today::text
     OR coalesce(NEW.is_checkout_room,false)
     OR coalesce(v_new_meta ->> 'scheduledDepartureToday','false') = 'true'
  THEN
    RETURN NEW;
  END IF;

  v_new_key := coalesce(
    v_new_meta ->> 'reservationId',
    v_new_meta ->> 'reservation_id',
    v_new_meta ->> 'bookingId',
    v_new_meta ->> 'booking_id',
    v_new_meta ->> 'guestReservationId',
    v_new_meta ->> 'roomId'
  );

  IF nullif(v_old_key,'') IS NOT NULL
     AND nullif(v_new_key,'') IS NOT NULL
     AND v_old_key IS DISTINCT FROM v_new_key
  THEN
    RETURN NEW;
  END IF;

  IF jsonb_typeof(v_override -> 'towel') = 'boolean' THEN
    NEW.towel_change_required := (v_override ->> 'towel')::boolean;
  END IF;
  IF jsonb_typeof(v_override -> 'changeRoom') = 'boolean' THEN
    NEW.linen_change_required := (v_override ->> 'changeRoom')::boolean;
  END IF;

  NEW.pms_metadata := jsonb_set(
    v_new_meta,
    '{hotelcareManualServiceOverride}',
    v_override,
    true
  );
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS zzzzzzzzzzzz_hc_portfolio_reapply_manual_service_override
  ON public.rooms;
CREATE TRIGGER zzzzzzzzzzzz_hc_portfolio_reapply_manual_service_override
BEFORE UPDATE OF pms_metadata, towel_change_required, linen_change_required, is_checkout_room
ON public.rooms
FOR EACH ROW
EXECUTE FUNCTION public.hc_reapply_portfolio_manual_service_override();

