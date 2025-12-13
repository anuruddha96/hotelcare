-- Phase 1: Normalize hotel assignment values
-- Fix inconsistent hotel names (e.g., "ottofiori" -> "Hotel Ottofiori")
UPDATE profiles 
SET assigned_hotel = 'Hotel Ottofiori' 
WHERE LOWER(assigned_hotel) = 'ottofiori' 
  AND assigned_hotel != 'Hotel Ottofiori';

UPDATE profiles 
SET assigned_hotel = 'Hotel Memories Budapest' 
WHERE LOWER(REPLACE(assigned_hotel, '-', ' ')) LIKE '%memories%budapest%' 
  AND assigned_hotel != 'Hotel Memories Budapest';

UPDATE profiles 
SET assigned_hotel = 'Hotel Mika Downtown' 
WHERE LOWER(REPLACE(assigned_hotel, '-', ' ')) LIKE '%mika%downtown%' 
  AND assigned_hotel != 'Hotel Mika Downtown';

UPDATE profiles 
SET assigned_hotel = 'Gozsdu Court Budapest' 
WHERE LOWER(REPLACE(assigned_hotel, '-', ' ')) LIKE '%gozsdu%court%' 
  AND assigned_hotel != 'Gozsdu Court Budapest';

-- Phase 2: Update get_assignable_staff to filter by hotel and fix the role check
CREATE OR REPLACE FUNCTION get_assignable_staff(hotel_filter text DEFAULT NULL)
RETURNS TABLE(id uuid, full_name text, role text, email text, assigned_hotel text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
    -- Only return operational staff that can be assigned tickets
    p.role IN ('housekeeping', 'maintenance', 'reception') AND
    -- Filter by hotel if provided, or use requesting user's hotel, or return all if null
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

-- Phase 3: Create a helper function to normalize hotel names for comparison
CREATE OR REPLACE FUNCTION normalize_hotel_name(input_hotel text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  -- Return the canonical hotel name based on common variations
  IF input_hotel IS NULL THEN
    RETURN NULL;
  END IF;
  
  -- Check against hotel_configurations first
  RETURN (
    SELECT hc.hotel_name 
    FROM hotel_configurations hc 
    WHERE hc.hotel_id = input_hotel 
       OR hc.hotel_name = input_hotel
       OR hc.hotel_name ILIKE '%' || REPLACE(input_hotel, '-', ' ') || '%'
       OR input_hotel ILIKE '%' || REPLACE(hc.hotel_id, '-', ' ') || '%'
    LIMIT 1
  );
END;
$$;