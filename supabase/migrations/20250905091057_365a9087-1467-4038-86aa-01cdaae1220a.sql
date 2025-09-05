-- First, delete the incorrect room assignments for Svetlana (she's assigned to Hotel Ottofiori but has Hotel Memories Budapest rooms)
DELETE FROM room_assignments 
WHERE assigned_to = '1aaa01d2-49ca-4d84-8c04-9c6ab1a8be31' 
AND room_id IN (
  SELECT r.id FROM rooms r WHERE r.hotel = 'Hotel Memories Budapest'
);

-- Now create correct room assignments for Svetlana from Hotel Ottofiori
-- Using Anuruddha's ID as assigned_by since he's the admin
INSERT INTO room_assignments (room_id, assigned_to, assigned_by, assignment_type, assignment_date, status)
SELECT 
  r.id,
  '1aaa01d2-49ca-4d84-8c04-9c6ab1a8be31'::uuid,
  '42468517-d0ca-4bbb-a61d-b5943ea44e68'::uuid,
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