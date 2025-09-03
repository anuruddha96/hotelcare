-- Fix tickets RLS policies to allow housekeeping_manager to create and manage tickets

-- 1) Drop existing ticket creation policy
DROP POLICY IF EXISTS "Secure ticket creation" ON public.tickets;

-- 2) Create updated ticket creation policy that includes housekeeping_manager
CREATE POLICY "Secure ticket creation"
ON public.tickets
FOR INSERT
WITH CHECK (
  (get_user_role(auth.uid()) = ANY (ARRAY[
    'housekeeping'::user_role, 
    'housekeeping_manager'::user_role,
    'reception'::user_role, 
    'maintenance'::user_role, 
    'manager'::user_role, 
    'admin'::user_role, 
    'marketing'::user_role, 
    'control_finance'::user_role, 
    'hr'::user_role, 
    'front_office'::user_role, 
    'top_management'::user_role
  ])) 
  AND (created_by = auth.uid()) 
  AND (
    (get_user_role(auth.uid()) = ANY (ARRAY['admin'::user_role, 'top_management'::user_role])) 
    OR (
      (( SELECT profiles.assigned_hotel FROM profiles WHERE (profiles.id = auth.uid())) = hotel) 
      OR (( SELECT profiles.assigned_hotel FROM profiles WHERE (profiles.id = auth.uid())) = get_hotel_name_from_id(hotel))
    )
  ) 
  AND has_ticket_creation_permission(auth.uid())
);

-- 3) Also update the ticket update policies to include housekeeping_manager
DROP POLICY IF EXISTS "Assigned users and managers can update tickets" ON public.tickets;

CREATE POLICY "Assigned users and managers can update tickets"
ON public.tickets
FOR UPDATE
USING (
  (assigned_to = auth.uid()) 
  OR (get_user_role(auth.uid()) = ANY (ARRAY[
    'manager'::user_role, 
    'housekeeping_manager'::user_role,
    'admin'::user_role
  ]))
);

-- 4) Update staff closure policy to include housekeeping_manager
DROP POLICY IF EXISTS "Staff can close assigned or created tickets" ON public.tickets;

CREATE POLICY "Staff can close assigned or created tickets"
ON public.tickets
FOR UPDATE
USING (
  (get_user_role(auth.uid()) = ANY (ARRAY[
    'maintenance'::user_role, 
    'housekeeping'::user_role, 
    'housekeeping_manager'::user_role,
    'reception'::user_role, 
    'marketing'::user_role, 
    'control_finance'::user_role, 
    'hr'::user_role, 
    'front_office'::user_role, 
    'top_management'::user_role
  ])) 
  AND ((assigned_to = auth.uid()) OR (created_by = auth.uid()))
)
WITH CHECK (
  (status = 'completed'::ticket_status) 
  AND (resolution_text IS NOT NULL) 
  AND (closed_by = auth.uid())
);