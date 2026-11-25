-- Review items 1–2: preserve dated OOS; project maintenance to legacy rooms.status.
-- Apply after Phase 4 and all prerequisites. Existing ACLs retained by CREATE OR REPLACE.
CREATE OR REPLACE FUNCTION public.pms_sync_room_state_period(_room_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE effective text; prior text; old_status text;
  today date:=(now() AT TIME ZONE 'Europe/Budapest')::date;
BEGIN
  SELECT status INTO old_status FROM public.rooms WHERE id=_room_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT p.state INTO effective
  FROM public.room_state_periods p
  WHERE p.room_id=_room_id AND p.from_date<=today AND p.to_date>=today
  LIMIT 1;

  IF FOUND THEN
    effective:=CASE WHEN effective='out_of_service' THEN 'maintenance' ELSE effective END;
    INSERT INTO public.room_state_status_baselines(room_id, original_status)
    VALUES(_room_id,old_status) ON CONFLICT (room_id) DO NOTHING;
    UPDATE public.rooms SET status=effective WHERE id=_room_id
      AND status IS DISTINCT FROM effective;
  ELSE
    SELECT original_status INTO prior
    FROM public.room_state_status_baselines WHERE room_id=_room_id FOR UPDATE;
    IF FOUND THEN
      UPDATE public.rooms SET status=prior WHERE id=_room_id
        AND status IS DISTINCT FROM prior;
      DELETE FROM public.room_state_status_baselines WHERE room_id=_room_id;
    END IF;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.pms_guard_active_room_state_period()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE current_state text;
  today date:=(now() AT TIME ZONE 'Europe/Budapest')::date;
BEGIN
  SELECT state INTO current_state FROM public.room_state_periods
  WHERE room_id=NEW.id AND from_date<=today AND to_date>=today LIMIT 1;
  IF FOUND THEN NEW.status:=CASE WHEN current_state='out_of_service' THEN 'maintenance' ELSE current_state END; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.pms_add_room_state_period(
  _hotel_id text,_room_id uuid,_state text,_from_date date,
  _to_date date,_reason text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor uuid:=auth.uid(); v_org text; v_hotel text; actor_role text; new_id uuid;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
  SELECT role,organization_slug INTO actor_role,v_org
    FROM public.profiles WHERE id=actor;
  IF actor_role IS NULL OR actor_role NOT IN
    ('admin','top_management','top_management_manager','manager',
     'housekeeping_manager','supervisor','reception','front_office')
    OR NOT public.can_access_pms_hotel(actor,_hotel_id,v_org)
  THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;

  SELECT hotel INTO v_hotel FROM public.rooms WHERE id=_room_id;
  IF NOT FOUND OR v_hotel NOT IN
    (SELECT public.pms_hotel_room_keys(_hotel_id))
    OR EXISTS (SELECT 1 FROM public.rooms r WHERE r.id=_room_id
      AND r.organization_slug IS DISTINCT FROM v_org)
  THEN RAISE EXCEPTION 'ROOM_WRONG_HOTEL'; END IF;
  IF _state NOT IN ('out_of_order','out_of_service') OR _state IS NULL
  THEN RAISE EXCEPTION 'INVALID_ROOM_STATE'; END IF;
  IF _from_date IS NULL OR _to_date IS NULL OR _to_date<_from_date
  THEN RAISE EXCEPTION 'INVALID_ROOM_STATE_DATES'; END IF;
  IF length(btrim(COALESCE(_reason,''))) NOT BETWEEN 1 AND 500
  THEN RAISE EXCEPTION 'ROOM_STATE_REASON_REQUIRED'; END IF;
  IF _from_date < (now() AT TIME ZONE 'Europe/Budapest')::date THEN
    IF NOT EXISTS (SELECT 1 FROM public.ntak_settings WHERE hotel_id=_hotel_id AND environment='test' AND allow_backdating) THEN
      RAISE EXCEPTION 'BACKDATING_DISABLED';
    END IF;
    PERFORM public.pms_assert_business_moment(_hotel_id,v_org,_from_date::timestamp AT TIME ZONE 'Europe/Budapest');
  END IF;
  INSERT INTO public.room_state_periods
    (hotel_id,organization_slug,room_id,state,from_date,to_date,reason,created_by)
  VALUES(_hotel_id,v_org,_room_id,_state,_from_date,_to_date,btrim(_reason),actor)
  RETURNING id INTO new_id;
  UPDATE public.ntak_daily_closures SET needs_correction=true, correction_detected_at=now(),updated_at=now()
  WHERE hotel_id=_hotel_id AND organization_slug=v_org AND accepted_once
    AND closed_day BETWEEN _from_date AND _to_date;
  RETURN new_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.pms_end_room_state_period(
  _period_id uuid,_last_day date
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor uuid:=auth.uid(); p public.room_state_periods%ROWTYPE;
  actor_role text; actor_org text;
BEGIN
  SELECT * INTO p FROM public.room_state_periods WHERE id=_period_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ROOM_STATE_PERIOD_NOT_FOUND'; END IF;
  SELECT role,organization_slug INTO actor_role,actor_org
  FROM public.profiles WHERE id=actor;
  IF actor IS NULL OR actor_role IS NULL OR actor_role NOT IN
    ('admin','top_management','top_management_manager','manager',
     'housekeeping_manager','supervisor','reception','front_office')
    OR actor_org IS DISTINCT FROM p.organization_slug
    OR NOT public.can_access_pms_hotel(actor,p.hotel_id,p.organization_slug)
  THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
  IF _last_day IS NULL OR _last_day<p.from_date OR _last_day>p.to_date
  THEN RAISE EXCEPTION 'INVALID_ROOM_STATE_DATES'; END IF;
  IF _last_day=p.to_date THEN RETURN p.id; END IF;
  -- Shortening changes only days after the last retained day.
  IF _last_day + 1 < (now() AT TIME ZONE 'Europe/Budapest')::date THEN
    IF NOT EXISTS (SELECT 1 FROM public.ntak_settings WHERE hotel_id=p.hotel_id AND environment='test' AND allow_backdating) THEN
      RAISE EXCEPTION 'BACKDATING_DISABLED';
    END IF;
    PERFORM public.pms_assert_business_moment(p.hotel_id,p.organization_slug,(_last_day+1)::timestamp AT TIME ZONE 'Europe/Budapest');
  END IF;
  UPDATE public.room_state_periods SET to_date=_last_day WHERE id=p.id;
  UPDATE public.ntak_daily_closures SET needs_correction=true, correction_detected_at=now(),updated_at=now()
  WHERE hotel_id=p.hotel_id AND organization_slug=p.organization_slug AND accepted_once
    AND closed_day > _last_day AND closed_day <= p.to_date;
  RETURN p.id;
END;
$$;
