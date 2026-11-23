-- Phase 3: atomic per-guest arrival/departure/undo, room moves, VIZA and NTAK.
-- Apply ONLY after 20261123193000_ntak_phase3_guest_schema.sql.
-- Never publish new front-desk UI before ALL Phase 3 migrations are applied.
-- Preserve Phase 2 implementations for hotels where NTAK is disabled.
CREATE OR REPLACE FUNCTION public.pms_check_in_phase2(
  _reservation_id uuid, _moment timestamptz DEFAULT NULL,
  _guest_ids uuid[] DEFAULT NULL, _room_id uuid DEFAULT NULL, _override boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.reservations%ROWTYPE;
  rm public.rooms%ROWTYPE;
  actor uuid := auth.uid();
  day date;
  day_use boolean;
BEGIN
  SELECT * INTO r FROM public.reservations WHERE id = _reservation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RESERVATION_NOT_FOUND'; END IF;
  IF actor IS NULL OR NOT public.can_access_pms_hotel(actor,r.hotel_id,r.organization_slug) THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
  IF _guest_ids IS NOT NULL AND EXISTS (
    SELECT 1 FROM unnest(_guest_ids) AS gid
    WHERE NOT EXISTS (
      SELECT 1 FROM public.reservation_guests rg
      WHERE rg.reservation_id = r.id AND rg.guest_id = gid
    )
  ) THEN RAISE EXCEPTION 'GUEST_NOT_ON_RESERVATION'; END IF;
  PERFORM public.pms_assert_business_moment(r.hotel_id,r.organization_slug,_moment);
  PERFORM public.pms_set_business_moment(_moment);
  day_use := r.check_in_date = r.check_out_date;
  IF _moment IS NULL AND NOT day_use THEN
    RETURN public.pms_check_in_reservation(r.id,COALESCE(_room_id,r.room_id),_override);
  END IF;
  day := (COALESCE(_moment,clock_timestamp()) AT TIME ZONE 'Europe/Budapest')::date;
  IF r.status NOT IN ('pending','confirmed') THEN RAISE EXCEPTION 'INVALID_STATUS'; END IF;
  IF (day_use AND day <> r.check_in_date)
     OR (NOT day_use AND (day < r.check_in_date - 1 OR day >= r.check_out_date)) THEN
    RAISE EXCEPTION 'BUSINESS_DAY_OUTSIDE_STAY';
  END IF;
  SELECT * INTO rm FROM public.rooms WHERE id = COALESCE(_room_id,r.room_id) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ROOM_NOT_FOUND'; END IF;
  IF rm.hotel NOT IN (SELECT public.pms_hotel_room_keys(r.hotel_id)) THEN RAISE EXCEPTION 'ROOM_WRONG_HOTEL'; END IF;
  IF _moment IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.ntak_settings
    WHERE hotel_id=r.hotel_id AND enabled AND unit_scope='profiled_only'
  ) AND NOT EXISTS (
    SELECT 1 FROM public.ntak_unit_profiles
    WHERE hotel_id=r.hotel_id AND room_id=rm.id AND active
  ) THEN
    RAISE EXCEPTION 'ROOM_NOT_IN_NTAK_VALIDATION_SCOPE';
  END IF;
  IF day = (now() AT TIME ZONE 'Europe/Budapest')::date AND lower(COALESCE(rm.status,'')) <> 'clean' AND NOT _override THEN
    RAISE EXCEPTION 'ROOM_NOT_CLEAN';
  END IF;
  IF public.pms_room_has_conflict(rm.id,GREATEST(r.check_in_date,day),
    CASE WHEN day_use THEN day + 1 ELSE r.check_out_date END,r.id) THEN
    RAISE EXCEPTION 'ROOM_CONFLICT';
  END IF;
  IF COALESCE(rm.room_capacity,0) > 0 AND COALESCE(r.adults,0)+COALESCE(r.children,0)>rm.room_capacity AND NOT _override THEN
    RAISE EXCEPTION 'CAPACITY_EXCEEDED';
  END IF;
  UPDATE public.reservations SET status='checked_in',room_id=rm.id,actual_check_in=COALESCE(_moment,clock_timestamp()) WHERE id=r.id;
  UPDATE public.reservation_room_assignments SET status='cancelled'
    WHERE reservation_id=r.id AND room_id<>rm.id AND status IN ('assigned','active');
  IF EXISTS(SELECT 1 FROM public.reservation_room_assignments WHERE reservation_id=r.id AND room_id=rm.id) THEN
    UPDATE public.reservation_room_assignments SET status='active',
      check_in_date=GREATEST(r.check_in_date,day),
      check_out_date=CASE WHEN day_use THEN day + 1 ELSE r.check_out_date END
      WHERE reservation_id=r.id AND room_id=rm.id;
  ELSE
    INSERT INTO public.reservation_room_assignments(reservation_id,room_id,check_in_date,check_out_date,status)
    VALUES(r.id,rm.id,GREATEST(r.check_in_date,day),CASE WHEN day_use THEN day + 1 ELSE r.check_out_date END,'active');
  END IF;
  IF day=(now() AT TIME ZONE 'Europe/Budapest')::date THEN
    UPDATE public.rooms SET guest_count=r.adults+r.children,is_checkout_room=false,checkout_time=NULL,updated_at=now() WHERE id=rm.id;
  END IF;
  INSERT INTO public.reservation_events(reservation_id,hotel_id,organization_slug,event_type,metadata,created_by)
  VALUES(r.id,r.hotel_id,r.organization_slug,'check_in',
    jsonb_build_object('room_id',rm.id,'business_moment',COALESCE(_moment,clock_timestamp()),'historical',_moment IS NOT NULL),actor);
  RETURN jsonb_build_object('ok',true,'reservation_id',r.id,'room_number',rm.room_number,'occurred_at',_moment);
END;
$$;

