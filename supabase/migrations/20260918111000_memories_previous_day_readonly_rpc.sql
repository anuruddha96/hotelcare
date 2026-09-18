-- Existing snapshot RLS intentionally excludes housekeepers. This function
-- exposes only sanitized yesterday incident facts for the user's CURRENT
-- assignment, never arbitrary historical rows, other hotels or checkout
-- incidents to housekeeping. It does not write any historical data.
CREATE OR REPLACE FUNCTION public.memories_previous_day_service(p_assignment_id uuid)
RETURNS TABLE (
  source_assignment_id uuid,
  source_business_date date,
  incident_type text,
  towel_due boolean,
  linen_due boolean,
  incident_resolved_same_day boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  WITH authorized AS MATERIALIZED (
    SELECT a.room_id, a.assignment_date, r.hotel
    FROM public.room_assignments a
    JOIN public.rooms r ON r.id = a.room_id
    WHERE a.id = p_assignment_id
      AND a.assignment_date = (now() AT TIME ZONE 'Europe/Budapest')::date
      AND auth.uid() IS NOT NULL
      AND lower(btrim(coalesce(r.hotel, ''))) IN ('hotel memories budapest', 'memories')
      AND public.user_can_access_hotel(auth.uid(), r.hotel)
      AND (
        a.assigned_to = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()
            AND (coalesce(p.is_super_admin, false)
              OR p.role::text IN ('admin', 'manager', 'top_management',
                'top_management_manager', 'housekeeping_manager'))
        )
      )
      AND (
        NOT (coalesce(r.is_checkout_room, false)
          OR lower(coalesce(r.pms_metadata ->> 'scheduledDepartureToday', 'false')) = 'true'
          OR a.assignment_type::text = 'checkout_cleaning')
        OR EXISTS (
          SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()
            AND (coalesce(p.is_super_admin, false)
              OR p.role::text IN ('admin', 'manager', 'top_management',
                'top_management_manager', 'housekeeping_manager'))
        )
      )
  ),
  prior AS MATERIALIZED (
    SELECT s.room_id, s.business_date, s.towel_change_required,
           s.linen_change_required
    FROM public.housekeeping_room_snapshots s
    JOIN authorized a ON a.room_id = s.room_id
      AND s.business_date = a.assignment_date - 1
  ),
  dated AS MATERIALIZED (
    SELECT x.id, x.room_id, x.assignment_date, x.service_result,
      x.notes, x.dnd_attempt_count, x.completed_at, x.is_dnd, x.status
    FROM public.room_assignments x
    JOIN prior p ON p.room_id = x.room_id AND p.business_date = x.assignment_date
    WHERE x.assignment_type::text = 'daily_cleaning'
  ),
  evidence AS (
    SELECT d.id,
      count(photo.id) FILTER (WHERE photo.assignment_date = d.assignment_date) AS photo_count,
      max(photo.marked_at) FILTER (WHERE photo.assignment_date = d.assignment_date) AS last_photo
    FROM dated d LEFT JOIN public.dnd_photos photo ON photo.assignment_id = d.id
      AND photo.room_id = d.room_id
    GROUP BY d.id
  )
  SELECT d.id, d.assignment_date,
    CASE WHEN coalesce(e.photo_count, 0) > 0 OR coalesce(d.dnd_attempt_count, 0) > 0
      THEN 'dnd' ELSE 'no_service' END,
    coalesce(p.towel_change_required, false),
    coalesce(p.linen_change_required, false),
    EXISTS (
      SELECT 1 FROM dated later
      WHERE later.room_id = d.room_id AND later.status::text = 'completed'
        AND later.service_result = 'cleaned' AND NOT coalesce(later.is_dnd, false)
        AND later.completed_at IS NOT NULL
        AND later.completed_at >= coalesce(e.last_photo, d.completed_at, '-infinity'::timestamptz)
    )
  FROM dated d
  JOIN prior p ON p.room_id = d.room_id
  JOIN evidence e ON e.id = d.id
  WHERE coalesce(e.photo_count, 0) > 0
    OR coalesce(d.dnd_attempt_count, 0) > 0
    OR d.service_result = 'guest_declined'
    OR coalesce(d.notes, '') LIKE '%[NO_SERVICE]%';
$function$;
REVOKE ALL ON FUNCTION public.memories_previous_day_service(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.memories_previous_day_service(uuid) TO authenticated;
