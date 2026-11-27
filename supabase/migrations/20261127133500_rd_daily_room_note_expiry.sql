-- Restore the RD Hotels daily operational note lifecycle without deleting history.
-- Planned instructions and independent service flags are not daily free text.
CREATE OR REPLACE FUNCTION public.hc_portfolio_require_human_room_note_origin()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_old_base text;
  v_new_base text;
  v_original_human_text text;
  v_is_memories boolean := lower(btrim(coalesce(NEW.hotel,''))) IN
    ('hotel memories budapest','memories budapest','memories-budapest');
  v_today date := (statement_timestamp() AT TIME ZONE 'Europe/Budapest')::date;
BEGIN
  -- Compare only the editable human text, excluding scheduled/approved
  -- calendar shadows and the independent operational service markers.
  v_old_base := public.room_note_history_text(replace(
    coalesce(OLD.notes,''), coalesce(OLD.hotelcare_planned_note_shadow,''), ''
  ));
  v_new_base := public.room_note_history_text(replace(
    coalesce(NEW.notes,''), coalesce(NEW.hotelcare_planned_note_shadow,''), ''
  ));
  IF v_new_base IS NOT DISTINCT FROM v_old_base THEN
    IF NEW.organization_slug = 'rdhotels' THEN
      NEW.operational_note_date := OLD.operational_note_date;
    END IF;
    RETURN NEW;
  END IF;

  -- Only a dated, expired note may be removed by the daily worker.
  IF NEW.organization_slug = 'rdhotels'
     AND v_actor IS NULL AND v_new_base = ''
     AND OLD.operational_note_date < v_today
     AND NEW.operational_note_date IS NULL
     AND NEW.pms_metadata IS NOT DISTINCT FROM OLD.pms_metadata
  THEN
    RETURN NEW;
  END IF;

  -- HMB has a documented next-business-day expiry for dated human notes.
  -- Preserve this narrow intentional cleanup; a PMS sync does not qualify.
  IF v_is_memories AND v_new_base = ''
     AND OLD.memories_manual_note_date IS NOT NULL
     AND OLD.memories_manual_note_date < v_today
     AND NEW.memories_manual_note_date IS NULL
     AND NEW.pms_metadata IS NOT DISTINCT FROM OLD.pms_metadata
  THEN
    RETURN NEW;
  END IF;

  -- A PMS refresh, scheduled worker or background service is never the
  -- human editor. Protect the previous note whether a job tries to insert,
  -- replace OR silently clear it. A PMS API refresh initiated with a logged-in
  -- user is also detected by its pms_metadata change.
  IF v_actor IS NULL OR NEW.pms_metadata IS DISTINCT FROM OLD.pms_metadata THEN
    v_original_human_text := btrim(regexp_replace(
      replace(coalesce(OLD.notes,''), coalesce(OLD.hotelcare_planned_note_shadow,''), ''),
      '\[(COLLECT_EXTRA_TOWELS|ROOM_CLEANING)\]',
      '', 'g'
    ));

    -- The new operational markers stay in place; approved planned notes keep
    -- their own date-bound shadow. Only the unverified free-text is rejected.
    NEW.notes := nullif(btrim(concat_ws(' ',
      CASE WHEN position('[COLLECT_EXTRA_TOWELS]' IN coalesce(NEW.notes,'')) > 0
        THEN '[COLLECT_EXTRA_TOWELS]' END,
      CASE WHEN position('[ROOM_CLEANING]' IN coalesce(NEW.notes,'')) > 0
        THEN '[ROOM_CLEANING]' END,
      nullif(v_original_human_text,''),
      nullif(btrim(coalesce(NEW.hotelcare_planned_note_shadow,'')), '')
    )), '');
    IF NEW.organization_slug = 'rdhotels' THEN
      NEW.operational_note_date := OLD.operational_note_date;
    END IF;
    RETURN NEW;
  END IF;

  IF NOT public.is_super_admin(v_actor)
     AND coalesce(public.get_user_role(v_actor)::text,'') NOT IN
       ('admin','top_management','top_management_manager',
        'manager','housekeeping_manager','supervisor')
  THEN
    RAISE EXCEPTION 'Only managers or supervisors can edit shared hotel room notes';
  END IF;
  IF NEW.organization_slug = 'rdhotels' THEN
    NEW.operational_note_date := CASE WHEN v_new_base = '' THEN NULL ELSE v_today END;
  END IF;
  RETURN NEW;
END;
$function$;


REVOKE ALL ON FUNCTION public.hc_portfolio_require_human_room_note_origin() FROM PUBLIC, anon, authenticated;

-- Only date legacy notes with a matching latest audit event. Do not infer the
-- date from room.updated_at, which can change during PMS refresh or cleaning.
WITH latest AS (
  SELECT r.id, (e.event_at AT TIME ZONE 'Europe/Budapest')::date AS note_date
  FROM public.rooms r
  CROSS JOIN LATERAL (
    SELECT event_at, content FROM (
      SELECT h.created_at AS event_at, h.content
      FROM public.housekeeping_notes h
      WHERE h.room_id = r.id AND h.organization_slug = r.organization_slug
        AND h.note_type = 'room_note_history'
      UNION ALL
      SELECT p.recorded_at, p.content
      FROM public.room_note_provenance_events p
      WHERE p.room_id = r.id AND p.organization_slug = r.organization_slug
    ) events ORDER BY event_at DESC LIMIT 1
  ) e
  WHERE r.organization_slug = 'rdhotels' AND r.operational_note_date IS NULL
    AND coalesce(r.hotelcare_planned_note_shadow,'') = ''
    AND public.room_note_history_text(r.notes) <> ''
    AND public.room_note_history_text(e.content) = public.room_note_history_text(r.notes)
)
UPDATE public.rooms r SET operational_note_date = latest.note_date
FROM latest WHERE r.id = latest.id AND r.operational_note_date IS NULL;

CREATE OR REPLACE FUNCTION public.hc_expire_rd_workday_room_notes()
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_today date := (statement_timestamp() AT TIME ZONE 'Europe/Budapest')::date;
  v_count integer;
BEGIN
  UPDATE public.rooms r
  SET notes = nullif(concat_ws(' ',
    CASE WHEN position('[COLLECT_EXTRA_TOWELS]' IN coalesce(r.notes,'')) > 0
      THEN '[COLLECT_EXTRA_TOWELS]' END,
    CASE WHEN position('[ROOM_CLEANING]' IN coalesce(r.notes,'')) > 0
      THEN '[ROOM_CLEANING]' END
  ), ''),
  operational_note_date = NULL,
  memories_manual_note_date = CASE WHEN r.memories_manual_note_date < v_today
    THEN NULL ELSE r.memories_manual_note_date END
  WHERE r.organization_slug = 'rdhotels'
    AND r.operational_note_date < v_today
    AND public.room_note_history_text(replace(coalesce(r.notes,''),coalesce(r.hotelcare_planned_note_shadow,''),'')) <> '';
  -- The existing planned-note trigger reconstructs today's approved shadow.
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;
REVOKE ALL ON FUNCTION public.hc_expire_rd_workday_room_notes() FROM PUBLIC, anon, authenticated;

-- The scheduler runs as the migration owner, not a public RPC caller.
SELECT cron.schedule('hotelcare-expire-rd-daily-room-notes','* * * * *',
  'SELECT public.hc_expire_rd_workday_room_notes();');
SELECT public.hc_expire_rd_workday_room_notes();
