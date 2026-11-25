-- Keep service planning safe even while old PMSUpload browsers remain open.
-- Exact Hotel Memories + canonical organisation gates throughout.

-- Direct room-chip/housekeeper flag edits become dated manual instructions;
-- automatic PMS updates carry new metadata and cannot accidentally stamp them.
CREATE OR REPLACE FUNCTION public.hc_memories_stamp_service_manual_override()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $fn$
DECLARE v_today text := (now() AT TIME ZONE 'Europe/Budapest')::date::text;
BEGIN
 IF NEW.hotel NOT IN ('memories-budapest','Hotel Memories Budapest')
    OR NEW.organization_slug IS NULL THEN RETURN NEW; END IF;
 IF (NEW.towel_change_required IS DISTINCT FROM OLD.towel_change_required
      OR NEW.linen_change_required IS DISTINCT FROM OLD.linen_change_required)
    AND NEW.pms_metadata IS NOT DISTINCT FROM OLD.pms_metadata THEN
    NEW.pms_metadata := jsonb_set(coalesce(NEW.pms_metadata,'{}'::jsonb),
      '{memoriesServiceManualOverrideDate}',to_jsonb(v_today),true);
 END IF;
 RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS a_hc_memories_stamp_service_override ON public.rooms;
CREATE TRIGGER a_hc_memories_stamp_service_override
BEFORE UPDATE OF towel_change_required, linen_change_required
ON public.rooms FOR EACH ROW EXECUTE FUNCTION public.hc_memories_stamp_service_manual_override();

-- Spreadsheet room statuses sometimes omit occupiedToday entirely. Infer
-- today's stayover only from a dated XLS, a valid night count, a dirty/active
-- room and no checkout/no-show; never treat an absent PMS value as occupancy.
CREATE OR REPLACE FUNCTION public.hc_memories_normalize_upload_stayover()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $fn$
DECLARE
 v_meta jsonb := coalesce(NEW.pms_metadata,'{}'::jsonb);
 v_today text := (now() AT TIME ZONE 'Europe/Budapest')::date::text;
BEGIN
 IF NEW.hotel NOT IN ('memories-budapest','Hotel Memories Budapest')
    OR NEW.organization_slug IS NULL
    OR v_meta ->> 'pmsUploadDate' IS DISTINCT FROM v_today
    OR v_meta ->> 'lastPmsRefreshDate' IS DISTINCT FROM v_today
    OR NEW.is_checkout_room IS TRUE
    OR NEW.status IS DISTINCT FROM 'dirty'
    OR coalesce(v_meta ->> 'isNoShow','false') = 'true'
    OR coalesce(v_meta ->> 'isCancelled','false') = 'true'
    OR coalesce(v_meta ->> 'notArrived','false') = 'true'
    OR coalesce(v_meta ->> 'pmsUploadStatusNote','') = 'No Show'
    OR coalesce(v_meta ->> 'currentNight','') !~ '^[0-9]{1,2}$'
    OR coalesce(v_meta ->> 'totalNights','') !~ '^[0-9]{1,2}$'
 THEN RETURN NEW; END IF;
 IF (v_meta ->> 'currentNight')::integer NOT BETWEEN 1 AND (v_meta ->> 'totalNights')::integer
 THEN RETURN NEW; END IF;
 -- Only an XLS-shaped write may supply this derived metadata; a later live
 -- Previo feed is still authoritative and will overwrite it as appropriate.
 NEW.pms_metadata := jsonb_set(v_meta,'{occupiedToday}','true'::jsonb,true);
 RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS zzzzzzzzz_hc_memories_normalize_upload_stayover ON public.rooms;
CREATE TRIGGER zzzzzzzzz_hc_memories_normalize_upload_stayover
BEFORE UPDATE OF pms_metadata ON public.rooms FOR EACH ROW
EXECUTE FUNCTION public.hc_memories_normalize_upload_stayover();

-- The old spreadsheet importer stamps last_* when a service is DUE. Reject
-- those fake completions, including a same-day repeated identical upload.
-- A real staff-confirmed change updates last_* without SET pms_metadata.
CREATE OR REPLACE FUNCTION public.hc_memories_guard_upload_completion()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $fn$
DECLARE v_today text := (now() AT TIME ZONE 'Europe/Budapest')::date::text;
BEGIN
 IF NEW.hotel NOT IN ('memories-budapest','Hotel Memories Budapest')
    OR coalesce(NEW.pms_metadata ->> 'pmsUploadDate','') <> v_today
    OR coalesce(NEW.pms_metadata ->> 'lastPmsRefreshDate','') <> v_today
 THEN RETURN NEW; END IF;
 NEW.last_towel_change := OLD.last_towel_change;
 NEW.last_linen_change := OLD.last_linen_change;
 -- A repeated unchanged XLS row must not overwrite a manager's room-chip
 -- override using the legacy hard-coded 3/7/5/9 schedule.
 IF NEW.pms_metadata IS NOT DISTINCT FROM OLD.pms_metadata THEN
   NEW.towel_change_required := OLD.towel_change_required;
   NEW.linen_change_required := OLD.linen_change_required;
 END IF;
 RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS zzzzzzzzzzz_hc_memories_guard_upload_completion ON public.rooms;
