-- Same migration already applied to production on 2026-10-09.
-- Retire all room-night inference warnings across all hotels/organizations.
-- Preserve reservation, checkout/stayover metadata and audit/service history.
DROP TRIGGER IF EXISTS zzz_hc_detect_stay_extension ON public.rooms;

UPDATE public.housekeeping_stay_extension_reviews
SET status = 'resolved',
    resolution_note = coalesce(
      nullif(btrim(resolution_note), ''),
      'System: retired speculative stay-extension review; no manager action required.'
    ),
    updated_at = now()
WHERE status <> 'resolved';
