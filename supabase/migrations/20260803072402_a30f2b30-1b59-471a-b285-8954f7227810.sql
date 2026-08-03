-- Clear stale ready-to-clean releases carried over from previous days.
UPDATE public.room_assignments a
SET ready_to_clean = false, updated_at = now()
FROM public.rooms r
WHERE a.room_id = r.id
  AND a.assignment_date = CURRENT_DATE
  AND a.assignment_type = 'checkout_cleaning'
  AND a.status = 'assigned'
  AND a.ready_to_clean = true
  AND COALESCE((r.pms_metadata->>'checkedOutToday')::boolean, false) = false
  AND COALESCE(left(r.pms_metadata->>'readyToCleanDate', 10), left(r.pms_metadata->>'checkedOutAt', 10)) IS DISTINCT FROM to_char(CURRENT_DATE, 'YYYY-MM-DD')
  AND COALESCE(left(r.pms_metadata->>'manualReadyToCleanAt', 10), '') IS DISTINCT FROM to_char(CURRENT_DATE, 'YYYY-MM-DD');

-- Drop sticky departure markers that belong to an earlier day.
UPDATE public.rooms
SET pms_metadata = (pms_metadata - 'readyToClean' - 'checkedOutAt' - 'readyToCleanDate'),
    updated_at = now()
WHERE pms_metadata ? 'readyToClean'
  AND COALESCE((pms_metadata->>'checkedOutToday')::boolean, false) = false
  AND COALESCE(left(pms_metadata->>'checkedOutAt', 10), '') IS DISTINCT FROM to_char(CURRENT_DATE, 'YYYY-MM-DD');