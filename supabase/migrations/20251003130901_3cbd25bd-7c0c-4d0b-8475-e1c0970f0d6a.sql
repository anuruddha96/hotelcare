-- Phase 1: Multi-tenant Database Schema Enhancement
-- This migration adds organization support while maintaining backward compatibility
-- All existing Hotel Ottofiori data will default to 'rdhotels' organization

-- Step 1: Add organization_slug to profiles table
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS organization_slug TEXT DEFAULT 'rdhotels',
ADD COLUMN IF NOT EXISTS hotel_id TEXT;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_profiles_org_slug ON profiles(organization_slug);
CREATE INDEX IF NOT EXISTS idx_profiles_hotel_id ON profiles(hotel_id);

-- Step 2: Add organization_slug to all data tables
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS organization_slug TEXT DEFAULT 'rdhotels';
CREATE INDEX IF NOT EXISTS idx_rooms_org_slug ON rooms(organization_slug);

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS organization_slug TEXT DEFAULT 'rdhotels';
CREATE INDEX IF NOT EXISTS idx_tickets_org_slug ON tickets(organization_slug);

ALTER TABLE room_assignments ADD COLUMN IF NOT EXISTS organization_slug TEXT DEFAULT 'rdhotels';
CREATE INDEX IF NOT EXISTS idx_room_assignments_org_slug ON room_assignments(organization_slug);

ALTER TABLE staff_attendance ADD COLUMN IF NOT EXISTS organization_slug TEXT DEFAULT 'rdhotls';
CREATE INDEX IF NOT EXISTS idx_staff_attendance_org_slug ON staff_attendance(organization_slug);

ALTER TABLE housekeeping_performance ADD COLUMN IF NOT EXISTS organization_slug TEXT DEFAULT 'rdhotels';
CREATE INDEX IF NOT EXISTS idx_housekeeping_performance_org_slug ON housekeeping_performance(organization_slug);

ALTER TABLE break_requests ADD COLUMN IF NOT EXISTS organization_slug TEXT DEFAULT 'rdhotels';
CREATE INDEX IF NOT EXISTS idx_break_requests_org_slug ON break_requests(organization_slug);

ALTER TABLE dirty_linen_counts ADD COLUMN IF NOT EXISTS organization_slug TEXT DEFAULT 'rdhotels';
CREATE INDEX IF NOT EXISTS idx_dirty_linen_counts_org_slug ON dirty_linen_counts(organization_slug);

ALTER TABLE pms_upload_summary ADD COLUMN IF NOT EXISTS organization_slug TEXT DEFAULT 'rdhotels';
CREATE INDEX IF NOT EXISTS idx_pms_upload_summary_org_slug ON pms_upload_summary(organization_slug);

ALTER TABLE dnd_photos ADD COLUMN IF NOT EXISTS organization_slug TEXT DEFAULT 'rdhotels';
CREATE INDEX IF NOT EXISTS idx_dnd_photos_org_slug ON dnd_photos(organization_slug);

ALTER TABLE housekeeping_notes ADD COLUMN IF NOT EXISTS organization_slug TEXT DEFAULT 'rdhotels';
CREATE INDEX IF NOT EXISTS idx_housekeeping_notes_org_slug ON housekeeping_notes(organization_slug);

ALTER TABLE room_minibar_usage ADD COLUMN IF NOT EXISTS organization_slug TEXT DEFAULT 'rdhotels';
CREATE INDEX IF NOT EXISTS idx_room_minibar_usage_org_slug ON room_minibar_usage(organization_slug);

ALTER TABLE comments ADD COLUMN IF NOT EXISTS organization_slug TEXT DEFAULT 'rdhotels';
CREATE INDEX IF NOT EXISTS idx_comments_org_slug ON comments(organization_slug);

-- Step 3: Ensure organizations table has proper constraints
ALTER TABLE organizations 
ADD CONSTRAINT unique_organization_slug UNIQUE (slug);

-- Step 4: Add is_super_admin flag to profiles for cross-organization access
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN DEFAULT false;

