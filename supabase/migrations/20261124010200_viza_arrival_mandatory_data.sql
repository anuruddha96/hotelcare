-- Claude review item 5. Applies only after Phase 3 activation safety.
-- The shared VIZA admission guard. Names and field keys only; never return document numbers.
CREATE OR REPLACE FUNCTION public.pms_assert_viza_arrival_data(_reservation_id uuid,_guest_ids uuid[],_day date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
 r public.reservations%ROWTYPE;
 g record;
 missing text[];
 failures jsonb:='[]'::jsonb;
BEGIN
 SELECT * INTO r FROM public.reservations WHERE id=_reservation_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'RESERVATION_NOT_FOUND'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.viza_settings WHERE hotel_id=r.hotel_id AND enabled AND adatszolgaltatasi_azonosito IS NOT NULL) THEN RETURN; END IF;
 FOR g IN
   SELECT ids.guest_id,guest.first_name,guest.last_name,guest.nationality,guest.date_of_birth,
     guest.birth_place,guest.gender,guest.id_document_type,guest.id_document_number
   FROM (
     SELECT unnest(_guest_ids) AS guest_id WHERE _guest_ids IS NOT NULL
     UNION SELECT rg.guest_id FROM public.reservation_guests rg WHERE rg.reservation_id=r.id AND _guest_ids IS NULL
     UNION SELECT r.guest_id WHERE _guest_ids IS NULL AND r.guest_id IS NOT NULL
   ) ids
   LEFT JOIN public.guests guest ON guest.id=ids.guest_id
 LOOP
   missing:=ARRAY[]::text[];
   IF NULLIF(btrim(g.last_name),'') IS NULL THEN missing:=array_append(missing,'last_name'); END IF;
   IF NULLIF(btrim(g.first_name),'') IS NULL THEN missing:=array_append(missing,'first_name'); END IF;
   IF NULLIF(btrim(g.nationality),'') IS NULL THEN missing:=array_append(missing,'nationality'); END IF;
   IF g.date_of_birth IS NULL OR g.date_of_birth>_day OR g.date_of_birth<_day-interval '111 years' THEN missing:=array_append(missing,'date_of_birth'); END IF;
   IF NULLIF(btrim(g.birth_place),'') IS NULL THEN missing:=array_append(missing,'birth_place'); END IF;
   IF NULLIF(btrim(g.gender),'') IS NULL THEN missing:=array_append(missing,'gender'); END IF;
   -- Under 14: only the document fields may be absent. "other" is a valid
   -- document type and maps to EGYEB; the number remains mandatory for adults.
   IF g.date_of_birth IS NULL OR g.date_of_birth>_day OR g.date_of_birth<=(_day-interval '14 years')::date THEN
     IF NULLIF(btrim(g.id_document_type),'') IS NULL THEN missing:=array_append(missing,'id_document_type'); END IF;
     IF NULLIF(btrim(g.id_document_number),'') IS NULL THEN missing:=array_append(missing,'id_document_number'); END IF;
   END IF;
   IF cardinality(missing)>0 THEN
     failures:=failures||jsonb_build_array(jsonb_build_object('guest',COALESCE(NULLIF(btrim(concat_ws(' ',g.last_name,g.first_name)),''),g.guest_id::text,'—'),'fields',missing));
   END IF;
 END LOOP;
 IF _guest_ids IS NULL AND r.guest_id IS NULL AND NOT EXISTS(SELECT 1 FROM public.reservation_guests WHERE reservation_id=r.id) THEN
   failures:=jsonb_build_array(jsonb_build_object('guest','—','fields',ARRAY['last_name','first_name','nationality','date_of_birth','birth_place','gender','id_document_type','id_document_number']));
 END IF;
 IF jsonb_array_length(failures)>0 THEN RAISE EXCEPTION 'VIZA_GUEST_DATA_INCOMPLETE: %',failures::text; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.pms_assert_viza_arrival_data(uuid,uuid[],date) FROM PUBLIC,anon,authenticated;

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
    PERFORM public.pms_assert_viza_arrival_data(r.id,selected,day);
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
    UPDATE public.reservation_guests SET stay_state='expected',arrived_at=NULL,
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
  IF auth.uid() IS NULL OR NOT COALESCE(public.can_access_pms_hotel(auth.uid(),r.hotel_id,r.organization_slug),false) THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
  PERFORM public.pms_assert_viza_arrival_data(r.id,NULL,(COALESCE(_moment,clock_timestamp()) AT TIME ZONE 'Europe/Budapest')::date);
  RETURN public.pms_check_in_phase2(_reservation_id,_moment,NULL,_room_id,_override);
END;
$$;

-- Operational requirement only; no authority settings, identifiers or URLs exposed.
CREATE OR REPLACE FUNCTION public.pms_viza_registration_required(_reservation_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT COALESCE(public.has_pms_access(auth.uid()),false)
    OR NOT COALESCE(public.can_access_reservation(auth.uid(),_reservation_id),false)
 THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 RETURN EXISTS(SELECT 1 FROM public.reservations r JOIN public.viza_settings v ON v.hotel_id=r.hotel_id
   WHERE r.id=_reservation_id AND v.enabled AND v.adatszolgaltatasi_azonosito IS NOT NULL);
END;
$$;
REVOKE ALL ON FUNCTION public.pms_viza_registration_required(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.pms_viza_registration_required(uuid) TO authenticated;

-- Service-only repair endpoint rechecks persisted guest data before queuing a retry.
GRANT EXECUTE ON FUNCTION public.pms_assert_viza_arrival_data(uuid,uuid[],date) TO service_role;

-- If an already departed guest's corrected arrival is later accepted, queue
-- the recorded departure in the same update. Never resurrect sent departures.
CREATE OR REPLACE FUNCTION public.viza_queue_departure_after_arrival_repair()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF OLD.arrival_state IS DISTINCT FROM 'sent' AND NEW.arrival_state='sent'
    AND NEW.tavozas_ideje IS NOT NULL AND NEW.departure_state IS NULL
 THEN NEW.departure_state:='queued'; END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS viza_queue_departure_after_arrival_repair ON public.viza_guest_events;
CREATE TRIGGER viza_queue_departure_after_arrival_repair BEFORE UPDATE OF arrival_state ON public.viza_guest_events
FOR EACH ROW EXECUTE FUNCTION public.viza_queue_departure_after_arrival_repair();
