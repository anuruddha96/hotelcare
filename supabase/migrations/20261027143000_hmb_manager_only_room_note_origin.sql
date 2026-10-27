-- HMB: distinguish human-authored daily housekeeping instructions from
-- stale reservation notes reintroduced by an automatic Previo refresh.
-- Do not touch other hotels, historical audit events, PMS metadata or beds.
--
-- The late BEFORE trigger runs after room-type and planned-note adjustments.
-- A planned note remains permitted: its approved shadow is kept separate
-- from the manually editable base text.
CREATE OR REPLACE FUNCTION public.hc_memories_require_human_room_note_origin()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_old_base text;
  v_new_base text;
  v_old_without_shadow text;
  v_new_without_shadow text;
  v_user uuid := auth.uid();
  v_pms_changed boolean;
  v_old_human_original text;
BEGIN
  IF lower(btrim(coalesce(NEW.hotel, ''))) NOT IN
    ('hotel memories budapest', 'memories budapest', 'memories-budapest')
  THEN
    RETURN NEW;
  END IF;

  v_old_without_shadow := replace(
    coalesce(OLD.notes, ''), coalesce(OLD.hotelcare_planned_note_shadow, ''), ''
  );
  v_new_without_shadow := replace(
    coalesce(NEW.notes, ''), coalesce(NEW.hotelcare_planned_note_shadow, ''), ''
  );
  v_old_base := public.room_note_history_text(v_old_without_shadow);
  v_new_base := public.room_note_history_text(v_new_without_shadow);
  IF v_new_base IS NOT DISTINCT FROM v_old_base THEN
    RETURN NEW;
  END IF;

  v_pms_changed := NEW.pms_metadata IS DISTINCT FROM OLD.pms_metadata;

  -- Do not invent a "fresh" human instruction from a Previo note. This
  -- includes refreshes initiated under a reception/manager's JWT as well
  -- as background service-role syncs. An intentional daily note expiry
  -- (new base empty) remains possible.
  IF v_new_base <> '' AND (v_user IS NULL OR v_pms_changed) THEN
    v_old_human_original := btrim(regexp_replace(
      v_old_without_shadow,
      '\[(COLLECT_EXTRA_TOWELS|ROOM_CLEANING)\]',
      '',
      'g'
    ));
    NEW.notes := nullif(btrim(concat_ws(' ',
      CASE WHEN position('[COLLECT_EXTRA_TOWELS]' IN coalesce(NEW.notes, '')) > 0
        THEN '[COLLECT_EXTRA_TOWELS]' END,
      CASE WHEN position('[ROOM_CLEANING]' IN coalesce(NEW.notes, '')) > 0
        THEN '[ROOM_CLEANING]' END,
      nullif(v_old_human_original, ''),
      nullif(btrim(coalesce(NEW.hotelcare_planned_note_shadow, '')), '')
    )), '');
    NEW.memories_manual_note_date := OLD.memories_manual_note_date;
    RETURN NEW;
  END IF;

  -- A manual free-text edit, including clearing it, requires an authorized
  -- hotel manager/supervisor. Housekeepers can still change independent
  -- operational service flags because those are stripped above.
  IF v_user IS NOT NULL
     AND NOT public.is_super_admin(v_user)
     AND coalesce(public.get_user_role(v_user)::text, '') NOT IN
       ('admin', 'top_management', 'top_management_manager',
        'manager', 'housekeeping_manager', 'supervisor')
  THEN
    RAISE EXCEPTION 'Only Hotel Memories managers or supervisors can edit shared room notes';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS zzzzzzzzzzzzzzzzzzzz_hc_memories_manager_note_origin ON public.rooms;
CREATE TRIGGER zzzzzzzzzzzzzzzzzzzz_hc_memories_manager_note_origin
BEFORE UPDATE OF notes, pms_metadata ON public.rooms
FOR EACH ROW EXECUTE FUNCTION public.hc_memories_require_human_room_note_origin();

REVOKE ALL ON FUNCTION public.hc_memories_require_human_room_note_origin() FROM PUBLIC, anon, authenticated;
