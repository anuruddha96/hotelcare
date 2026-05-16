UPDATE public.room_assignments ra
SET ready_to_clean = true, updated_at = now()
FROM public.rooms r
WHERE ra.room_id = r.id
  AND ra.assignment_date = CURRENT_DATE
  AND ra.assignment_type = 'checkout_cleaning'
  AND ra.status IN ('assigned','in_progress')
  AND ra.ready_to_clean = false
  AND r.status = 'dirty';