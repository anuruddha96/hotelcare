-- First, delete the incorrect room assignments for Svetlana (she's assigned to Hotel Ottofiori but has Hotel Memories Budapest rooms)
DELETE FROM room_assignments 
WHERE assigned_to = '1aaa01d2-49ca-4d84-8c04-9c6ab1a8be31' 
AND room_id IN (
  SELECT r.id FROM rooms r WHERE r.hotel = 'Hotel Memories Budapest'
);

-- Now create correct room assignments for Svetlana from Hotel Ottofiori
INSERT INTO room_assignments (room_id, assigned_to, assignment_type, assignment_date, status)
SELECT 
  r.id,
  '1aaa01d2-49ca-4d84-8c04-9c6ab1a8be31'::uuid,
  'daily_cleaning',
  CURRENT_DATE,
  'assigned'
FROM rooms r 
WHERE r.hotel = 'Hotel Ottofiori' 
AND r.room_number IN ('101', '102', '103', '104')
AND NOT EXISTS (
  SELECT 1 FROM room_assignments ra 
  WHERE ra.room_id = r.id 
  AND ra.assignment_date = CURRENT_DATE
);

-- Update the room assignments RLS policy to ensure strict hotel matching
DROP POLICY IF EXISTS "Users can view their room assignments" ON room_assignments;

CREATE POLICY "Users can view their room assignments" ON room_assignments
FOR SELECT USING (
  assigned_to = auth.uid() 
  AND EXISTS (
    SELECT 1 FROM profiles p 
    JOIN rooms r ON r.id = room_assignments.room_id
    WHERE p.id = auth.uid() 
    AND (p.assigned_hotel = r.hotel OR p.assigned_hotel IS NULL)
  )
);

-- Also update rooms policy to ensure strict hotel filtering
DROP POLICY IF EXISTS "Allow housekeepers to view assigned rooms" ON rooms;

CREATE POLICY "Allow housekeepers to view assigned rooms" ON rooms
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM profiles p 
    WHERE p.id = auth.uid() 
    AND (
      -- Admins and managers can see all rooms
      p.role IN ('admin', 'manager', 'housekeeping_manager') 
      OR 
      -- Housekeepers can only see rooms from their assigned hotel
      (p.role = 'housekeeping' AND (p.assigned_hotel = hotel OR p.assigned_hotel IS NULL))
    )
  )
);

-- Fix the delete user function to handle foreign key constraints properly
CREATE OR REPLACE FUNCTION public.delete_user_profile_safe(p_user_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  result json;
BEGIN
  -- Only allow admins to delete users
  IF get_current_user_role() != 'admin' THEN
    RAISE EXCEPTION 'Only admins can delete users';
  END IF;
  
  -- First, update any foreign key references to avoid constraint violations
  UPDATE rooms SET last_cleaned_by = NULL WHERE last_cleaned_by = p_user_id;
  UPDATE tickets SET assigned_to = NULL WHERE assigned_to = p_user_id;
  UPDATE tickets SET created_by = NULL WHERE created_by = p_user_id;
  UPDATE tickets SET closed_by = NULL WHERE closed_by = p_user_id;
  
  -- Delete related records that depend on the profile
  DELETE FROM room_assignments WHERE assigned_to = p_user_id;
  DELETE FROM housekeeping_performance WHERE housekeeper_id = p_user_id;
  DELETE FROM ticket_creation_config WHERE user_id = p_user_id;
  
  -- Finally delete the profile
  DELETE FROM public.profiles WHERE id = p_user_id;
  
  -- Return success result
  result := json_build_object(
    'success', true,
    'message', 'User deleted successfully'
  );
  
  RETURN result;
EXCEPTION
  WHEN OTHERS THEN
    -- Return error result
    result := json_build_object(
      'success', false,
      'error', SQLERRM
    );
    RETURN result;
END;
$$;