-- Step 5: Create helper function to get user's organization
CREATE OR REPLACE FUNCTION public.get_user_organization_slug(user_id uuid)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_slug FROM public.profiles WHERE id = user_id;
$$;

-- Step 6: Create helper function to check if user is super admin
CREATE OR REPLACE FUNCTION public.is_super_admin(user_id uuid)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(is_super_admin, false) FROM public.profiles WHERE id = user_id;
$$;

-- Step 7: Update RLS policies for tenant isolation while maintaining existing access
-- Rooms table policies with organization isolation
DROP POLICY IF EXISTS "Secure room viewing" ON rooms;
CREATE POLICY "Secure room viewing" ON rooms
FOR SELECT USING (
  -- Super admins can see all organizations
  is_super_admin(auth.uid())
  OR
  -- Users can only see rooms in their organization
  (
    organization_slug = get_user_organization_slug(auth.uid())
    AND
    (
      -- Existing hotel-level access control
      (get_user_role(auth.uid()) = ANY(ARRAY['admin'::user_role, 'top_management'::user_role]))
      OR 
      ((SELECT assigned_hotel FROM profiles WHERE id = auth.uid()) = hotel)
      OR
      ((SELECT assigned_hotel FROM profiles WHERE id = auth.uid()) = get_hotel_name_from_id(hotel))
      OR
      (EXISTS (SELECT 1 FROM room_assignments WHERE room_id = rooms.id AND assigned_to = auth.uid()))
    )
  )
);

DROP POLICY IF EXISTS "Secure room updates" ON rooms;
CREATE POLICY "Secure room updates" ON rooms
FOR UPDATE USING (
  is_super_admin(auth.uid())
  OR
  (
    organization_slug = get_user_organization_slug(auth.uid())
    AND
    (
      (get_user_role(auth.uid()) = ANY(ARRAY['admin'::user_role, 'top_management'::user_role]))
      OR 
      ((SELECT assigned_hotel FROM profiles WHERE id = auth.uid()) = hotel)
    )
  )
) WITH CHECK (
  is_super_admin(auth.uid())
  OR
  (
    organization_slug = get_user_organization_slug(auth.uid())
    AND
    (
      (get_user_role(auth.uid()) = ANY(ARRAY['admin'::user_role, 'top_management'::user_role]))
      OR 
      ((SELECT assigned_hotel FROM profiles WHERE id = auth.uid()) = hotel)
    )
  )
);

DROP POLICY IF EXISTS "Admins can insert rooms" ON rooms;
CREATE POLICY "Admins can insert rooms" ON rooms
FOR INSERT WITH CHECK (
  is_super_admin(auth.uid())
  OR
  (
    organization_slug = get_user_organization_slug(auth.uid())
    AND
    get_user_role(auth.uid()) = 'admin'::user_role
  )
);

DROP POLICY IF EXISTS "Admins can delete rooms" ON rooms;
CREATE POLICY "Admins can delete rooms" ON rooms
FOR DELETE USING (
  is_super_admin(auth.uid())
  OR
  (
    organization_slug = get_user_organization_slug(auth.uid())
    AND
    get_user_role(auth.uid()) = 'admin'::user_role
  )
);

-- Tickets table policies with organization isolation
DROP POLICY IF EXISTS "Users can view tickets based on access config" ON tickets;
CREATE POLICY "Users can view tickets based on access config" ON tickets
FOR SELECT USING (
  is_super_admin(auth.uid())
  OR
  (
    organization_slug = get_user_organization_slug(auth.uid())
    AND
    EXISTS (
      SELECT 1
      FROM get_user_access_config(get_user_role(auth.uid())) config(department, access_scope, can_manage_all)
      WHERE (
        config.can_manage_all = true 
        OR (
          (config.department = 'all' OR config.department = tickets.department OR (config.department = 'front_office' AND tickets.department = 'reception'))
          AND (
            config.access_scope = 'all_hotels'
            OR (config.access_scope = 'hotel_only' AND ((SELECT assigned_hotel FROM profiles WHERE id = auth.uid()) = get_hotel_name_from_id(tickets.hotel) OR (SELECT assigned_hotel FROM profiles WHERE id = auth.uid()) = tickets.hotel))
            OR (config.access_scope = 'assigned_and_created' AND (tickets.assigned_to = auth.uid() OR tickets.created_by = auth.uid() OR (((SELECT assigned_hotel FROM profiles WHERE id = auth.uid()) = get_hotel_name_from_id(tickets.hotel) OR (SELECT assigned_hotel FROM profiles WHERE id = auth.uid()) = tickets.hotel) AND config.department = tickets.department)))
          )
        )
      )
    )
  )
);

