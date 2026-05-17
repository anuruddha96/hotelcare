-- Restore ready_to_clean on live-hotel checkout assignments that were
-- silently wiped by migration 20260516184533. Scope: today, open
-- checkout assignments, rooms currently flagged as checkout, NOT the
-- previo-test hotel (which is API-driven).
UPDATE public.room_assignments ra
SET ready_to_clean = true,
    updated_at = now()
FROM public.rooms r
WHERE ra.room_id = r.id
  AND ra.assignment_type = 'checkout_cleaning'
  AND ra.assignment_date = CURRENT_DATE
  AND ra.status IN ('assigned', 'in_progress')
  AND ra.ready_to_clean = false
  AND COALESCE(r.is_checkout_room, false) = true
  AND r.hotel <> 'previo-test';