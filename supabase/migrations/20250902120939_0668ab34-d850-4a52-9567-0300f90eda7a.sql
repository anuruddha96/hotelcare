-- Create a function to map hotel IDs to hotel names for comparison
CREATE OR REPLACE FUNCTION public.get_hotel_name_from_id(hotel_id text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE 
    WHEN hotel_id = 'memories-budapest' THEN 'Hotel Memories Budapest'
    WHEN hotel_id = 'mika-downtown' THEN 'Hotel Mika Downtown'
    WHEN hotel_id = 'ottofiori' THEN 'Hotel Ottofiori'
    WHEN hotel_id = 'gozsdu-court' THEN 'Gozsdu Court Budapest'
    ELSE hotel_id
  END;
$$;

-- Update the RLS policy to handle hotel name mapping
DROP POLICY IF EXISTS "Users can view tickets based on access config" ON public.tickets;

CREATE POLICY "Users can view tickets based on access config" 
ON public.tickets 
FOR SELECT 
USING (
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
        -- Hotel-only access (check assigned hotel matches, considering ID vs name mapping)
        (
          config.access_scope = 'hotel_only' 
          AND (
            (SELECT assigned_hotel FROM public.profiles WHERE id = auth.uid()) = public.get_hotel_name_from_id(tickets.hotel)
            OR (SELECT assigned_hotel FROM public.profiles WHERE id = auth.uid()) = tickets.hotel
          )
        )
        OR
        -- Assigned and created access
        (
          config.access_scope = 'assigned_and_created'
          AND (
            tickets.assigned_to = auth.uid() 
            OR tickets.created_by = auth.uid()
            OR (
              (
                (SELECT assigned_hotel FROM public.profiles WHERE id = auth.uid()) = public.get_hotel_name_from_id(tickets.hotel)
                OR (SELECT assigned_hotel FROM public.profiles WHERE id = auth.uid()) = tickets.hotel
              )
              AND config.department = tickets.department
            )
          )
        )
      )
  )
);