CREATE OR REPLACE FUNCTION public.pms_check_out_phase2(
  _reservation_id uuid, _moment timestamptz DEFAULT NULL,
  _guest_ids uuid[] DEFAULT NULL, _acknowledge_balance boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.reservations%ROWTYPE;
  actor uuid := auth.uid();
  day date;
  bal numeric;
BEGIN
  SELECT * INTO r FROM public.reservations WHERE id=_reservation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RESERVATION_NOT_FOUND'; END IF;
  IF actor IS NULL OR NOT public.can_access_pms_hotel(actor,r.hotel_id,r.organization_slug) THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
  IF _guest_ids IS NOT NULL AND EXISTS(
    SELECT 1 FROM unnest(_guest_ids) AS gid WHERE NOT EXISTS(
      SELECT 1 FROM public.reservation_guests rg WHERE rg.reservation_id=r.id AND rg.guest_id=gid
    )
  ) THEN RAISE EXCEPTION 'GUEST_NOT_ON_RESERVATION'; END IF;
  PERFORM public.pms_assert_business_moment(r.hotel_id,r.organization_slug,_moment);
  PERFORM public.pms_set_business_moment(_moment);
  IF _moment IS NULL THEN
    RETURN public.pms_check_out_reservation(r.id,_acknowledge_balance);
  END IF;
  day := (_moment AT TIME ZONE 'Europe/Budapest')::date;
  IF r.status <> 'checked_in' THEN RAISE EXCEPTION 'INVALID_STATUS'; END IF;
  IF r.actual_check_in IS NOT NULL AND _moment < r.actual_check_in THEN RAISE EXCEPTION 'CHECK_OUT_BEFORE_CHECK_IN'; END IF;
  IF day < r.check_in_date OR day > r.check_out_date THEN RAISE EXCEPTION 'BUSINESS_DAY_OUTSIDE_STAY'; END IF;
  bal := COALESCE(r.balance_due,0);
  IF bal > 0 AND NOT _acknowledge_balance THEN RAISE EXCEPTION 'BALANCE_DUE'; END IF;
  UPDATE public.reservations SET status='checked_out',actual_check_out=_moment WHERE id=r.id;
  UPDATE public.reservation_room_assignments SET status='completed'
    WHERE reservation_id=r.id AND status IN ('assigned','active');
  IF day=(now() AT TIME ZONE 'Europe/Budapest')::date AND r.room_id IS NOT NULL THEN
    UPDATE public.rooms SET status=CASE WHEN status IN('out_of_order','maintenance') THEN status ELSE 'dirty' END,
      is_checkout_room=true,checkout_time=_moment,guest_count=0,updated_at=now() WHERE id=r.room_id;
  END IF;
  INSERT INTO public.reservation_events(reservation_id,hotel_id,organization_slug,event_type,metadata,created_by)
  VALUES(r.id,r.hotel_id,r.organization_slug,'check_out',
    jsonb_build_object('business_moment',_moment,'balance_at_checkout',bal,'balance_acknowledged',_acknowledge_balance),actor);
  RETURN jsonb_build_object('ok',true,'reservation_id',r.id,'balance_at_checkout',bal,'occurred_at',_moment);
END;
$$;

CREATE OR REPLACE FUNCTION public.pms_change_room_phase2(
  _reservation_id uuid, _to_room uuid, _moment timestamptz DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.reservations%ROWTYPE;
  rm public.rooms%ROWTYPE;
  actor uuid := auth.uid();
  day_use boolean;
  day date;
BEGIN
  SELECT * INTO r FROM public.reservations WHERE id=_reservation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RESERVATION_NOT_FOUND'; END IF;
  IF actor IS NULL OR NOT public.can_access_pms_hotel(actor,r.hotel_id,r.organization_slug) THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
  PERFORM public.pms_assert_business_moment(r.hotel_id,r.organization_slug,_moment);
  PERFORM public.pms_set_business_moment(_moment);
  day := (COALESCE(_moment,clock_timestamp()) AT TIME ZONE 'Europe/Budapest')::date;
  IF r.status <> 'checked_in' THEN RAISE EXCEPTION 'INVALID_STATUS'; END IF;
  IF r.room_id IS NULL OR r.room_id = _to_room THEN RAISE EXCEPTION 'ROOM_CHANGE_INVALID'; END IF;
  day_use := r.check_in_date = r.check_out_date;
  IF (day_use AND day <> r.check_in_date)
     OR (NOT day_use AND (day < r.check_in_date OR day >= r.check_out_date)) THEN
    RAISE EXCEPTION 'BUSINESS_DAY_OUTSIDE_STAY';
  END IF;
  IF r.actual_check_in IS NOT NULL AND COALESCE(_moment,clock_timestamp()) < r.actual_check_in THEN
    RAISE EXCEPTION 'ROOM_CHANGE_BEFORE_CHECK_IN';
  END IF;
  SELECT * INTO rm FROM public.rooms WHERE id=_to_room FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ROOM_NOT_FOUND'; END IF;
  IF rm.hotel NOT IN (SELECT public.pms_hotel_room_keys(r.hotel_id)) THEN RAISE EXCEPTION 'ROOM_WRONG_HOTEL'; END IF;
  IF _moment IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.ntak_settings
    WHERE hotel_id=r.hotel_id AND enabled AND unit_scope='profiled_only'
  ) AND NOT EXISTS (
    SELECT 1 FROM public.ntak_unit_profiles
    WHERE hotel_id=r.hotel_id AND room_id=rm.id AND active
  ) THEN
    RAISE EXCEPTION 'ROOM_NOT_IN_NTAK_VALIDATION_SCOPE';
  END IF;
  IF public.pms_room_has_conflict(_to_room,day,CASE WHEN day_use THEN day + 1 ELSE r.check_out_date END,r.id) THEN RAISE EXCEPTION 'ROOM_CONFLICT'; END IF;
  -- Do not overwrite historic stay segments. Closed assignments remain usable
  -- by NTAK roomOnDay; the new assignment begins on the change date.
  UPDATE public.reservation_room_assignments
    SET check_out_date=day,status='completed'
    WHERE reservation_id=r.id AND room_id=r.room_id
      AND check_in_date<day AND check_out_date>day AND status<>'cancelled';
  UPDATE public.reservation_room_assignments SET status='cancelled'
    WHERE reservation_id=r.id AND room_id=r.room_id AND check_in_date>=day AND status<>'cancelled';
  -- Append a fresh segment, including when the guest returns to an earlier
  -- room. Reusing/updating a prior segment would destroy historical occupancy.
  UPDATE public.reservation_room_assignments SET status='cancelled'
    WHERE reservation_id=r.id AND room_id=_to_room
      AND status IN ('assigned','active') AND check_out_date>day;
  INSERT INTO public.reservation_room_assignments(reservation_id,room_id,check_in_date,check_out_date,status)
  VALUES(r.id,_to_room,day,CASE WHEN day_use THEN day + 1 ELSE r.check_out_date END,'active');
  UPDATE public.reservations SET room_id=_to_room WHERE id=r.id;
  IF day=(now() AT TIME ZONE 'Europe/Budapest')::date THEN
    UPDATE public.rooms SET guest_count=0,updated_at=now() WHERE id=r.room_id;
    UPDATE public.rooms SET guest_count=COALESCE(r.adults,0)+COALESCE(r.children,0),updated_at=now() WHERE id=_to_room;
  END IF;
  INSERT INTO public.reservation_events(reservation_id,hotel_id,organization_slug,event_type,metadata,created_by)
  VALUES(r.id,r.hotel_id,r.organization_slug,'edited',
    jsonb_build_object('from_room',r.room_id,'to_room',_to_room,'business_moment',COALESCE(_moment,clock_timestamp())),actor);
  RETURN jsonb_build_object('ok',true,'reservation_id',r.id,'room_number',rm.room_number);
END;
$$;

CREATE OR REPLACE FUNCTION public.pms_undo_check_in_phase2(
  _reservation_id uuid, _moment timestamptz DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.reservations%ROWTYPE; actor uuid := auth.uid();
BEGIN
  SELECT * INTO r FROM public.reservations WHERE id=_reservation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RESERVATION_NOT_FOUND'; END IF;
  IF actor IS NULL OR NOT public.can_access_pms_hotel(actor,r.hotel_id,r.organization_slug) THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
  PERFORM public.pms_assert_business_moment(r.hotel_id,r.organization_slug,_moment);
  PERFORM public.pms_set_business_moment(_moment);
  IF r.status <> 'checked_in' THEN RAISE EXCEPTION 'INVALID_STATUS'; END IF;
  UPDATE public.reservations SET status='confirmed',actual_check_in=NULL WHERE id=r.id;
  UPDATE public.reservation_room_assignments SET status='assigned'
    WHERE reservation_id=r.id AND status='active';
  IF _moment IS NULL AND r.room_id IS NOT NULL THEN UPDATE public.rooms SET guest_count=0,updated_at=now() WHERE id=r.room_id; END IF;
  INSERT INTO public.reservation_events(reservation_id,hotel_id,organization_slug,event_type,metadata,created_by)
  VALUES(r.id,r.hotel_id,r.organization_slug,'edited',jsonb_build_object('undo','check_in','business_moment',_moment),actor);
  RETURN jsonb_build_object('ok',true);
END;
$$;

CREATE OR REPLACE FUNCTION public.pms_undo_check_out_phase2(
  _reservation_id uuid, _moment timestamptz DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.reservations%ROWTYPE; actor uuid := auth.uid();
BEGIN
  SELECT * INTO r FROM public.reservations WHERE id=_reservation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RESERVATION_NOT_FOUND'; END IF;
  IF actor IS NULL OR NOT public.can_access_pms_hotel(actor,r.hotel_id,r.organization_slug) THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
  PERFORM public.pms_assert_business_moment(r.hotel_id,r.organization_slug,_moment);
  PERFORM public.pms_set_business_moment(_moment);
  IF r.status <> 'checked_out' THEN RAISE EXCEPTION 'INVALID_STATUS'; END IF;
  UPDATE public.reservations SET status='checked_in',actual_check_out=NULL WHERE id=r.id;
  UPDATE public.reservation_room_assignments SET status='active'
    WHERE reservation_id=r.id AND status='completed' AND room_id=r.room_id;
  IF _moment IS NULL AND r.room_id IS NOT NULL THEN
    UPDATE public.rooms SET guest_count=COALESCE(r.adults,0)+COALESCE(r.children,0),is_checkout_room=false,checkout_time=NULL,updated_at=now() WHERE id=r.room_id;
  END IF;
  INSERT INTO public.reservation_events(reservation_id,hotel_id,organization_slug,event_type,metadata,created_by)
  VALUES(r.id,r.hotel_id,r.organization_slug,'edited',jsonb_build_object('undo','check_out','business_moment',_moment),actor);
  RETURN jsonb_build_object('ok',true);
END;
$$;
REVOKE ALL ON FUNCTION public.pms_check_in_phase2(uuid,timestamptz,uuid[],uuid,boolean) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.pms_check_out_phase2(uuid,timestamptz,uuid[],boolean) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.pms_change_room_phase2(uuid,uuid,timestamptz) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.pms_undo_check_in_phase2(uuid,timestamptz) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.pms_undo_check_out_phase2(uuid,timestamptz) FROM PUBLIC,anon,authenticated;

-- One controlled place for guest links. A linked guest must belong to the
-- same property/organization, so IDs from unrelated hotels cannot be inserted.
CREATE OR REPLACE FUNCTION public.pms_add_stay_guest(
  _reservation_id uuid,_guest_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.reservations%ROWTYPE; g public.guests%ROWTYPE; actor uuid:=auth.uid();
BEGIN
  SELECT * INTO r FROM public.reservations WHERE id=_reservation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RESERVATION_NOT_FOUND'; END IF;
  IF actor IS NULL OR NOT public.can_access_pms_hotel(actor,r.hotel_id,r.organization_slug) THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
  SELECT * INTO g FROM public.guests WHERE id=_guest_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'GUEST_NOT_FOUND'; END IF;
  IF g.organization_slug IS DISTINCT FROM r.organization_slug
    OR (g.hotel_id IS NOT NULL AND NOT public.user_can_access_hotel(actor,g.hotel_id)) THEN
    RAISE EXCEPTION 'GUEST_WRONG_PROPERTY';
  END IF;
  INSERT INTO public.reservation_guests(reservation_id,guest_id,room_id,created_by)
  VALUES(r.id,g.id,r.room_id,actor)
  ON CONFLICT (reservation_id,guest_id) DO NOTHING;
  RETURN jsonb_build_object('ok',true,'guest_id',g.id);
END;
$$;

-- Exact guest subsets go into NTAK; grouping by guest room is required for
-- FOGL_03 (two reservation rows sharing one booking number).
-- All NTAK operations are best effort; failures are warnings, never blockers.
CREATE OR REPLACE FUNCTION public.pms_enqueue_guest_ntak(
  _reservation_id uuid,_kind text,_ids uuid[],_room_id uuid,
  _from_room uuid,_moment timestamptz,_correction boolean
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.reservations%ROWTYPE; cfg public.ntak_settings%ROWTYPE;
BEGIN
  BEGIN
    IF _ids IS NULL OR cardinality(_ids)=0 THEN RETURN; END IF;
    SELECT * INTO r FROM public.reservations WHERE id=_reservation_id;
    SELECT * INTO cfg FROM public.ntak_settings WHERE hotel_id=r.hotel_id AND enabled;
    IF NOT FOUND THEN RETURN; END IF;
    IF cfg.first_closure_date IS NOT NULL AND (_moment AT TIME ZONE 'Europe/Budapest')::date<cfg.first_closure_date THEN RETURN; END IF;
    IF cfg.unit_scope='profiled_only' AND NOT EXISTS(
      SELECT 1 FROM public.ntak_unit_profiles p
      WHERE p.hotel_id=r.hotel_id AND p.room_id=_room_id AND p.active
    ) THEN RETURN; END IF;
    INSERT INTO public.ntak_event_queue
      (hotel_id,organization_slug,reservation_id,kind,room_id,from_room_id,
       is_correction,occurred_at,guest_ids)
    VALUES(r.hotel_id,cfg.organization_slug,r.id,_kind,_room_id,_from_room,
      _correction,_moment,_ids);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'pms_enqueue_guest_ntak: %',SQLERRM;
  END;
END;
$$;

-- VIZA uses a stable per-guest erkezes_azonosito, including for wrong arrivals
-- corrected by sending tavozott for that exact same arrival ID.
CREATE OR REPLACE FUNCTION public.pms_queue_guest_viza(
  _reservation_id uuid,_guest_id uuid,_action text,_moment timestamptz
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.reservations%ROWTYPE; cfg public.viza_settings%ROWTYPE; v public.viza_guest_events%ROWTYPE;
BEGIN
  BEGIN
    SELECT * INTO r FROM public.reservations WHERE id=_reservation_id;
    SELECT * INTO cfg FROM public.viza_settings
      WHERE hotel_id=r.hotel_id AND enabled AND adatszolgaltatasi_azonosito IS NOT NULL;
    IF NOT FOUND THEN RETURN; END IF;
    SELECT * INTO v FROM public.viza_guest_events
      WHERE reservation_id=r.id AND guest_id=_guest_id FOR UPDATE;
    IF _action='arrive' THEN
      IF NOT FOUND THEN
        INSERT INTO public.viza_guest_events
          (hotel_id,organization_slug,reservation_id,guest_id,erkezes_ideje,tavozas_varhato_datuma)
        VALUES(r.hotel_id,cfg.organization_slug,r.id,_guest_id,_moment,r.check_out_date);
      ELSIF v.arrival_state='sent' THEN
        UPDATE public.viza_guest_events
        SET last_error='Re-arrival after VIZA transmission requires manual correction',
          updated_at=now() WHERE id=v.id;
      ELSE
        UPDATE public.viza_guest_events
          SET erkezes_ideje=_moment,tavozas_ideje=NULL,departure_state=NULL,
          arrival_state='queued',last_error=NULL,updated_at=now() WHERE id=v.id;
      END IF;
    ELSIF _action IN ('depart','undo_arrival') THEN
      IF FOUND THEN
        UPDATE public.viza_guest_events SET tavozas_ideje=_moment,
          departure_state='queued',updated_at=now() WHERE id=v.id;
        -- Departure is sent by the VIZA worker only AFTER arrival_state='sent'.
        -- An unsent wrong arrival is first acknowledged, then corrected with
        -- a departure for its existing erkezes_azonosito.
      ELSE
        RAISE WARNING 'VIZA departure has no registered arrival for guest %',_guest_id;
      END IF;
    ELSIF _action='undo_departure' AND FOUND THEN
      IF v.departure_state='sent' THEN
        UPDATE public.viza_guest_events
          SET last_error='Already-sent VIZA departure needs supervised correction',
            updated_at=now() WHERE id=v.id;
      ELSE
        UPDATE public.viza_guest_events SET tavozas_ideje=NULL,departure_state=NULL,
          updated_at=now() WHERE id=v.id;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'pms_queue_guest_viza: %',SQLERRM;
  END;
END;
$$;

-- Every guest selection and transition is one DB transaction. The reservation
-- is locked first to serialize staff actions; no partial selections can post.
CREATE OR REPLACE FUNCTION public.pms_guest_transition(
  _reservation_id uuid,_action text,_guest_ids uuid[] DEFAULT NULL,
  _moment timestamptz DEFAULT NULL,_room_id uuid DEFAULT NULL,
  _acknowledge_balance boolean DEFAULT false,_override boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  r public.reservations%ROWTYPE;
  actor uuid:=auth.uid();
  at_time timestamptz:=COALESCE(_moment,clock_timestamp());
  day date:=(COALESCE(_moment,clock_timestamp()) AT TIME ZONE 'Europe/Budapest')::date;
  selected uuid[];
  guest_count integer;
  eligible_count integer;
  inhouse_count integer;
  changed_count integer;
  room public.rooms%ROWTYPE;
  dest uuid;
  ids uuid[];
  link record;
  permitted text;
  event_kind text;
  correction boolean;
  had_inhouse integer;
  new_status text;
BEGIN
  SELECT * INTO r FROM public.reservations WHERE id=_reservation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RESERVATION_NOT_FOUND'; END IF;
  IF actor IS NULL OR NOT public.can_access_pms_hotel(actor,r.hotel_id,r.organization_slug) THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
  IF NOT public.pms_ntak_guest_scope(r.id,COALESCE(_room_id,r.room_id)) THEN
    RAISE EXCEPTION 'GUEST_LIFECYCLE_DISABLED_FOR_RESERVATION';
  END IF;
  IF _action NOT IN ('arrive','depart','undo_arrival','undo_departure') THEN
    RAISE EXCEPTION 'INVALID_GUEST_ACTION';
  END IF;
  IF _action='arrive' AND r.status NOT IN ('pending','confirmed','checked_in') THEN
    RAISE EXCEPTION 'INVALID_STATUS';
  END IF;
  IF _action IN ('depart','undo_arrival') AND r.status<>'checked_in' THEN
    RAISE EXCEPTION 'INVALID_STATUS';
  END IF;
  IF _action='undo_departure' AND r.status NOT IN ('checked_in','checked_out') THEN
    RAISE EXCEPTION 'INVALID_STATUS';
  END IF;
  PERFORM public.pms_assert_business_moment(r.hotel_id,r.organization_slug,_moment);
  PERFORM public.pms_set_business_moment(_moment);
  IF _action='arrive' AND (
    (r.check_in_date=r.check_out_date AND day<>r.check_in_date)
    OR (r.check_in_date<>r.check_out_date AND (day<r.check_in_date-1 OR day>=r.check_out_date))
  ) THEN RAISE EXCEPTION 'BUSINESS_DAY_OUTSIDE_STAY'; END IF;
  IF _action IN ('depart','undo_arrival','undo_departure') AND
     (day<r.check_in_date OR day>r.check_out_date) THEN
    RAISE EXCEPTION 'BUSINESS_DAY_OUTSIDE_STAY';
  END IF;
  SELECT count(*) INTO had_inhouse FROM public.reservation_guests
    WHERE reservation_id=r.id AND stay_state='in_house';
  permitted:=CASE _action
    WHEN 'arrive' THEN 'expected'
    WHEN 'depart' THEN 'in_house'
    WHEN 'undo_arrival' THEN 'in_house'
    ELSE 'departed' END;
  -- In a default whole-reservation action, target *only* eligible guests.
  -- Explicit selection is all-or-nothing, even if a guest is not eligible.
  IF _guest_ids IS NULL THEN
    SELECT COALESCE(array_agg(guest_id ORDER BY guest_id),'{}'::uuid[]) INTO selected
    FROM public.reservation_guests WHERE reservation_id=r.id AND stay_state=permitted;
  ELSE
    selected:=_guest_ids;
  END IF;
  IF cardinality(selected)=0 THEN RAISE EXCEPTION 'NO_ELIGIBLE_GUESTS'; END IF;
  SELECT count(DISTINCT x.guest_id) INTO guest_count FROM unnest(selected) AS x(guest_id);
  IF guest_count<>cardinality(selected) THEN RAISE EXCEPTION 'DUPLICATE_GUEST_SELECTION'; END IF;
  PERFORM 1 FROM public.reservation_guests WHERE reservation_id=r.id FOR UPDATE;
  SELECT count(*) INTO eligible_count FROM public.reservation_guests
    WHERE reservation_id=r.id AND guest_id=ANY(selected) AND stay_state=permitted;
  IF eligible_count<>cardinality(selected) THEN RAISE EXCEPTION 'INVALID_GUEST_SELECTION'; END IF;
  IF _action='arrive' THEN
    dest:=COALESCE(_room_id,r.room_id);
    -- A late-arriving guest cannot silently change an already occupied
    -- reservation's room without the conflict-checked room-change RPC.
    IF had_inhouse>0 AND dest IS DISTINCT FROM r.room_id THEN
      RAISE EXCEPTION 'USE_ROOM_CHANGE_WORKFLOW';
    END IF;
    SELECT * INTO room FROM public.rooms WHERE id=dest FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'ROOM_NOT_FOUND'; END IF;
    IF room.hotel NOT IN(SELECT public.pms_hotel_room_keys(r.hotel_id)) THEN RAISE EXCEPTION 'ROOM_WRONG_HOTEL'; END IF;
    IF had_inhouse=0 AND public.pms_room_has_conflict(room.id,
      GREATEST(r.check_in_date,day),
      CASE WHEN r.check_in_date=r.check_out_date THEN day+1 ELSE r.check_out_date END,r.id
    ) THEN RAISE EXCEPTION 'ROOM_CONFLICT'; END IF;
    IF had_inhouse=0 AND day=(clock_timestamp() AT TIME ZONE 'Europe/Budapest')::date
      AND lower(COALESCE(room.status,''))<>'clean' AND NOT _override THEN RAISE EXCEPTION 'ROOM_NOT_CLEAN'; END IF;
    IF COALESCE(room.room_capacity,0)>0
      AND COALESCE(r.adults,0)+COALESCE(r.children,0)>room.room_capacity
      AND NOT _override THEN RAISE EXCEPTION 'CAPACITY_EXCEEDED'; END IF;
    IF EXISTS(SELECT 1 FROM public.ntak_settings cfg WHERE cfg.hotel_id=r.hotel_id AND cfg.enabled AND cfg.unit_scope='profiled_only')
      AND NOT EXISTS(SELECT 1 FROM public.ntak_unit_profiles p
        WHERE p.hotel_id=r.hotel_id AND p.room_id=dest AND p.active) THEN
      RAISE EXCEPTION 'ROOM_NOT_IN_NTAK_VALIDATION_SCOPE';
    END IF;
  END IF;
  IF _action='depart' AND COALESCE(r.balance_due,0)>0 AND
     NOT _acknowledge_balance AND had_inhouse=cardinality(selected) THEN
    RAISE EXCEPTION 'BALANCE_DUE';
  END IF;

  PERFORM set_config('hotelcare.guest_lifecycle','1',true);
  IF _action='arrive' THEN
    UPDATE public.reservation_guests SET stay_state='in_house',arrived_at=at_time,
      departed_at=NULL,room_id=dest
      WHERE reservation_id=r.id AND guest_id=ANY(selected);
  ELSIF _action='depart' THEN
    IF EXISTS(SELECT 1 FROM public.reservation_guests WHERE reservation_id=r.id
      AND guest_id=ANY(selected) AND arrived_at>at_time) THEN
      RAISE EXCEPTION 'DEPARTURE_BEFORE_ARRIVAL';
    END IF;
    UPDATE public.reservation_guests SET stay_state='departed',departed_at=at_time
      WHERE reservation_id=r.id AND guest_id=ANY(selected);
  ELSIF _action='undo_arrival' THEN
    UPDATE public.reservation_guests SET stay_state='void',arrived_at=NULL,
      departed_at=NULL WHERE reservation_id=r.id AND guest_id=ANY(selected);
  ELSE
    UPDATE public.reservation_guests SET stay_state='in_house',departed_at=NULL
      WHERE reservation_id=r.id AND guest_id=ANY(selected);
  END IF;
  SELECT count(*) INTO inhouse_count FROM public.reservation_guests
    WHERE reservation_id=r.id AND stay_state='in_house';
  new_status:=CASE WHEN inhouse_count>0 THEN 'checked_in'
    WHEN _action='undo_arrival' THEN 'confirmed' ELSE 'checked_out' END;
  IF _action='arrive' THEN
    UPDATE public.reservations SET status='checked_in',
      room_id=dest,actual_check_in=COALESCE(actual_check_in,at_time),
      actual_check_out=NULL WHERE id=r.id;
  ELSIF _action='undo_arrival' AND inhouse_count=0 THEN
    UPDATE public.reservations SET status='confirmed',actual_check_in=NULL,
      actual_check_out=NULL WHERE id=r.id;
  ELSIF _action='depart' AND inhouse_count=0 THEN
    UPDATE public.reservations SET status='checked_out',actual_check_out=at_time WHERE id=r.id;
  ELSIF _action='undo_departure' THEN
    UPDATE public.reservations SET status='checked_in',actual_check_out=NULL WHERE id=r.id;
  END IF;
  IF _action='arrive' AND had_inhouse=0 THEN
    IF NOT EXISTS(SELECT 1 FROM public.reservation_room_assignments
      WHERE reservation_id=r.id AND room_id=dest AND status IN ('assigned','active')) THEN
      INSERT INTO public.reservation_room_assignments
        (reservation_id,room_id,check_in_date,check_out_date,status)
      VALUES(r.id,dest,GREATEST(day,r.check_in_date),
        CASE WHEN r.check_in_date=r.check_out_date THEN day+1 ELSE r.check_out_date END,'active');
    ELSE
      UPDATE public.reservation_room_assignments
        SET status='active',
          check_out_date=CASE WHEN r.check_in_date=r.check_out_date THEN day+1 ELSE check_out_date END
        WHERE reservation_id=r.id AND room_id=dest AND status='assigned';
    END IF;
  ELSIF _action='depart' AND inhouse_count=0 THEN
    UPDATE public.reservation_room_assignments SET status='completed'
      WHERE reservation_id=r.id AND status='active';
  ELSIF _action='undo_arrival' AND inhouse_count=0 THEN
    UPDATE public.reservation_room_assignments SET status='assigned'
      WHERE reservation_id=r.id AND status='active';
  ELSIF _action='undo_departure' AND inhouse_count>0 THEN
    UPDATE public.reservation_room_assignments SET status='active'
      WHERE reservation_id=r.id AND room_id=r.room_id AND status='completed';
  END IF;
  IF day=(clock_timestamp() AT TIME ZONE 'Europe/Budapest')::date THEN
    UPDATE public.rooms SET guest_count=inhouse_count,
      is_checkout_room=CASE WHEN inhouse_count=0 THEN _action='depart' ELSE false END,
      checkout_time=CASE WHEN inhouse_count>0 THEN NULL ELSE checkout_time END,
      updated_at=now()
    WHERE id=COALESCE(dest,r.room_id);
    IF _action='depart' AND inhouse_count=0 THEN
      UPDATE public.rooms SET status=CASE WHEN status IN ('out_of_order','maintenance') THEN status ELSE 'dirty' END,
        checkout_time=at_time WHERE id=r.room_id;
    END IF;
  END IF;
  event_kind:=CASE WHEN _action IN ('arrive','undo_departure') THEN 'erkezett' ELSE 'tavozott' END;
  correction:=_action IN ('undo_arrival','undo_departure');
  -- Queue one event for each occupied room. Capture exact selected guest IDs;
  -- processing later must never expand this into all reservation guests.
  FOR link IN
    SELECT COALESCE(rg.room_id,r.room_id) AS guest_room,
      array_agg(rg.guest_id ORDER BY rg.guest_id) AS room_guest_ids
    FROM public.reservation_guests rg
    WHERE rg.reservation_id=r.id AND rg.guest_id=ANY(selected)
    GROUP BY COALESCE(rg.room_id,r.room_id)
  LOOP
    PERFORM public.pms_enqueue_guest_ntak(r.id,event_kind,link.room_guest_ids,
      link.guest_room,NULL,at_time,correction);
  END LOOP;
  FOR link IN SELECT unnest(selected) AS guest_id LOOP
    PERFORM public.pms_queue_guest_viza(r.id,link.guest_id,_action,at_time);
  END LOOP;
  INSERT INTO public.reservation_events
    (reservation_id,hotel_id,organization_slug,event_type,metadata,created_by)
  VALUES(r.id,r.hotel_id,r.organization_slug,
    CASE WHEN _action='arrive' THEN 'check_in' WHEN _action='depart' THEN 'check_out' ELSE 'edited' END,
    jsonb_build_object('guest_action',_action,'guest_ids',selected,'moment',at_time,
      'is_correction',correction),actor);
  RETURN jsonb_build_object('ok',true,'reservation_id',r.id,'action',_action,
    'guest_ids',selected,'status',new_status,'in_house',inhouse_count,
    'occurred_at',at_time,'room_number',room.room_number);
END;
$$;

-- Lifecycle is enabled only for explicitly NTAK-scoped reservations. In
-- profiled_only mode, the unrelated Channex certification rooms MUST keep
-- the original PMS flow even when the hotel has NTAK enabled.
CREATE OR REPLACE FUNCTION public.pms_ntak_guest_scope(
  _reservation_id uuid,_assigned_room uuid DEFAULT NULL
) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.reservations%ROWTYPE; cfg public.ntak_settings%ROWTYPE;
  room_to_check uuid;
BEGIN
  SELECT * INTO r FROM public.reservations WHERE id=_reservation_id;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO cfg FROM public.ntak_settings WHERE hotel_id=r.hotel_id AND enabled;
  IF NOT FOUND THEN RETURN false; END IF;
  IF cfg.unit_scope<>'profiled_only' THEN RETURN true; END IF;
  room_to_check:=COALESCE(_assigned_room,r.room_id);
  IF room_to_check IS NOT NULL THEN
    RETURN EXISTS(SELECT 1 FROM public.ntak_unit_profiles p
      WHERE p.hotel_id=r.hotel_id AND p.room_id=room_to_check AND p.active);
  END IF;
  RETURN r.room_type_id IS NOT NULL AND EXISTS(
    SELECT 1 FROM public.ntak_room_type_units t
    WHERE t.hotel_id=r.hotel_id AND t.room_type_id=r.room_type_id AND t.active);
END;
$;
REVOKE ALL ON FUNCTION public.pms_ntak_guest_scope(uuid,uuid) FROM PUBLIC,anon,authenticated;

-- Read-only decision for the frontend. Unlike a table SELECT, it matches
-- the exact reservation/room scope used by lifecycle RPCs, even if staff
-- cannot inspect private NTAK settings directly.
CREATE OR REPLACE FUNCTION public.pms_guest_lifecycle_available(
  _reservation_id uuid,_room_id uuid DEFAULT NULL
) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.reservations%ROWTYPE; actor uuid:=auth.uid();
BEGIN
  SELECT * INTO r FROM public.reservations WHERE id=_reservation_id;
  IF NOT FOUND OR actor IS NULL OR
    NOT public.can_access_pms_hotel(actor,r.hotel_id,r.organization_slug) THEN
    RETURN false;
  END IF;
  RETURN public.pms_ntak_guest_scope(r.id,_room_id);
END;
$;
REVOKE ALL ON FUNCTION public.pms_guest_lifecycle_available(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.pms_guest_lifecycle_available(uuid,uuid) TO authenticated;

-- Existing frontend RPC signatures are preserved for all hotels. Hotels with
-- NTAK disabled delegate to the exact Phase-2 implementation.
CREATE OR REPLACE FUNCTION public.pms_check_in(
  _reservation_id uuid,_moment timestamptz DEFAULT NULL,_guest_ids uuid[] DEFAULT NULL,
  _room_id uuid DEFAULT NULL,_override boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.reservations%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.reservations WHERE id=_reservation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'RESERVATION_NOT_FOUND'; END IF;
  IF public.pms_ntak_guest_scope(r.id,COALESCE(_room_id,r.room_id)) THEN
    RETURN public.pms_guest_transition(r.id,'arrive',_guest_ids,_moment,_room_id,false,_override);
  END IF;
  IF _guest_ids IS NOT NULL THEN RAISE EXCEPTION 'GUEST_LIFECYCLE_DISABLED_FOR_HOTEL'; END IF;
  RETURN public.pms_check_in_phase2(_reservation_id,_moment,NULL,_room_id,_override);
END;
$$;
CREATE OR REPLACE FUNCTION public.pms_check_out(
  _reservation_id uuid,_moment timestamptz DEFAULT NULL,_guest_ids uuid[] DEFAULT NULL,
  _acknowledge_balance boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.reservations%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.reservations WHERE id=_reservation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'RESERVATION_NOT_FOUND'; END IF;
  IF public.pms_ntak_guest_scope(r.id) THEN
    RETURN public.pms_guest_transition(r.id,'depart',_guest_ids,_moment,NULL,_acknowledge_balance,false);
  END IF;
  IF _guest_ids IS NOT NULL THEN RAISE EXCEPTION 'GUEST_LIFECYCLE_DISABLED_FOR_HOTEL'; END IF;
  RETURN public.pms_check_out_phase2(_reservation_id,_moment,NULL,_acknowledge_balance);
END;
$$;

CREATE OR REPLACE FUNCTION public.pms_change_room(
  _reservation_id uuid,_to_room uuid,_moment timestamptz DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  r public.reservations%ROWTYPE;
  ids uuid[];
  result jsonb;
  at_time timestamptz:=COALESCE(_moment,clock_timestamp());
BEGIN
  SELECT * INTO r FROM public.reservations WHERE id=_reservation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RESERVATION_NOT_FOUND'; END IF;
  IF NOT public.pms_ntak_guest_scope(r.id) THEN
    RETURN public.pms_change_room_phase2(_reservation_id,_to_room,_moment);
  END IF;
  IF NOT public.pms_ntak_guest_scope(r.id,_to_room) THEN
    RAISE EXCEPTION 'ROOM_NOT_IN_NTAK_VALIDATION_SCOPE';
  END IF;
  SELECT array_agg(guest_id ORDER BY guest_id) INTO ids
  FROM public.reservation_guests WHERE reservation_id=r.id AND stay_state='in_house'
    AND COALESCE(room_id,r.room_id)=r.room_id;
  IF COALESCE(cardinality(ids),0)=0 THEN RAISE EXCEPTION 'NO_IN_HOUSE_GUESTS_FOR_ROOM'; END IF;
  -- The legacy room move enforces room/hotel/time/conflict constraints and
  -- preserves dated room assignment history. Suppress its bulk event trigger.
  PERFORM set_config('hotelcare.guest_lifecycle','1',true);
  result:=public.pms_change_room_phase2(_reservation_id,_to_room,_moment);
  UPDATE public.reservation_guests SET room_id=_to_room
    WHERE reservation_id=r.id AND guest_id=ANY(ids);
  PERFORM public.pms_enqueue_guest_ntak(r.id,'lakoegysegetCserelt',ids,
    _to_room,r.room_id,at_time,false);
  RETURN result;
END;
$$;
CREATE OR REPLACE FUNCTION public.pms_undo_check_in(
  _reservation_id uuid,_moment timestamptz DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.reservations%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.reservations WHERE id=_reservation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'RESERVATION_NOT_FOUND'; END IF;
  IF public.pms_ntak_guest_scope(r.id) THEN
    RETURN public.pms_guest_transition(r.id,'undo_arrival',NULL,_moment);
  END IF;
  RETURN public.pms_undo_check_in_phase2(_reservation_id,_moment);
END;
$$;
CREATE OR REPLACE FUNCTION public.pms_undo_check_out(
  _reservation_id uuid,_moment timestamptz DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.reservations%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.reservations WHERE id=_reservation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'RESERVATION_NOT_FOUND'; END IF;
  IF public.pms_ntak_guest_scope(r.id) THEN
    RETURN public.pms_guest_transition(r.id,'undo_departure',NULL,_moment);
  END IF;
  RETURN public.pms_undo_check_out_phase2(_reservation_id,_moment);
END;
$$;

-- Manager-only explicit booking number, including FOGL_01..FOGL_05 and
-- __UJRAKULDENDO_VALIDACIO__. No arbitrary client-side editing of status.
CREATE OR REPLACE FUNCTION public.pms_set_ntak_booking_no(
  _reservation_id uuid,_booking_no text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.reservations%ROWTYPE; p public.profiles%ROWTYPE;
  actor uuid:=auth.uid(); cleaned text:=NULLIF(btrim(_booking_no),'');
BEGIN
  SELECT * INTO r FROM public.reservations WHERE id=_reservation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RESERVATION_NOT_FOUND'; END IF;
  IF actor IS NULL OR NOT public.can_access_pms_hotel(actor,r.hotel_id,r.organization_slug) THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
  SELECT * INTO p FROM public.profiles WHERE id=actor;
  IF NOT FOUND OR NOT (
    COALESCE(p.is_super_admin,false) OR
    p.role::text IN ('admin','top_management','top_management_manager','manager')
    OR (p.organization_slug='rdhotels' AND lower(btrim(COALESCE(p.nickname,'')))='anu_000')
  ) THEN RAISE EXCEPTION 'MANAGER_REQUIRED'; END IF;
  IF cleaned IS NOT NULL AND length(cleaned)>255 THEN RAISE EXCEPTION 'BOOKING_NUMBER_TOO_LONG'; END IF;
  UPDATE public.reservations SET ntak_booking_no=cleaned WHERE id=r.id;
  RETURN jsonb_build_object('ok',true,'booking_no',cleaned);
END;
$$;

-- Prevent bypassing manager-only booking-ID edits through direct
-- reservations.update() in the Data API. This runs even outside our RPC.
CREATE OR REPLACE FUNCTION public.pms_guard_ntak_booking_no()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor uuid:=auth.uid(); p public.profiles%ROWTYPE;
BEGIN
  IF NEW.ntak_booking_no IS NOT DISTINCT FROM OLD.ntak_booking_no THEN RETURN NEW; END IF;
  IF actor IS NULL THEN RETURN NEW; END IF; -- trusted service-role sync
  IF NOT public.can_access_pms_hotel(actor,NEW.hotel_id,NEW.organization_slug) THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;
  SELECT * INTO p FROM public.profiles WHERE id=actor;
  IF NOT FOUND OR NOT (
    COALESCE(p.is_super_admin,false) OR
    p.role::text IN ('admin','top_management','top_management_manager','manager')
    OR (p.organization_slug='rdhotels' AND lower(btrim(COALESCE(p.nickname,'')))='anu_000')
  ) THEN RAISE EXCEPTION 'MANAGER_REQUIRED'; END IF;
  RETURN NEW;
END;
$;
REVOKE ALL ON FUNCTION public.pms_guard_ntak_booking_no() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS pms_guard_ntak_booking_no ON public.reservations;
CREATE TRIGGER pms_guard_ntak_booking_no
BEFORE UPDATE OF ntak_booking_no ON public.reservations
FOR EACH ROW EXECUTE FUNCTION public.pms_guard_ntak_booking_no();

-- Deny ad-hoc RPC access to helper functions; validated wrappers use them
-- with their SECURITY DEFINER context. Authenticated can only invoke the
-- intended mutation endpoints.
REVOKE ALL ON FUNCTION public.pms_enqueue_guest_ntak(uuid,text,uuid[],uuid,uuid,timestamptz,boolean) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.pms_queue_guest_viza(uuid,uuid,text,timestamptz) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.pms_add_stay_guest(uuid,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.pms_guest_transition(uuid,text,uuid[],timestamptz,uuid,boolean,boolean) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.pms_set_ntak_booking_no(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.pms_add_stay_guest(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pms_guest_transition(uuid,text,uuid[],timestamptz,uuid,boolean,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pms_set_ntak_booking_no(uuid,text) TO authenticated;
