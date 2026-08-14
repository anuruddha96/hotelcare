DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.revenue_pickup_automation_actions
    WHERE schedule_slot IS NOT NULL
      AND local_business_date IS NOT NULL
    GROUP BY hotel_id, stay_date, obk_id, occupancy, rule_version, schedule_slot, local_business_date
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot create scheduled automation idempotency index: duplicate action keys exist';
  END IF;
END
$$;

DROP INDEX IF EXISTS public.revenue_automation_markdown_once_idx;

CREATE UNIQUE INDEX revenue_automation_scheduled_action_uidx
ON public.revenue_pickup_automation_actions (
  hotel_id,
  stay_date,
  obk_id,
  occupancy,
  rule_version,
  schedule_slot,
  local_business_date
)
WHERE schedule_slot IS NOT NULL
  AND local_business_date IS NOT NULL;