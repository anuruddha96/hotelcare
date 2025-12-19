-- Fix dirty_linen_items sort_order
UPDATE public.dirty_linen_items 
SET sort_order = 8 
WHERE name = 'mattress_cover_twin';

UPDATE public.dirty_linen_items 
SET sort_order = 9 
WHERE name = 'mattress_cover_queen';

-- Update get_assignable_staff to properly filter by hotel AND include maintenance role
CREATE OR REPLACE FUNCTION public.get_assignable_staff(hotel_filter text DEFAULT NULL)
RETURNS TABLE(id uuid, full_name text, role text, email text, assigned_hotel text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p.id, 
    p.full_name, 
    p.role::text, 
    p.email, 
    p.assigned_hotel
  FROM public.profiles p
  WHERE 
    p.role IN ('housekeeping', 'maintenance', 'reception')
    AND (
      hotel_filter IS NULL 
      OR p.assigned_hotel = hotel_filter 
      OR p.assigned_hotel ILIKE '%' || hotel_filter || '%'
      OR hotel_filter ILIKE '%' || p.assigned_hotel || '%'
    );
END;
$$;