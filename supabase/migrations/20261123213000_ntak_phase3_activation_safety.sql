-- Post-Phase-3 NTAK activation + VIZA nonblocking follow-up.
-- APPLY AFTER 20261123201000_ntak_phase3_finance_guard.sql.
-- All previously reviewed/applied Phase 1–3 migrations remain unchanged.
-- Written by the GitHub file API, not an interpolating shell heredoc: $$ preserved.

-- Queue failures are independent of the VIZA guest-event queue: even an INSERT
-- failure before the first event has a durable, staff-visible retry record.
CREATE TABLE IF NOT EXISTS public.viza_trigger_failures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL,
  organization_slug text NOT NULL,
  reservation_id uuid NOT NULL REFERENCES public.reservations(id) ON DELETE CASCADE,
  from_status text NOT NULL,
  to_status text NOT NULL,
  occurred_at timestamptz NOT NULL,
  sqlstate text NOT NULL,
  last_error text NOT NULL,
  attempts integer NOT NULL DEFAULT 1 CHECK (attempts > 0),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS viza_trigger_failures_open_transition
  ON public.viza_trigger_failures(reservation_id,from_status,to_status)
  WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS viza_trigger_failures_hotel_pending
  ON public.viza_trigger_failures(hotel_id,updated_at DESC)
  WHERE resolved_at IS NULL;
ALTER TABLE public.viza_trigger_failures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "PMS staff view VIZA queue failures" ON public.viza_trigger_failures;
CREATE POLICY "PMS staff view VIZA queue failures"
ON public.viza_trigger_failures FOR SELECT TO authenticated
USING (public.has_pms_access(auth.uid())
  AND public.can_access_reservation(auth.uid(), reservation_id));
GRANT SELECT ON public.viza_trigger_failures TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.viza_trigger_failures FROM PUBLIC, anon, authenticated;

-- Backfill only guests with independently recognizable arrival evidence.
-- The booker is represented by the checked-in/out reservation itself; other
-- companions require an existing VIZA arrival. Do not invent companion stays,
-- mutate void/departed guests, or touch unrelated non-NTAK rooms.
CREATE OR REPLACE FUNCTION public.pms_rebuild_ntak_guest_states(_hotel_id text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE updated_rows integer := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.ntak_settings
    WHERE hotel_id=_hotel_id AND enabled) THEN RETURN 0; END IF;

  UPDATE public.reservation_guests rg SET
    stay_state=CASE WHEN r.status='checked_out' THEN 'departed' ELSE 'in_house' END,
    arrived_at=COALESCE(v.erkezes_ideje,r.actual_check_in,
      r.check_in_date::timestamp AT TIME ZONE 'Europe/Budapest'),
    departed_at=CASE WHEN r.status='checked_out'
      THEN COALESCE(v.tavozas_ideje,r.actual_check_out,
        r.check_out_date::timestamp AT TIME ZONE 'Europe/Budapest')
      ELSE NULL END,
    room_id=COALESCE(rg.room_id,r.room_id)
  FROM public.reservations r
  JOIN public.ntak_settings cfg ON cfg.hotel_id=r.hotel_id AND cfg.enabled
  LEFT JOIN LATERAL (
    SELECT ev.guest_id,ev.erkezes_ideje,ev.tavozas_ideje,ev.arrival_state
    FROM public.viza_guest_events ev
    WHERE ev.reservation_id=r.id AND ev.guest_id=rg.guest_id
      AND ev.arrival_state IN ('queued','sent')
    LIMIT 1
  ) v ON true
  WHERE rg.reservation_id=r.id
    AND r.hotel_id=_hotel_id
    AND r.status IN ('checked_in','checked_out')
    AND rg.stay_state='expected' AND rg.arrived_at IS NULL
    AND (rg.is_primary OR rg.guest_id=r.guest_id OR v.guest_id IS NOT NULL)
    AND (
      cfg.unit_scope IS DISTINCT FROM 'profiled_only'
      OR (r.room_id IS NOT NULL AND EXISTS(
        SELECT 1 FROM public.ntak_unit_profiles p
        WHERE p.hotel_id=r.hotel_id AND p.room_id=r.room_id AND p.active))
      OR (r.room_id IS NULL AND r.room_type_id IS NOT NULL AND EXISTS(
        SELECT 1 FROM public.ntak_room_type_units t
        WHERE t.hotel_id=r.hotel_id AND t.room_type_id=r.room_type_id AND t.active))
    );

  GET DIAGNOSTICS updated_rows=ROW_COUNT;
  RETURN updated_rows;
