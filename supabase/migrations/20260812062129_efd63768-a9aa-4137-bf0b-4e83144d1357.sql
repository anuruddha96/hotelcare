ALTER TABLE public.revenue_pickup_automation_rules
ADD COLUMN IF NOT EXISTS application_scope text NOT NULL DEFAULT 'booked_room_type';

ALTER TABLE public.revenue_pickup_automation_rules
DROP CONSTRAINT IF EXISTS revenue_pickup_automation_rules_application_scope_check;

ALTER TABLE public.revenue_pickup_automation_rules
ADD CONSTRAINT revenue_pickup_automation_rules_application_scope_check
CHECK (application_scope IN ('booked_room_type', 'all_room_types'));

COMMENT ON COLUMN public.revenue_pickup_automation_rules.application_scope IS
'Controls whether a pickup reprices only its booked room type or all room types on the stay date.';