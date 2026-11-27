-- Disposable CI only. Verify explicit manual T/C changes beat previous
-- same-day overrides without weakening the PMS refresh / reservation guards.
\set ON_ERROR_STOP on
BEGIN;
DO $test$
DECLARE
  v_id uuid;
  v_day text := (statement_timestamp() AT TIME ZONE 'Europe/Budapest')::date::text;
  v_hotel text;
  r public.rooms%ROWTYPE;
BEGIN
  FOREACH v_hotel IN ARRAY ARRAY['Hotel Memories Budapest', 'Hotel Mika Downtown'] LOOP
    PERFORM set_config('app.test_user_id','',true);
    INSERT INTO public.rooms(hotel,organization_slug,room_number,pms_metadata,towel_change_required,linen_change_required)
    VALUES(v_hotel,'rdhotels','131',jsonb_build_object('reservationId','test-reservation',
      'pmsSyncDate',v_day,'lastPmsRefreshDate',v_day,'currentNight',5,'totalNights',7,
      'occupiedToday',true,'stayThroughToday',true,'scheduledDepartureTomorrow',false),false,false)
    RETURNING id INTO v_id;

    PERFORM set_config('app.test_user_id','11111111-1111-4111-8111-111111111111',true);
    UPDATE public.rooms SET linen_change_required=true WHERE id=v_id RETURNING * INTO r;
    IF r.linen_change_required IS DISTINCT FROM true
      OR r.pms_metadata #>> '{hotelcareManualServiceOverride,changeRoom}' IS DISTINCT FROM 'true'
    THEN RAISE EXCEPTION '%: first Change Room toggle failed', v_hotel; END IF;

    UPDATE public.rooms SET linen_change_required=false WHERE id=v_id RETURNING * INTO r;
    IF r.linen_change_required IS DISTINCT FROM false
      OR r.pms_metadata #>> '{hotelcareManualServiceOverride,changeRoom}' IS DISTINCT FROM 'false'
    THEN RAISE EXCEPTION '%: old override restored cleared Change Room', v_hotel; END IF;

    UPDATE public.rooms SET towel_change_required=true WHERE id=v_id RETURNING * INTO r;
    IF r.towel_change_required IS DISTINCT FROM true
      OR r.pms_metadata #>> '{hotelcareManualServiceOverride,towel}' IS DISTINCT FROM 'true'
    THEN RAISE EXCEPTION '%: Towel Change could not be enabled',v_hotel; END IF;

    UPDATE public.rooms SET towel_change_required=false WHERE id=v_id RETURNING * INTO r;
    IF r.towel_change_required IS DISTINCT FROM false
      OR r.pms_metadata #>> '{hotelcareManualServiceOverride,towel}' IS DISTINCT FROM 'false'
    THEN RAISE EXCEPTION '%: Towel Change could not be cleared',v_hotel; END IF;

    -- Even an authenticated PMS refresh is not a new manual instruction.
    UPDATE public.rooms SET pms_metadata=pms_metadata||'{"noteOta":"refresh"}'::jsonb,
      linen_change_required=true, towel_change_required=true WHERE id=v_id RETURNING * INTO r;
    IF r.linen_change_required IS DISTINCT FROM false OR r.towel_change_required IS DISTINCT FROM false
      OR r.pms_metadata #>> '{hotelcareManualServiceOverride,changeRoom}' IS DISTINCT FROM 'false'
    THEN RAISE EXCEPTION '%: authenticated PMS refresh restored cleared service',v_hotel; END IF;

    PERFORM set_config('app.test_user_id','',true);
    UPDATE public.rooms SET pms_metadata=pms_metadata||'{"noteOta":"background refresh"}'::jsonb,
      linen_change_required=true WHERE id=v_id RETURNING * INTO r;
    IF r.linen_change_required IS DISTINCT FROM false
    THEN RAISE EXCEPTION '%: background PMS refresh restored cleared service',v_hotel; END IF;

    PERFORM set_config('app.test_user_id','11111111-1111-4111-8111-111111111111',true);
    UPDATE public.rooms SET linen_change_required=true WHERE id=v_id RETURNING * INTO r;
    IF r.linen_change_required IS DISTINCT FROM true
    THEN RAISE EXCEPTION '%: cleared service could not be re-enabled',v_hotel; END IF;

    IF r.last_towel_change IS NOT NULL OR r.last_linen_change IS NOT NULL
    THEN RAISE EXCEPTION '%: toggles fabricated completed service',v_hotel; END IF;
  END LOOP;
  RAISE NOTICE 'PASS: repeated T/C reversal, authenticated and background PMS refresh, and no fabricated completion';
END;
$test$;
ROLLBACK;