CREATE TRIGGER zzzzzzzzzzz_hc_memories_guard_upload_completion
BEFORE UPDATE OF pms_metadata ON public.rooms FOR EACH ROW
EXECUTE FUNCTION public.hc_memories_guard_upload_completion();

-- A previous version of the XLS screen issues three destructive batch writes
-- before it validates the imported rows. Fail that statement atomically;
-- leave current room state and active assignment history intact. The legacy
-- client logs a warning and continues per-row updates with the safe trigger.
CREATE OR REPLACE FUNCTION public.hc_memories_block_batch_room_reset()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $fn$
DECLARE
 v_org text;
 v_total integer;
 v_cleared integer;
 v_checkout integer;
BEGIN
 SELECT o.slug INTO v_org FROM public.hotel_configurations hc
 JOIN public.organizations o ON o.id=hc.organization_id
 WHERE hc.hotel_id='memories-budapest' AND hc.is_active=true;
 IF v_org IS NULL THEN RETURN NULL; END IF;
 SELECT count(*) INTO v_total FROM new_rows n
 WHERE n.organization_slug=v_org AND n.hotel IN ('memories-budapest','Hotel Memories Budapest');
 IF v_total < 6 THEN RETURN NULL; END IF;
 SELECT count(*) INTO v_cleared FROM old_rows o JOIN new_rows n USING(id)
 WHERE o.organization_slug=v_org
   AND o.hotel IN ('memories-budapest','Hotel Memories Budapest')
   AND (coalesce(o.towel_change_required,false) OR coalesce(o.linen_change_required,false))
   AND NOT coalesce(n.towel_change_required,false) AND NOT coalesce(n.linen_change_required,false);
 SELECT count(*) INTO v_checkout FROM old_rows o JOIN new_rows n USING(id)
 WHERE o.organization_slug=v_org AND o.hotel IN ('memories-budapest','Hotel Memories Budapest')
   AND coalesce(o.is_checkout_room,false) AND NOT coalesce(n.is_checkout_room,false);
 IF v_cleared >= 2 AND NOT EXISTS (
   SELECT 1 FROM new_rows n WHERE n.organization_slug=v_org
   AND n.hotel IN ('memories-budapest','Hotel Memories Budapest')
   AND (coalesce(n.towel_change_required,false) OR coalesce(n.linen_change_required,false))
 ) THEN
   RAISE EXCEPTION 'Memories destructive bulk towel/Change Room reset blocked; use per-room reconciliation';
 END IF;
 IF v_checkout >= 2 AND NOT EXISTS (
   SELECT 1 FROM new_rows n WHERE n.organization_slug=v_org
   AND n.hotel IN ('memories-budapest','Hotel Memories Budapest')
   AND coalesce(n.is_checkout_room,false)
 ) THEN
   RAISE EXCEPTION 'Memories destructive bulk checkout reset blocked; use per-room PMS reconciliation';
 END IF;
 RETURN NULL;
END;
$fn$;
DROP TRIGGER IF EXISTS zz_hc_memories_block_batch_room_reset ON public.rooms;
CREATE TRIGGER zz_hc_memories_block_batch_room_reset
AFTER UPDATE ON public.rooms REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
FOR EACH STATEMENT EXECUTE FUNCTION public.hc_memories_block_batch_room_reset();

CREATE OR REPLACE FUNCTION public.hc_memories_block_mass_assignment_deletion()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $fn$
DECLARE v_org text; v_count integer;
BEGIN
 SELECT o.slug INTO v_org FROM public.hotel_configurations hc
 JOIN public.organizations o ON o.id=hc.organization_id
 WHERE hc.hotel_id='memories-budapest' AND hc.is_active=true;
 IF v_org IS NULL THEN RETURN NULL; END IF;
 SELECT count(*) INTO v_count FROM old_assignments a
 JOIN public.rooms r ON r.id=a.room_id
 WHERE r.organization_slug=v_org
   AND r.hotel IN ('memories-budapest','Hotel Memories Budapest')
   AND a.assignment_date=(now() AT TIME ZONE 'Europe/Budapest')::date;
 IF v_count >= 3 THEN
  RAISE EXCEPTION 'Memories destructive bulk deletion blocked: preserve live housekeeping assignments';
 END IF;
 RETURN NULL;
END;
$fn$;
DROP TRIGGER IF EXISTS zz_hc_memories_block_mass_assignment_deletion ON public.room_assignments;
CREATE TRIGGER zz_hc_memories_block_mass_assignment_deletion
AFTER DELETE ON public.room_assignments REFERENCING OLD TABLE AS old_assignments
FOR EACH STATEMENT EXECUTE FUNCTION public.hc_memories_block_mass_assignment_deletion();
