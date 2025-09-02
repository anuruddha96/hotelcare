-- Phase 1: Critical Security Fixes

-- 1. Create helper function to check if user can view a ticket
CREATE OR REPLACE FUNCTION public.user_can_view_ticket(ticket_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM tickets t 
    WHERE t.id = ticket_id 
    AND EXISTS (
      SELECT 1
      FROM get_user_access_config(get_user_role(auth.uid())) config(department, access_scope, can_manage_all)
      WHERE (
        config.can_manage_all = true 
        OR (
          (config.department = 'all' OR config.department = t.department OR (config.department = 'front_office' AND t.department = 'reception'))
          AND (
            config.access_scope = 'all_hotels'
            OR (config.access_scope = 'hotel_only' AND ((SELECT assigned_hotel FROM profiles WHERE id = auth.uid()) = get_hotel_name_from_id(t.hotel) OR (SELECT assigned_hotel FROM profiles WHERE id = auth.uid()) = t.hotel))
            OR (config.access_scope = 'assigned_and_created' AND (t.assigned_to = auth.uid() OR t.created_by = auth.uid() OR (((SELECT assigned_hotel FROM profiles WHERE id = auth.uid()) = get_hotel_name_from_id(t.hotel) OR (SELECT assigned_hotel FROM profiles WHERE id = auth.uid()) = t.hotel) AND config.department = t.department)))
          )
        )
      )
    )
  );
$$;

-- 2. Fix profile security - prevent role/hotel escalation
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile safely" 
ON public.profiles 
FOR UPDATE 
USING (auth.uid() = id)
WITH CHECK (
  auth.uid() = id 
  AND role = (SELECT role FROM public.profiles WHERE id = auth.uid()) 
  AND assigned_hotel = (SELECT assigned_hotel FROM public.profiles WHERE id = auth.uid())
);

-- 3. Fix comments visibility
DROP POLICY IF EXISTS "Users can view comments on tickets they can see" ON public.comments;
CREATE POLICY "Users can view comments on accessible tickets" 
ON public.comments 
FOR SELECT 
USING (public.user_can_view_ticket(ticket_id));

-- 4. Fix storage policies for ticket attachments
DROP POLICY IF EXISTS "Allow authenticated users to view ticket attachments" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated users to upload ticket attachments" ON storage.objects;
DROP POLICY IF EXISTS "Allow users to update their own attachments" ON storage.objects;
DROP POLICY IF EXISTS "Allow users to delete their own attachments" ON storage.objects;

-- Create secure storage policies
CREATE POLICY "Users can view ticket attachments they have access to" 
ON storage.objects 
FOR SELECT 
USING (
  bucket_id = 'ticket-attachments' 
  AND public.user_can_view_ticket(uuid((string_to_array(name, '/'))[1]))
);

CREATE POLICY "Users can upload ticket attachments for accessible tickets" 
ON storage.objects 
FOR INSERT 
WITH CHECK (
  bucket_id = 'ticket-attachments' 
  AND EXISTS (
    SELECT 1 FROM tickets t 
    WHERE t.id = uuid((string_to_array(name, '/'))[1]) 
    AND (
      t.created_by = auth.uid() 
      OR t.assigned_to = auth.uid() 
      OR get_user_role(auth.uid()) IN ('manager', 'admin')
    )
  )
);

CREATE POLICY "Managers can update ticket attachments" 
ON storage.objects 
FOR UPDATE 
USING (
  bucket_id = 'ticket-attachments' 
  AND get_user_role(auth.uid()) IN ('manager', 'admin')
);

CREATE POLICY "Managers can delete ticket attachments" 
ON storage.objects 
FOR DELETE 
USING (
  bucket_id = 'ticket-attachments' 
  AND get_user_role(auth.uid()) IN ('manager', 'admin')
);

-- 5. Tighten room access - remove null assigned_hotel bypass except for admins
DROP POLICY IF EXISTS "Users can view rooms for their assigned hotel or all if admin/t" ON public.rooms;
CREATE POLICY "Users can view rooms for their assigned hotel or all if admin" 
ON public.rooms 
FOR SELECT 
USING (
  get_user_role(auth.uid()) IN ('admin', 'top_management')
  OR (SELECT assigned_hotel FROM profiles WHERE id = auth.uid()) = hotel
);

DROP POLICY IF EXISTS "Staff can update room status for their assigned hotel" ON public.rooms;
CREATE POLICY "Staff can update room status for their assigned hotel" 
ON public.rooms 
FOR UPDATE 
USING (
  get_user_role(auth.uid()) IN ('admin', 'top_management')
  OR (SELECT assigned_hotel FROM profiles WHERE id = auth.uid()) = hotel
)
WITH CHECK (
  get_user_role(auth.uid()) IN ('admin', 'top_management')
  OR (SELECT assigned_hotel FROM profiles WHERE id = auth.uid()) = hotel
);

-- 6. Enforce ticket ownership on insert
DROP POLICY IF EXISTS "Staff can create tickets for their assigned hotel" ON public.tickets;
CREATE POLICY "Staff can create tickets for their assigned hotel" 
ON public.tickets 
FOR INSERT 
WITH CHECK (
  get_user_role(auth.uid()) IN ('housekeeping', 'reception', 'maintenance', 'manager', 'admin', 'marketing', 'control_finance', 'hr', 'front_office', 'top_management')
  AND created_by = auth.uid()
  AND (
    get_user_role(auth.uid()) IN ('admin', 'top_management')
    OR (SELECT assigned_hotel FROM profiles WHERE id = auth.uid()) = hotel
  )
);

-- 7. Add missing database triggers
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE TRIGGER set_ticket_number_trigger
  BEFORE INSERT ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.set_ticket_number();

CREATE TRIGGER set_sla_due_date_trigger
  BEFORE INSERT ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.set_sla_due_date();

CREATE TRIGGER update_tickets_updated_at
  BEFORE UPDATE ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER validate_ticket_closure_trigger
  BEFORE UPDATE ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.validate_ticket_closure();