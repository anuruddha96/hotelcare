-- Fix RLS policy on rooms table to allow managers to view rooms for their assigned hotel
-- Drop existing restrictive policies if they exist
DROP POLICY IF EXISTS "Managers can view rooms for their hotel" ON rooms;
DROP POLICY IF EXISTS "Users can view rooms for their organization" ON rooms;
DROP POLICY IF EXISTS "Users can view rooms based on role and assignment" ON rooms;

-- Create comprehensive policy for viewing rooms
-- Managers can see rooms for their assigned hotel (matching by hotel_id or hotel_name)
-- Housekeeping staff can see rooms for their organization
-- Admins can see all rooms in their organization
CREATE POLICY "Users can view rooms based on role and assignment" ON rooms
FOR SELECT
USING (
  -- Allow if user's organization matches the room's organization
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.organization_slug = rooms.organization_slug
    AND (
      -- Admins can see all rooms in their org
      profiles.role = 'admin'
      OR
      -- Managers can see rooms for their assigned hotel
      (
        profiles.role = 'manager'
        AND (
          -- Match by hotel_id or hotel_name
          rooms.hotel = profiles.assigned_hotel
          OR
          -- Also check hotel_configurations table for name/id mapping
          EXISTS (
            SELECT 1 FROM hotel_configurations hc
            WHERE profiles.assigned_hotel IN (hc.hotel_id, hc.hotel_name)
            AND rooms.hotel IN (hc.hotel_id, hc.hotel_name)
          )
        )
      )
      OR
      -- Housekeeping staff can see all rooms in their organization
      profiles.role = 'housekeeping'
    )
  )
);