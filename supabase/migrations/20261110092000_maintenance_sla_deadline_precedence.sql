-- The legacy generic tickets SLA trigger runs AFTER the maintenance-specific
-- trigger (Postgres orders same-kind triggers by name), silently replacing
-- configured maintenance SLAs (e.g. medium 48h) with legacy medium 72h.
-- Preserve the generic rule for other departments, but not maintenance.
DROP TRIGGER IF EXISTS set_sla_due_date_trigger ON public.tickets;
CREATE TRIGGER set_sla_due_date_trigger
BEFORE INSERT ON public.tickets
FOR EACH ROW
WHEN (NEW.department IS DISTINCT FROM 'maintenance')
EXECUTE FUNCTION public.set_sla_due_date();

-- Reconcile only currently active maintenance tickets that still have the
-- recognizable untouched legacy deadline. Never overwrite custom due dates,
-- closed-ticket history, or the immutable L0/L1/L2 delivery records.
-- Use the settings that were already present when each ticket was created.
WITH matching_settings AS (
  SELECT t.id,
         t.created_at + make_interval(hours => CASE t.priority::text
           WHEN 'urgent' THEN s.urgent_sla_hours
           WHEN 'high' THEN s.high_sla_hours
           WHEN 'medium' THEN s.medium_sla_hours
           WHEN 'low' THEN s.low_sla_hours
         END) AS correct_due_date,
         row_number() over (
           PARTITION BY t.id
           ORDER BY (lower(t.hotel) = lower(s.hotel)) DESC, s.created_at DESC
         ) AS rn
  FROM public.tickets t
  JOIN public.maintenance_escalation_settings s
    ON s.organization_slug = t.organization_slug
   AND (
     lower(s.hotel) = lower(t.hotel)
     OR EXISTS (
       SELECT 1 FROM public.hotel_configurations hc
       WHERE (lower(hc.hotel_id) = lower(s.hotel) OR lower(hc.hotel_name) = lower(s.hotel))
         AND (lower(hc.hotel_id) = lower(t.hotel) OR lower(hc.hotel_name) = lower(t.hotel))
     )
   )
  WHERE t.department = 'maintenance'
    AND t.status::text <> 'completed'
    AND t.created_at >= s.created_at
    AND abs(extract(epoch FROM (t.sla_due_date - t.created_at)) -
      CASE t.priority::text
        WHEN 'urgent' THEN 4 * 3600
        WHEN 'high' THEN 24 * 3600
        WHEN 'medium' THEN 72 * 3600
        WHEN 'low' THEN 168 * 3600
      END
    ) < 2
)
UPDATE public.tickets t
SET sla_due_date = m.correct_due_date
FROM matching_settings m
WHERE t.id = m.id
  AND m.rn = 1
  AND t.sla_due_date IS DISTINCT FROM m.correct_due_date;

-- Existing sent escalation events are deliberately not modified or resent.
-- Future L1/L2 notifications use the corrected ticket SLA due time.
