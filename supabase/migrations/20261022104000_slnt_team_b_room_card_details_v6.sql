-- SLNT Team B only: authenticated, detailed housekeeper-facing shared pool.
-- Preserve v4's tenant / membership / PTO / PMS-staleness guards by treating
-- that existing RPC as the authorized source of ALL visible room IDs.
-- This adds the details already used by RD Hotels' full room card.
CREATE OR REPLACE FUNCTION public.slnt_team_b_pool_v6(p_service_date date)
RETURNS TABLE (
  room_id uuid,
  room_number text,
  room_status text,
  room_name text,
  notes text,
  guest_count integer,
  is_checkout_room boolean,
  towel_change_required boolean,
  linen_change_required boolean,
  pms_metadata jsonb,
  assignment_id uuid,
  assigned_to uuid,
  assignment_status text,
  supervisor_approved boolean,
  is_optional boolean,
  floor_number integer,
  guest_nights_stayed integer,
  bed_configuration text,
  assignment_notes text,
  manager_instruction_text text,
  manager_instruction_updated_at timestamptz,
  planned_notes jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT p.room_id,p.room_number,p.room_status,p.room_name,p.notes,
    p.guest_count,p.is_checkout_room,p.towel_change_required,
    p.linen_change_required,p.pms_metadata,p.assignment_id,p.assigned_to,
    p.assignment_status,p.supervisor_approved,p.is_optional,
    r.floor_number,r.guest_nights_stayed,r.bed_configuration,
    a.notes,a.manager_instruction_text,a.manager_instruction_updated_at,
    COALESCE(planned.instructions,'[]'::jsonb)
  FROM public.slnt_team_b_pool_v4(p_service_date) p
  JOIN public.rooms r ON r.id=p.room_id
    AND r.organization_slug IN ('slnt','slnt-group')
  LEFT JOIN public.room_assignments a ON a.id=p.assignment_id
    AND a.room_id=p.room_id AND a.assignment_date=p_service_date
    AND a.organization_slug IN ('slnt','slnt-group')
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
      jsonb_build_object('content',n.content,'instruction_type',n.instruction_type)
      ORDER BY n.created_at
    ) AS instructions
    FROM public.room_planned_notes n
    WHERE n.room_id=p.room_id AND n.status='active'
      AND n.start_date<=p_service_date AND n.end_date>=p_service_date
      AND (cardinality(n.selected_dates)=0 OR n.selected_dates IS NULL
        OR p_service_date=ANY(n.selected_dates))
  ) planned ON TRUE
$$;
REVOKE ALL ON FUNCTION public.slnt_team_b_pool_v6(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.slnt_team_b_pool_v6(date) TO authenticated;
COMMENT ON FUNCTION public.slnt_team_b_pool_v6(date) IS
  'SLNT Team B shared housekeeping room preview with manager and Previo instructions, planned notes, bed setup, night/floor, and RTC state. Authorization and row scope delegated to v4. No minibar.';
