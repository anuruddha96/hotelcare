-- Fix 1: Secure get_assignable_staff RPC function
DROP FUNCTION IF EXISTS public.get_assignable_staff(requesting_user_role user_role);

CREATE OR REPLACE FUNCTION public.get_assignable_staff()
RETURNS TABLE(id uuid, full_name text, role user_role, email text)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT p.id, p.full_name, p.role, p.email
  FROM public.profiles p
  WHERE 
    -- Only return operational staff that can be assigned tickets
    p.role IN ('housekeeping', 'maintenance', 'reception', 'front_office', 'marketing', 'control_finance') AND
    -- Only allow managers and admins to get this list
    get_user_role(auth.uid()) IN ('manager', 'admin');
$$;

-- Fix 2: Secure ticket UPDATE policies
DROP POLICY IF EXISTS "Assigned users and managers can update tickets" ON public.tickets;
DROP POLICY IF EXISTS "Staff can close assigned or created tickets" ON public.tickets;

-- Regular ticket updates (cannot close tickets)
CREATE POLICY "Users can update assigned tickets (no closure)" 
ON public.tickets 
FOR UPDATE 
USING (
  (assigned_to = auth.uid() OR created_by = auth.uid() OR get_user_role(auth.uid()) IN ('manager', 'admin')) AND
  status != 'completed'
)
WITH CHECK (
  status != 'completed' AND
  closed_at IS NULL AND
  closed_by IS NULL AND
  resolution_text IS NULL
);

-- Separate policy for closing tickets with validation
CREATE POLICY "Authorized users can close tickets with validation"
ON public.tickets
FOR UPDATE
USING (
  (assigned_to = auth.uid() OR created_by = auth.uid() OR get_user_role(auth.uid()) IN ('manager', 'admin')) AND
  get_user_role(auth.uid()) IN ('maintenance', 'housekeeping', 'reception', 'marketing', 'control_finance', 'hr', 'front_office', 'top_management', 'manager', 'admin')
)
WITH CHECK (
  status = 'completed' AND
  resolution_text IS NOT NULL AND
  length(trim(resolution_text)) > 0 AND
  closed_by = auth.uid() AND
  closed_at IS NOT NULL AND
  (sla_due_date IS NULL OR now() <= sla_due_date OR (sla_breach_reason IS NOT NULL AND length(trim(sla_breach_reason)) > 0))
);

-- Fix 3: Hide closed tickets by default
DROP POLICY IF EXISTS "Users can view tickets based on access config" ON public.tickets;

-- New policy that excludes completed tickets from default view
CREATE POLICY "Users can view non-closed tickets based on access config" 
ON public.tickets 
FOR SELECT 
USING (
  status != 'completed' AND
  EXISTS (
    SELECT 1
    FROM get_user_access_config(get_user_role(auth.uid())) config(department, access_scope, can_manage_all)
    WHERE (
      config.can_manage_all = true 
      OR (
        (config.department = 'all' OR config.department = tickets.department OR (config.department = 'front_office' AND tickets.department = 'reception'))
        AND (
          config.access_scope = 'all_hotels'
          OR (config.access_scope = 'hotel_only' AND ((SELECT assigned_hotel FROM profiles WHERE id = auth.uid()) = get_hotel_name_from_id(tickets.hotel) OR (SELECT assigned_hotel FROM profiles WHERE id = auth.uid()) = tickets.hotel))
          OR (config.access_scope = 'assigned_and_created' AND (tickets.assigned_to = auth.uid() OR tickets.created_by = auth.uid() OR (((SELECT assigned_hotel FROM profiles WHERE id = auth.uid()) = get_hotel_name_from_id(tickets.hotel) OR (SELECT assigned_hotel FROM profiles WHERE id = auth.uid()) = tickets.hotel) AND config.department = tickets.department)))
        )
      )
    )
  )
);

-- Function to search closed tickets securely
CREATE OR REPLACE FUNCTION public.search_closed_tickets(search_term text)
RETURNS TABLE(
  id uuid, 
  ticket_number text, 
  title text, 
  status ticket_status, 
  priority ticket_priority,
  room_number text,
  hotel text,
  created_at timestamp with time zone,
  closed_at timestamp with time zone,
  resolution_text text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT 
    t.id, 
    t.ticket_number, 
    t.title, 
    t.status, 
    t.priority,
    t.room_number,
    t.hotel,
    t.created_at,
    t.closed_at,
    t.resolution_text
  FROM tickets t
  WHERE 
    t.status = 'completed' AND
    (t.ticket_number = search_term OR t.room_number = search_term) AND
    user_can_view_ticket(t.id);
$$;

-- Fix 4: Secure storage policies for ticket-attachments
-- Drop existing permissive policies
DROP POLICY IF EXISTS "Authenticated users can upload ticket attachments" ON storage.objects;
DROP POLICY IF EXISTS "Users can update/delete their own ticket attachments" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can view ticket attachments" ON storage.objects;

-- Secure INSERT policy for ticket attachments
CREATE POLICY "Secure ticket attachment uploads"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'ticket-attachments' AND
  EXISTS (
    SELECT 1 FROM tickets t
    WHERE t.id::text = (storage.foldername(name))[1]
    AND (
      t.created_by = auth.uid() OR 
      t.assigned_to = auth.uid() OR 
      get_user_role(auth.uid()) IN ('manager', 'admin')
    )
  )
);

