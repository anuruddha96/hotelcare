-- Add 'maintenance' to the user_role enum if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'maintenance' AND enumtypid = 'user_role'::regtype) THEN
    ALTER TYPE user_role ADD VALUE 'maintenance';
  END IF;
END $$;

-- Update the get_assignable_staff function to include maintenance role
CREATE OR REPLACE FUNCTION public.get_assignable_staff(hotel_filter text DEFAULT NULL)
RETURNS TABLE(id uuid, full_name text, role text, email text, assigned_hotel text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  requesting_user_role user_role;
  requesting_user_hotel text;
BEGIN
  -- Get the requesting user's role and hotel
  SELECT p.role, p.assigned_hotel INTO requesting_user_role, requesting_user_hotel
  FROM profiles p
  WHERE p.id = auth.uid();

  -- Only certain roles can query this function
  IF requesting_user_role NOT IN ('admin', 'manager', 'housekeeping_manager', 'reception', 'hr') THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT p.id, p.full_name, p.role::text, p.email, p.assigned_hotel
  FROM public.profiles p
  WHERE 
    -- Include maintenance, housekeeping, and reception staff
    p.role IN ('housekeeping', 'maintenance', 'reception') AND
    -- Filter by hotel if provided
    (
      hotel_filter IS NOT NULL AND (
        p.assigned_hotel = hotel_filter OR
        p.assigned_hotel ILIKE '%' || hotel_filter || '%' OR
        hotel_filter ILIKE '%' || p.assigned_hotel || '%'
      )
    ) OR (
      hotel_filter IS NULL AND requesting_user_hotel IS NOT NULL AND (
        p.assigned_hotel = requesting_user_hotel OR
        p.assigned_hotel ILIKE '%' || requesting_user_hotel || '%' OR
        requesting_user_hotel ILIKE '%' || p.assigned_hotel || '%'
      )
    ) OR (
      hotel_filter IS NULL AND requesting_user_hotel IS NULL AND 
      requesting_user_role IN ('admin', 'hr')
    )
  ORDER BY p.full_name;
END;
$$;