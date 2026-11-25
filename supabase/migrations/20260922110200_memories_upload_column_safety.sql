-- A legacy XLS importer may SET pms_metadata to the *same* value while
-- writing stale hard-coded T/C flags. Distinguish which columns were SET;
-- equality of JSON data is not evidence that a manager edited the flags.
-- All markers are ephemeral and stripped BEFORE the row is persisted.
CREATE OR REPLACE FUNCTION public.hc_memories_mark_pms_column_write()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $fn$
DECLARE v_org text;
BEGIN
 IF NEW.hotel NOT IN ('memories-budapest','Hotel Memories Budapest') THEN RETURN NEW; END IF;
 SELECT o.slug INTO v_org FROM public.hotel_configurations h
 JOIN public.organizations o ON o.id=h.organization_id
 WHERE h.hotel_id='memories-budapest' AND h.is_active=true;
 IF NEW.organization_slug IS DISTINCT FROM v_org THEN RETURN NEW; END IF;
 NEW.pms_metadata := jsonb_set(coalesce(NEW.pms_metadata,'{}'::jsonb),
   '{memoriesPmsColumnPresent}','true'::jsonb,true);
 RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS a0_hc_memories_mark_pms_column_write ON public.rooms;
CREATE TRIGGER a0_hc_memories_mark_pms_column_write
BEFORE UPDATE OF pms_metadata ON public.rooms FOR EACH ROW
EXECUTE FUNCTION public.hc_memories_mark_pms_column_write();

CREATE OR REPLACE FUNCTION public.hc_memories_stamp_service_manual_override()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $fn$
DECLARE
 v_today text := (now() AT TIME ZONE 'Europe/Budapest')::date::text;
 v_org text;
BEGIN
 IF NEW.hotel NOT IN ('memories-budapest','Hotel Memories Budapest') THEN RETURN NEW; END IF;
 SELECT o.slug INTO v_org FROM public.hotel_configurations h
 JOIN public.organizations o ON o.id=h.organization_id
 WHERE h.hotel_id='memories-budapest' AND h.is_active=true;
 IF v_org IS NULL OR NEW.organization_slug IS DISTINCT FROM v_org THEN RETURN NEW; END IF;
 IF (NEW.towel_change_required IS DISTINCT FROM OLD.towel_change_required
     OR NEW.linen_change_required IS DISTINCT FROM OLD.linen_change_required)
    AND coalesce(NEW.pms_metadata ->> 'memoriesPmsColumnPresent','false') <> 'true'
    AND NEW.pms_metadata IS NOT DISTINCT FROM OLD.pms_metadata THEN
   NEW.pms_metadata := jsonb_set(coalesce(NEW.pms_metadata,'{}'::jsonb),
     '{memoriesServiceManualOverrideDate}',to_jsonb(v_today),true);
 END IF;
 RETURN NEW;
END;
$fn$;

-- The XLS file does not include the live API's occupiedToday flag. Infer it
-- only from a dated, active, dirty stayover row for this hotel's own tenant.
-- A live API sync on the same date is more authoritative than an old XLS date.
CREATE OR REPLACE FUNCTION public.hc_memories_normalize_upload_stayover()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $fn$
DECLARE
 v_meta jsonb := coalesce(NEW.pms_metadata,'{}'::jsonb);
 v_today text := (now() AT TIME ZONE 'Europe/Budapest')::date::text;
 v_org text;
BEGIN
 IF NEW.hotel NOT IN ('memories-budapest','Hotel Memories Budapest') THEN RETURN NEW; END IF;
 SELECT o.slug INTO v_org FROM public.hotel_configurations h
 JOIN public.organizations o ON o.id=h.organization_id
 WHERE h.hotel_id='memories-budapest' AND h.is_active=true;
 IF v_org IS NULL OR NEW.organization_slug IS DISTINCT FROM v_org
    OR v_meta ->> 'pmsSyncDate' = v_today
    OR v_meta ->> 'pmsUploadDate' IS DISTINCT FROM v_today
    OR v_meta ->> 'lastPmsRefreshDate' IS DISTINCT FROM v_today
    OR NEW.is_checkout_room IS TRUE OR NEW.status IS DISTINCT FROM 'dirty'
    OR coalesce(v_meta ->> 'isNoShow','false') = 'true'
    OR coalesce(v_meta ->> 'isCancelled','false') = 'true'
    OR coalesce(v_meta ->> 'notArrived','false') = 'true'
    OR coalesce(v_meta ->> 'pmsUploadStatusNote','') = 'No Show'
    OR coalesce(v_meta ->> 'currentNight','') !~ '^[0-9]{1,2}$'
    OR coalesce(v_meta ->> 'totalNights','') !~ '^[0-9]{1,2}$'
 THEN RETURN NEW; END IF;
 IF (v_meta ->> 'currentNight')::integer NOT BETWEEN 1 AND (v_meta ->> 'totalNights')::integer
 THEN RETURN NEW; END IF;
 NEW.pms_metadata := jsonb_set(v_meta,'{occupiedToday}','true'::jsonb,true);
 RETURN NEW;
END;
$fn$;

-- Always protect actual completed-service timestamps from an XLS source.
-- The earlier service-cycle trigger has already decided the correct flags.
-- A dated manager override remains authoritative even if a legacy XLS
-- tries to write an outdated schedule, including an identical repeated XLS.
CREATE OR REPLACE FUNCTION public.hc_memories_guard_upload_completion()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $fn$
DECLARE
 v_today text := (now() AT TIME ZONE 'Europe/Budapest')::date::text;
 v_org text;
BEGIN
 IF NEW.hotel NOT IN ('memories-budapest','Hotel Memories Budapest') THEN RETURN NEW; END IF;
 SELECT o.slug INTO v_org FROM public.hotel_configurations h
 JOIN public.organizations o ON o.id=h.organization_id
 WHERE h.hotel_id='memories-budapest' AND h.is_active=true;
 IF v_org IS NULL OR NEW.organization_slug IS DISTINCT FROM v_org
    OR coalesce(NEW.pms_metadata ->> 'pmsUploadDate','') <> v_today
    OR coalesce(NEW.pms_metadata ->> 'lastPmsRefreshDate','') <> v_today
    OR coalesce(NEW.pms_metadata ->> 'memoriesPmsColumnPresent','false') <> 'true'
 THEN RETURN NEW; END IF;
 NEW.last_towel_change := OLD.last_towel_change;
 NEW.last_linen_change := OLD.last_linen_change;
 IF OLD.pms_metadata ->> 'memoriesServiceManualOverrideDate' = v_today THEN
   NEW.towel_change_required := OLD.towel_change_required;
   NEW.linen_change_required := OLD.linen_change_required;
 END IF;
 RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.hc_memories_remove_pms_column_marker()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $fn$
BEGIN
 IF coalesce(NEW.pms_metadata,'{}'::jsonb) ? 'memoriesPmsColumnPresent' THEN
   NEW.pms_metadata := NEW.pms_metadata - 'memoriesPmsColumnPresent';
 END IF;
 RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS zzzzzzzzzzzz_hc_memories_remove_pms_column_marker ON public.rooms;
CREATE TRIGGER zzzzzzzzzzzz_hc_memories_remove_pms_column_marker
BEFORE UPDATE OF pms_metadata ON public.rooms FOR EACH ROW
EXECUTE FUNCTION public.hc_memories_remove_pms_column_marker();