END;
$$;
REVOKE ALL ON FUNCTION public.pms_rebuild_ntak_guest_states(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pms_rebuild_ntak_guest_states(text) TO service_role;

-- The AFTER trigger sees the committed enabled=true row in its transaction.
-- Failure rolls back activation rather than switching on broken check-out data.
CREATE OR REPLACE FUNCTION public.ntak_rebuild_guest_states_on_enable()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.enabled AND
     (TG_OP='INSERT' OR (TG_OP='UPDATE' AND OLD.enabled IS DISTINCT FROM true))
  THEN
    PERFORM public.pms_rebuild_ntak_guest_states(NEW.hotel_id);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.ntak_rebuild_guest_states_on_enable()
  FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS ntak_rebuild_guest_states_on_enable ON public.ntak_settings;
CREATE TRIGGER ntak_rebuild_guest_states_on_enable
AFTER INSERT OR UPDATE OF enabled ON public.ntak_settings
FOR EACH ROW EXECUTE FUNCTION public.ntak_rebuild_guest_states_on_enable();

-- Shared VIZA status change handler: used by the status trigger AND a
-- narrowly authorized replay of a recorded queue-insertion failure.
CREATE OR REPLACE FUNCTION public.pms_viza_apply_status_transition(
  _reservation_id uuid,_from_status text,_to_status text,_moment timestamptz
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  r public.reservations%ROWTYPE;
  cfg public.viza_settings%ROWTYPE;
  link record;
BEGIN
  SELECT * INTO r FROM public.reservations WHERE id=_reservation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'RESERVATION_NOT_FOUND'; END IF;
  SELECT * INTO cfg FROM public.viza_settings
  WHERE hotel_id=r.hotel_id AND enabled AND adatszolgaltatasi_azonosito IS NOT NULL;
  IF NOT FOUND THEN RETURN; END IF;

  IF _from_status='checked_out' AND _to_status='checked_in' THEN
    UPDATE public.viza_guest_events SET tavozas_ideje=NULL,
      departure_state=NULL,updated_at=now()
    WHERE reservation_id=r.id AND departure_state IS DISTINCT FROM 'sent';
    UPDATE public.viza_guest_events
    SET last_error='Departure already sent to VIZA; manual correction required after undo',
      updated_at=now()
    WHERE reservation_id=r.id AND departure_state='sent';
  ELSIF _from_status='checked_in' AND _to_status IN ('confirmed','pending') THEN
    DELETE FROM public.viza_guest_events
    WHERE reservation_id=r.id AND arrival_state='queued';
    UPDATE public.viza_guest_events
    SET last_error='Arrival already sent to VIZA; manual correction required after undo',
      updated_at=now()
    WHERE reservation_id=r.id AND arrival_state='sent';
  ELSIF _to_status='checked_in' AND _from_status IS DISTINCT FROM 'checked_in' THEN
    FOR link IN SELECT rg.guest_id FROM public.reservation_guests rg
      WHERE rg.reservation_id=r.id LOOP
      INSERT INTO public.viza_guest_events
        (hotel_id,organization_slug,reservation_id,guest_id,
         erkezes_ideje,tavozas_varhato_datuma)
      VALUES(r.hotel_id,cfg.organization_slug,r.id,link.guest_id,
        COALESCE(r.actual_check_in,_moment),r.check_out_date)
      ON CONFLICT (reservation_id,COALESCE(guest_id,
        '00000000-0000-0000-0000-000000000000'::uuid)) DO NOTHING;
    END LOOP;
  ELSIF _to_status='checked_out' AND _from_status IS DISTINCT FROM 'checked_out' THEN
    UPDATE public.viza_guest_events
    SET tavozas_ideje=COALESCE(r.actual_check_out,_moment),
      departure_state=CASE WHEN arrival_state='sent' THEN 'queued'
        ELSE departure_state END,updated_at=now()
    WHERE reservation_id=r.id AND tavozas_ideje IS NULL;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.pms_viza_apply_status_transition(uuid,text,text,timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pms_viza_apply_status_transition(uuid,text,text,timestamptz)
  TO service_role;

-- Fail-open front desk operation: rollback only VIZA queue changes, record
-- the failure independently in this transaction, and return NEW in every
-- case. On repeated attempts, reuse the unresolved failure record.
CREATE OR REPLACE FUNCTION public.viza_on_reservation_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  moment_at timestamptz;
  failure_state text;
  failure_message text;
BEGIN
  IF current_setting('hotelcare.guest_lifecycle',true)='1' THEN RETURN NEW; END IF;
  moment_at:=COALESCE(NULLIF(current_setting('hotelcare.business_moment',true),'')::timestamptz,clock_timestamp());
  BEGIN
    PERFORM public.pms_viza_apply_status_transition(NEW.id,OLD.status::text,
      NEW.status::text,moment_at);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS failure_state=RETURNED_SQLSTATE,
      failure_message=MESSAGE_TEXT;
    BEGIN
      INSERT INTO public.viza_trigger_failures
        (hotel_id,organization_slug,reservation_id,from_status,to_status,
         occurred_at,sqlstate,last_error)
      VALUES(NEW.hotel_id,NEW.organization_slug,NEW.id,
        OLD.status::text,NEW.status::text,moment_at,failure_state,
        left(failure_message,500))
      ON CONFLICT (reservation_id,from_status,to_status)
        WHERE resolved_at IS NULL
      DO UPDATE SET attempts=public.viza_trigger_failures.attempts+1,
        sqlstate=EXCLUDED.sqlstate,last_error=EXCLUDED.last_error,
        occurred_at=EXCLUDED.occurred_at,updated_at=now();
      UPDATE public.viza_settings
      SET last_error=left('VIZA queue error for reservation '||NEW.id::text||
        ': '||failure_message,1000),updated_at=now()
      WHERE hotel_id=NEW.hotel_id;
    EXCEPTION WHEN OTHERS THEN
      -- Even failure-logging problems may never roll back check-in/out.
      RAISE WARNING 'VIZA failure log unavailable (reservation %): %',
        NEW.id,SQLERRM;
    END;
    RAISE WARNING 'viza_on_reservation_status (%): %',
      NEW.id,failure_message;
  END;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.viza_on_reservation_status()
  FROM PUBLIC, anon, authenticated;

-- Status-only retry. User must be authenticated AND allowed to access the
-- reservation's property. Do not replay if reservation status has changed.
CREATE OR REPLACE FUNCTION public.pms_retry_viza_trigger_failure(_failure_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  f public.viza_trigger_failures%ROWTYPE;
  r public.reservations%ROWTYPE;
  actor uuid:=auth.uid();
BEGIN
  SELECT * INTO f FROM public.viza_trigger_failures WHERE id=_failure_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'VIZA_FAILURE_NOT_FOUND'; END IF;
  SELECT * INTO r FROM public.reservations WHERE id=f.reservation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RESERVATION_NOT_FOUND'; END IF;
  IF actor IS NULL OR NOT public.has_pms_access(actor) OR
    NOT public.can_access_pms_hotel(actor,r.hotel_id,r.organization_slug) OR
    r.hotel_id IS DISTINCT FROM f.hotel_id OR
    r.organization_slug IS DISTINCT FROM f.organization_slug THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;
  IF f.resolved_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok',true,'already_resolved',true);
  END IF;
  IF r.status::text IS DISTINCT FROM f.to_status THEN
    RAISE EXCEPTION 'VIZA_RETRY_STATUS_CHANGED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.viza_settings
      WHERE hotel_id=f.hotel_id AND enabled AND adatszolgaltatasi_azonosito IS NOT NULL) THEN
    RAISE EXCEPTION 'VIZA_NOT_ENABLED';
  END IF;
  PERFORM public.pms_viza_apply_status_transition(f.reservation_id,
    f.from_status,f.to_status,f.occurred_at);
  UPDATE public.viza_trigger_failures
  SET resolved_at=now(),updated_at=now() WHERE id=f.id;
  UPDATE public.viza_settings
  SET last_error=NULL,updated_at=now()
  WHERE hotel_id=f.hotel_id AND last_error LIKE 'VIZA queue error for reservation %'
    AND NOT EXISTS (SELECT 1 FROM public.viza_trigger_failures q
      WHERE q.hotel_id=f.hotel_id AND q.resolved_at IS NULL);
  RETURN jsonb_build_object('ok',true,'reservation_id',r.id,
    'failure_id',f.id);
END;
$$;
REVOKE ALL ON FUNCTION public.pms_retry_viza_trigger_failure(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pms_retry_viza_trigger_failure(uuid)
  TO authenticated, service_role;

-- Per-guest functions below keep their signatures and grants. Only the
-- checked-in undo state and VIZA sent-arrival correction flags change.

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
        SET last_error=CASE WHEN COALESCE(v.last_error,'') ILIKE '%manual correction%'
          THEN v.last_error ELSE 'Re-arrival after VIZA transmission requires manual correction' END,
          updated_at=now() WHERE id=v.id;
      ELSE
        UPDATE public.viza_guest_events
          SET erkezes_ideje=_moment,tavozas_ideje=NULL,departure_state=NULL,
          arrival_state='queued',last_error=NULL,updated_at=now() WHERE id=v.id;
      END IF;
    ELSIF _action IN ('depart','undo_arrival') THEN
      IF FOUND THEN
        UPDATE public.viza_guest_events SET tavozas_ideje=_moment,
          departure_state='queued',
          last_error=CASE WHEN _action='undo_arrival' AND v.arrival_state='sent'
            THEN 'Arrival already sent to VIZA; manual correction required after undo'
            ELSE v.last_error END,
          updated_at=now() WHERE id=v.id;
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