-- Secure SELECT policy for ticket attachments
CREATE POLICY "Secure ticket attachment viewing"
ON storage.objects
FOR SELECT
USING (
  bucket_id = 'ticket-attachments' AND
  user_can_view_ticket(((storage.foldername(name))[1])::uuid)
);

-- Secure UPDATE/DELETE policy for ticket attachments
CREATE POLICY "Secure ticket attachment management"
ON storage.objects
FOR UPDATE
USING (
  bucket_id = 'ticket-attachments' AND
  (
    get_user_role(auth.uid()) IN ('manager', 'admin') OR
    EXISTS (
      SELECT 1 FROM tickets t
      WHERE t.id::text = (storage.foldername(name))[1]
      AND (t.created_by = auth.uid() OR t.assigned_to = auth.uid())
    )
  )
);

CREATE POLICY "Secure ticket attachment deletion"
ON storage.objects
FOR DELETE
USING (
  bucket_id = 'ticket-attachments' AND
  (
    get_user_role(auth.uid()) IN ('manager', 'admin') OR
    EXISTS (
      SELECT 1 FROM tickets t
      WHERE t.id::text = (storage.foldername(name))[1]
      AND (t.created_by = auth.uid() OR t.assigned_to = auth.uid())
    )
  )
);

-- Fix 5: Prevent manager privilege escalation on profiles
DROP POLICY IF EXISTS "Managers can insert profiles" ON public.profiles;
DROP POLICY IF EXISTS "Managers can update all profiles" ON public.profiles;

-- Restricted manager profile creation
CREATE POLICY "Managers can insert non-privileged profiles"
ON public.profiles
FOR INSERT
WITH CHECK (
  get_user_role(auth.uid()) = 'manager' AND
  role IN ('housekeeping', 'maintenance', 'reception', 'front_office', 'marketing', 'control_finance') AND
  assigned_hotel = (SELECT assigned_hotel FROM profiles WHERE id = auth.uid())
);

-- Restricted manager profile updates
CREATE POLICY "Managers can update non-privileged profiles safely"
ON public.profiles
FOR UPDATE
USING (
  get_user_role(auth.uid()) = 'manager' AND
  role IN ('housekeeping', 'maintenance', 'reception', 'front_office', 'marketing', 'control_finance') AND
  assigned_hotel = (SELECT assigned_hotel FROM profiles WHERE id = auth.uid())
)
WITH CHECK (
  -- Prevent role escalation and hotel reassignment
  role = (SELECT p.role FROM profiles p WHERE p.id = profiles.id) AND
  assigned_hotel = (SELECT p.assigned_hotel FROM profiles p WHERE p.id = profiles.id)
);

-- Fix 6: Restrict minibar usage by hotel
DROP POLICY IF EXISTS "All authenticated users can view minibar usage" ON public.room_minibar_usage;
DROP POLICY IF EXISTS "All staff can record minibar usage" ON public.room_minibar_usage;
DROP POLICY IF EXISTS "All staff can update minibar usage" ON public.room_minibar_usage;

-- Hotel-restricted minibar viewing
CREATE POLICY "Users can view minibar usage for their hotel"
ON public.room_minibar_usage
FOR SELECT
USING (
  get_user_role(auth.uid()) IN ('admin', 'top_management') OR
  EXISTS (
    SELECT 1 FROM rooms r
    WHERE r.id = room_minibar_usage.room_id
    AND (
      (SELECT assigned_hotel FROM profiles WHERE id = auth.uid()) = r.hotel OR
      get_user_role(auth.uid()) IN ('manager', 'admin')
    )
  )
);

-- Hotel-restricted minibar recording
CREATE POLICY "Staff can record minibar usage for their hotel"
ON public.room_minibar_usage
FOR INSERT
WITH CHECK (
  get_user_role(auth.uid()) IN ('housekeeping', 'maintenance', 'reception', 'front_office', 'manager', 'admin') AND
  EXISTS (
    SELECT 1 FROM rooms r
    WHERE r.id = room_minibar_usage.room_id
    AND (
      (SELECT assigned_hotel FROM profiles WHERE id = auth.uid()) = r.hotel OR
      get_user_role(auth.uid()) IN ('manager', 'admin')
    )
  )
);

-- Hotel-restricted minibar updates
CREATE POLICY "Staff can update minibar usage for their hotel"
ON public.room_minibar_usage
FOR UPDATE
USING (
  get_user_role(auth.uid()) IN ('housekeeping', 'maintenance', 'reception', 'front_office', 'manager', 'admin') AND
  EXISTS (
    SELECT 1 FROM rooms r
    WHERE r.id = room_minibar_usage.room_id
    AND (
      (SELECT assigned_hotel FROM profiles WHERE id = auth.uid()) = r.hotel OR
      get_user_role(auth.uid()) IN ('manager', 'admin')
    )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM rooms r
    WHERE r.id = room_minibar_usage.room_id
    AND (
      (SELECT assigned_hotel FROM profiles WHERE id = auth.uid()) = r.hotel OR
      get_user_role(auth.uid()) IN ('manager', 'admin')
    )
  )
);