DROP POLICY IF EXISTS "Secure ticket creation" ON tickets;
CREATE POLICY "Secure ticket creation" ON tickets
FOR INSERT WITH CHECK (
  is_super_admin(auth.uid())
  OR
  (
    organization_slug = get_user_organization_slug(auth.uid())
    AND
    (get_user_role(auth.uid()) = ANY(ARRAY['housekeeping'::user_role, 'housekeeping_manager'::user_role, 'reception'::user_role, 'maintenance'::user_role, 'manager'::user_role, 'admin'::user_role, 'marketing'::user_role, 'control_finance'::user_role, 'hr'::user_role, 'front_office'::user_role, 'top_management'::user_role]))
    AND (created_by = auth.uid())
    AND ((get_user_role(auth.uid()) = ANY(ARRAY['admin'::user_role, 'top_management'::user_role])) OR ((SELECT assigned_hotel FROM profiles WHERE id = auth.uid()) = hotel) OR ((SELECT assigned_hotel FROM profiles WHERE id = auth.uid()) = get_hotel_name_from_id(hotel)))
    AND has_ticket_creation_permission(auth.uid())
  )
);

-- Room assignments policies with organization isolation
DROP POLICY IF EXISTS "Housekeeping staff can view their assignments" ON room_assignments;
CREATE POLICY "Housekeeping staff can view their assignments" ON room_assignments
FOR SELECT USING (
  is_super_admin(auth.uid())
  OR
  (
    organization_slug = get_user_organization_slug(auth.uid())
    AND
    (
      (assigned_to = auth.uid()) 
      OR (get_user_role(auth.uid()) = ANY(ARRAY['housekeeping_manager'::user_role, 'manager'::user_role, 'admin'::user_role])) 
      OR (assigned_by = auth.uid())
    )
  )
);

DROP POLICY IF EXISTS "Managers and admins can create assignments" ON room_assignments;
CREATE POLICY "Managers and admins can create assignments" ON room_assignments
FOR INSERT WITH CHECK (
  is_super_admin(auth.uid())
  OR
  (
    organization_slug = get_user_organization_slug(auth.uid())
    AND
    (get_user_role(auth.uid()) = ANY(ARRAY['housekeeping_manager'::user_role, 'manager'::user_role, 'admin'::user_role])) 
    AND (assigned_by = auth.uid())
  )
);

-- Staff attendance policies with organization isolation
DROP POLICY IF EXISTS "Admin_HR_attendance_access" ON staff_attendance;
CREATE POLICY "Admin_HR_attendance_access" ON staff_attendance
FOR SELECT USING (
  is_super_admin(auth.uid())
  OR
  (
    organization_slug = get_user_organization_slug(auth.uid())
    AND
    (
      (user_id = auth.uid()) 
      OR (get_user_role(auth.uid()) = ANY(ARRAY['admin'::user_role, 'hr'::user_role, 'manager'::user_role, 'housekeeping_manager'::user_role, 'top_management'::user_role]))
    )
  )
);

DROP POLICY IF EXISTS "Users can insert their own attendance" ON staff_attendance;
CREATE POLICY "Users can insert their own attendance" ON staff_attendance
FOR INSERT WITH CHECK (
  organization_slug = get_user_organization_slug(auth.uid())
  AND user_id = auth.uid()
);

-- Comment: Similar updates needed for other tables, but keeping migration focused on critical tables
-- Additional table policies can be added in subsequent migrations if needed