-- Preserve the proven Ottofiori resolver; prevent incidental metadata writes
-- (notes, housekeeping workflow, cleaning timestamps) from invoking it.
DROP TRIGGER IF EXISTS zzzzzzzzzz_hc_ottofiori_checkout_reconciliation ON public.rooms;
CREATE TRIGGER zzzzzzzzzz_hc_ottofiori_checkout_reconciliation
BEFORE UPDATE OF is_checkout_room,pms_metadata ON public.rooms
FOR EACH ROW
WHEN (
  OLD.is_checkout_room IS DISTINCT FROM NEW.is_checkout_room
  OR public.hc_ottofiori_bucket_evidence_changed(OLD.pms_metadata,NEW.pms_metadata)
)
EXECUTE FUNCTION public.hc_ottofiori_reconcile_checkout_on_pms_refresh();
