-- NTAK PMS v9 Phase 4: dated room out-of-order / out-of-service history.
-- New migration only: no changes to reviewed/applied Phase 1–3 migrations.
-- Stored dates are inclusive Budapest business dates. Extra beds remain separate
-- from room capacity. Room.hotel is a DISPLAY NAME, never a hotel_id.

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE public.room_state_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL,
  organization_slug text NOT NULL,
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  state text NOT NULL CHECK (state IN ('out_of_order','out_of_service')),
  from_date date NOT NULL,
  to_date date NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT room_state_period_dates CHECK (from_date <= to_date),
  CONSTRAINT room_state_period_no_overlap EXCLUDE USING gist
    (room_id WITH =, daterange(from_date, to_date, '[]') WITH &&)
);
CREATE INDEX room_state_periods_hotel_dates
  ON public.room_state_periods(hotel_id, from_date, to_date);
CREATE INDEX room_state_periods_room_dates
  ON public.room_state_periods(room_id, from_date, to_date);

-- Remember the room's housekeeping state before a dated unavailability period
-- takes over rooms.status. Restore it when the last active period expires.
CREATE TABLE public.room_state_status_baselines (
  room_id uuid PRIMARY KEY REFERENCES public.rooms(id) ON DELETE CASCADE,
  original_status text,
  captured_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.room_state_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_state_status_baselines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.room_state_periods, public.room_state_status_baselines
  FROM PUBLIC, anon, authenticated;
CREATE POLICY "Hotel staff view room state history"
  ON public.room_state_periods FOR SELECT TO authenticated
  USING (
    public.user_can_access_hotel(auth.uid(), hotel_id)
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id=auth.uid() AND p.organization_slug=room_state_periods.organization_slug
    )
  );
GRANT SELECT ON public.room_state_periods TO authenticated;
-- No client INSERT/UPDATE/DELETE rights on period rows or baseline snapshots.
-- All writes are audited, scope-checked SECURITY DEFINER RPCs below.

-- Reconcile an individual room against today's Budapest date.
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
REVOKE ALL ON FUNCTION public.pms_sync_room_state_period(uuid)
  FROM PUBLIC,anon,authenticated;

-- Prevent housekeeping and reception edits from accidentally overriding an
-- active OOO/OOS restriction. Only a period change can release the room.
CREATE OR REPLACE FUNCTION public.pms_guard_active_room_state_period()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE current_state text;
  today date:=(now() AT TIME ZONE 'Europe/Budapest')::date;
BEGIN
  SELECT state INTO current_state FROM public.room_state_periods
  WHERE room_id=NEW.id AND from_date<=today AND to_date>=today LIMIT 1;
  IF FOUND THEN NEW.status:=current_state; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.pms_guard_active_room_state_period()
  FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS pms_guard_active_room_state_period ON public.rooms;
CREATE TRIGGER pms_guard_active_room_state_period
BEFORE UPDATE OF status ON public.rooms FOR EACH ROW
EXECUTE FUNCTION public.pms_guard_active_room_state_period();

-- Immediately synchronize rooms.status after a dated period is added/ended.
CREATE OR REPLACE FUNCTION public.pms_on_room_state_period_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    PERFORM public.pms_sync_room_state_period(OLD.room_id);
    RETURN OLD;
  END IF;
  PERFORM public.pms_sync_room_state_period(NEW.room_id);
  IF TG_OP='UPDATE' AND OLD.room_id IS DISTINCT FROM NEW.room_id THEN
    PERFORM public.pms_sync_room_state_period(OLD.room_id);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.pms_on_room_state_period_change()
  FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS pms_on_room_state_period_change ON public.room_state_periods;
CREATE TRIGGER pms_on_room_state_period_change
AFTER INSERT OR UPDATE OR DELETE ON public.room_state_periods
FOR EACH ROW EXECUTE FUNCTION public.pms_on_room_state_period_change();

-- Future starts and past ends must also take effect without a new user write.
-- Only current-period rooms and rooms with a saved pre-period status are scanned.
CREATE OR REPLACE FUNCTION public.pms_sync_room_state_periods()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE x record; changed integer:=0;
  today date:=(now() AT TIME ZONE 'Europe/Budapest')::date;
BEGIN
  FOR x IN
    SELECT p.room_id FROM public.room_state_periods p
      WHERE p.from_date<=today AND p.to_date>=today
    UNION
    SELECT b.room_id FROM public.room_state_status_baselines b
  LOOP
    PERFORM public.pms_sync_room_state_period(x.room_id);
    changed:=changed+1;
  END LOOP;
  RETURN changed;
END;
$$;
REVOKE ALL ON FUNCTION public.pms_sync_room_state_periods()
  FROM PUBLIC,anon,authenticated;
-- Existing Supabase project already uses pg_cron. Idempotent named job.
SELECT cron.schedule('ntak-phase4-room-state-sync', '*/5 * * * *',
  $cron$SELECT public.pms_sync_room_state_periods()$cron$);

-- Server-side mutation boundary: room.hotel is the display name. Validate
-- through pms_hotel_room_keys, organization_slug, role and hotel access.
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
  INSERT INTO public.room_state_periods
    (hotel_id,organization_slug,room_id,state,from_date,to_date,reason,created_by)
  VALUES(_hotel_id,v_org,_room_id,_state,_from_date,_to_date,btrim(_reason),actor)
  RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;
REVOKE ALL ON FUNCTION public.pms_add_room_state_period(text,uuid,text,date,date,text)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.pms_add_room_state_period(text,uuid,text,date,date,text)
  TO authenticated;

-- "End" sets the inclusive LAST affected day. It cannot rewrite past data,
-- extend a restricted period, or create overlap with another period.
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
  UPDATE public.room_state_periods SET to_date=_last_day WHERE id=p.id;
  RETURN p.id;
END;
$$;
REVOKE ALL ON FUNCTION public.pms_end_room_state_period(uuid,date)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.pms_end_room_state_period(uuid,date)
  TO authenticated;
