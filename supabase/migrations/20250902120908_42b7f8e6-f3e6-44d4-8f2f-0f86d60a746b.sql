-- Update the RLS policy to properly handle ticket creators
DROP POLICY IF EXISTS "Users can view tickets based on access config" ON public.tickets;

CREATE POLICY "Users can view tickets based on access config" 
ON public.tickets 
FOR SELECT 
USING (
  -- Always allow users to see tickets they created
  tickets.created_by = auth.uid()
  OR
  -- Always allow users to see tickets assigned to them
  tickets.assigned_to = auth.uid()
  OR
  -- Department-based access through configuration
  EXISTS (
    SELECT 1 
    FROM public.get_user_access_config(get_user_role(auth.uid())) config
    WHERE 
      -- Admin or top management sees all
      config.can_manage_all = true
      OR
      -- Department-specific access
      (
        config.department = 'all' 
        OR config.department = tickets.department
        OR (config.department = 'front_office' AND tickets.department = 'reception')
      )
      AND
      (
        -- All hotels access
        config.access_scope = 'all_hotels'
        OR
        -- Hotel-only access (check assigned hotel matches)
        (
          config.access_scope = 'hotel_only' 
          AND (
            SELECT assigned_hotel FROM public.profiles WHERE id = auth.uid()
          ) = tickets.hotel
        )
        OR
        -- Assigned and created access
        config.access_scope = 'assigned_and_created'
      )
  )
);