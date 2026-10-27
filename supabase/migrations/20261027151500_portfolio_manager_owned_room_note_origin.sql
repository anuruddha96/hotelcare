-- Safeguard shared operational room notes at every HotelCare property.
-- Hotel Memories retains its already-deployed dedicated guard and daily expiry.
-- This does not modify existing records, room assignments, scheduled notes,
-- Previo source metadata, or immutable provenance/audit history.
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
BEGIN
  -- HMB already has a tailored note guard with a deliberate overnight expiry
  -- policy. Keep that established lifecycle untouched.
  IF lower(btrim(coalesce(NEW.hotel,''))) IN
    ('hotel memories budapest','memories budapest','memories-budapest')
  THEN
    RETURN NEW;
  END IF;

  -- Compare only the editable human text, excluding scheduled/approved
  -- calendar shadows and the independent operational service markers.
  v_old_base := public.room_note_history_text(replace(
    coalesce(OLD.notes,''), coalesce(OLD.hotelcare_planned_note_shadow,''), ''
  ));
  v_new_base := public.room_note_history_text(replace(
    coalesce(NEW.notes,''), coalesce(NEW.hotelcare_planned_note_shadow,''), ''
  ));
  IF v_new_base IS NOT DISTINCT FROM v_old_base THEN RETURN NEW; END IF;

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
    RETURN NEW;
  END IF;

  IF NOT public.is_super_admin(v_actor)
     AND coalesce(public.get_user_role(v_actor)::text,'') NOT IN
       ('admin','top_management','top_management_manager',
        'manager','housekeeping_manager','supervisor')
  THEN
    RAISE EXCEPTION 'Only managers or supervisors can edit shared hotel room notes';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS zzzzzzzzzzzzzzzzzzz_hc_portfolio_manager_note_origin ON public.rooms;
CREATE TRIGGER zzzzzzzzzzzzzzzzzzz_hc_portfolio_manager_note_origin
BEFORE UPDATE OF notes, pms_metadata ON public.rooms
FOR EACH ROW EXECUTE FUNCTION public.hc_portfolio_require_human_room_note_origin();

REVOKE ALL ON FUNCTION public.hc_portfolio_require_human_room_note_origin()
  FROM PUBLIC, anon, authenticated;
