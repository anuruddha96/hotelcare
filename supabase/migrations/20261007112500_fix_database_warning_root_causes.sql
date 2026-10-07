-- Follow-up from the 7 Oct 2026 anomaly alerts.
--
-- 1) Daily room-assignment reads were scanning historical assignments under
--    several RLS policies, causing >1s average query time and statement
--    timeouts. Give the common assignment_date + tenant/property access path a
--    covering index.
-- 2) PostgREST's own per-request set_config bootstrap is intentionally very
--    frequent and extremely cheap. Raise the pure call-count alert threshold
--    so ordinary API traffic is not reported as a query loop; costly loops are
--    still covered by the execution-time and rollback monitors.

CREATE INDEX IF NOT EXISTS idx_room_assignments_date_org_room
ON public.room_assignments (assignment_date, organization_slug, room_id)
INCLUDE (id, assigned_to, assigned_by, status, assignment_type, created_at);

UPDATE public.system_anomaly_settings
SET query_calls_threshold_5m = GREATEST(query_calls_threshold_5m, 20000),
    updated_at = now()
WHERE singleton = true;

ANALYZE public.room_assignments;
