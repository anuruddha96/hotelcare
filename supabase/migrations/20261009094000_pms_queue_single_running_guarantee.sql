-- Defense in depth beyond the existing transactional advisory claim lock.
-- Prevent any two full PMS refresh queue rows from being running simultaneously.
CREATE UNIQUE INDEX IF NOT EXISTS pms_refresh_queue_single_running
 ON public.pms_refresh_queue ((true)) WHERE status='running';

-- Manager queue observer polls only the requesting user's current hotel.
CREATE INDEX IF NOT EXISTS pms_refresh_queue_own_status_lookup
 ON public.pms_refresh_queue (requested_by,hotel_id,requested_at DESC)
 WHERE request_kind='manual';

COMMENT ON INDEX public.pms_refresh_queue_single_running IS
 'At most one running full Previo refresh across RD Hotels and SLNT; protects even if the worker claim path regresses';
