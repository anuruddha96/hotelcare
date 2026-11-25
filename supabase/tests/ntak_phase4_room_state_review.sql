-- Disposable CI only. Real rooms_status_check copied from pg_constraint on production 2026-11-23.
-- NTAK tables are loaded from the real base migration; the wider PMS fixture is still reduced.
ALTER TABLE public.rooms ADD CONSTRAINT rooms_status_check CHECK (status = ANY (ARRAY['clean'::text,'dirty'::text,'out_of_order'::text,'maintenance'::text]));
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS nickname text;
ALTER TABLE public.ntak_settings
  ADD COLUMN IF NOT EXISTS allow_backdating boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS backdating_min_date date;

-- Caller identity comes from auth.uid(), never an argument or user metadata.
-- Matches the server's MANAGE_ROLES plus its existing rdhotels/anu_000 exception.
CREATE OR REPLACE FUNCTION public.pms_assert_business_moment(
  _hotel_id text, _org_slug text, _moment timestamptz
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor uuid := auth.uid();
  pr public.profiles%ROWTYPE;
  cfg public.ntak_settings%ROWTYPE;
  business_day date;
BEGIN
  IF _moment IS NULL THEN RETURN; END IF;
  IF actor IS NULL THEN RAISE EXCEPTION 'BACKDATING_REQUIRES_MANAGER'; END IF;
  SELECT * INTO pr FROM public.profiles WHERE id = actor;
  IF NOT FOUND OR NOT (
    COALESCE(pr.is_super_admin, false)
    OR pr.role::text IN ('admin','top_management','top_management_manager','manager')
    OR (pr.organization_slug = 'rdhotels' AND lower(btrim(COALESCE(pr.nickname,''))) = 'anu_000')
  ) THEN RAISE EXCEPTION 'BACKDATING_REQUIRES_MANAGER'; END IF;
  IF NOT public.can_access_pms_hotel(actor, _hotel_id, _org_slug) THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;
  SELECT * INTO cfg FROM public.ntak_settings WHERE hotel_id = _hotel_id;
  IF NOT FOUND OR NOT cfg.allow_backdating THEN
    RAISE EXCEPTION 'BACKDATING_DISABLED';
  END IF;
  business_day := (_moment AT TIME ZONE 'Europe/Budapest')::date;
  IF cfg.first_closure_date IS NOT NULL AND business_day < cfg.first_closure_date THEN
    RAISE EXCEPTION 'BUSINESS_DAY_BEFORE_FIRST_CLOSURE: %', cfg.first_closure_date;
  END IF;
  IF cfg.backdating_min_date IS NOT NULL AND business_day < cfg.backdating_min_date THEN
    RAISE EXCEPTION 'BUSINESS_DAY_BEFORE_MINIMUM: %', cfg.backdating_min_date;
  END IF;
  IF _moment > clock_timestamp() + interval '5 minutes' THEN
    RAISE EXCEPTION 'BUSINESS_MOMENT_CANNOT_BE_FUTURE';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.pms_assert_business_moment(text,text,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pms_assert_business_moment(text,text,timestamptz) TO service_role;


\ir ../migrations/20261124010000_ntak_room_state_review_fix.sql
INSERT INTO public.ntak_settings(hotel_id,organization_slug,enabled,environment,allow_backdating)
VALUES('channex-test-property','channex',true,'test',false);
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000071',false);
SET ROLE authenticated;
DO $$
DECLARE today date := (now() AT TIME ZONE 'Europe/Budapest')::date;
BEGIN
  PERFORM public.pms_add_room_state_period('channex-test-property','00000000-0000-4000-8000-000000000104','out_of_service',today,today,'today OOS');
  UPDATE public.rooms SET status='clean' WHERE id='00000000-0000-4000-8000-000000000104';
  IF (SELECT status FROM public.rooms WHERE id='00000000-0000-4000-8000-000000000104') IS DISTINCT FROM 'maintenance' THEN RAISE EXCEPTION 'OOS projection incorrect'; END IF;
  BEGIN
    PERFORM public.pms_add_room_state_period('channex-test-property','00000000-0000-4000-8000-000000000101','out_of_order',today-2,today-2,'historical');
    RAISE EXCEPTION 'Unexpected backdate success';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'BACKDATING_DISABLED' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
UPDATE public.ntak_settings SET allow_backdating=true WHERE hotel_id='channex-test-property';
INSERT INTO public.ntak_daily_closures(hotel_id,organization_slug,closed_day,state,classification,snapshot,snapshot_hash,accepted_once)
SELECT 'channex-test-property','channex',d,'accepted','UJ','{}','fixture',true FROM generate_series((now() AT TIME ZONE 'Europe/Budapest')::date-3,(now() AT TIME ZONE 'Europe/Budapest')::date-1,'1 day') d;
SET ROLE authenticated;
SELECT public.pms_add_room_state_period('channex-test-property','00000000-0000-4000-8000-000000000101','out_of_order',(now() AT TIME ZONE 'Europe/Budapest')::date-3,(now() AT TIME ZONE 'Europe/Budapest')::date-1,'authorized history');
RESET ROLE;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.ntak_daily_closures WHERE needs_correction) <> 3 THEN RAISE EXCEPTION 'Historical add did not flag closures'; END IF;
END $$;
UPDATE public.ntak_daily_closures SET needs_correction=false;
UPDATE public.ntak_settings SET allow_backdating=false;
SET ROLE authenticated;
DO $$ DECLARE pid uuid; today date:=(now() AT TIME ZONE 'Europe/Budapest')::date;
BEGIN
 SELECT id INTO pid FROM public.room_state_periods WHERE room_id='00000000-0000-4000-8000-000000000101' AND from_date=today-3;
 BEGIN
 PERFORM public.pms_end_room_state_period(pid,today-3);
 RAISE EXCEPTION 'Unexpected historical shorten success';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'BACKDATING_DISABLED' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
UPDATE public.ntak_settings SET allow_backdating=true;
SET ROLE authenticated;
SELECT public.pms_end_room_state_period(id,(now() AT TIME ZONE 'Europe/Budapest')::date-3) FROM public.room_state_periods WHERE room_id='00000000-0000-4000-8000-000000000101' AND from_date=(now() AT TIME ZONE 'Europe/Budapest')::date-3;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.ntak_daily_closures WHERE needs_correction) <> 2 THEN RAISE EXCEPTION 'Historical shorten did not flag exact changed days'; END IF;
END $$;
