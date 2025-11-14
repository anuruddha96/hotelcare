-- Drop existing restrictive policy for managers viewing hotel configurations
DROP POLICY IF EXISTS "Managers can view their hotel configuration" ON hotel_configurations;

-- Create new policy that allows managers to view configs by matching hotel_id OR hotel_name
CREATE POLICY "Managers can view their hotel configuration" 
ON hotel_configurations 
FOR SELECT 
USING (
  (get_user_role(auth.uid()) = ANY (ARRAY['manager'::user_role, 'housekeeping_manager'::user_role]))
  AND (
    hotel_id = (SELECT profiles.assigned_hotel FROM profiles WHERE profiles.id = auth.uid())
    OR hotel_name = (SELECT profiles.assigned_hotel FROM profiles WHERE profiles.id = auth.uid())
  )
);