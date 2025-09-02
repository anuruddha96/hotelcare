-- Update RLS policies to respect hotel assignments

-- Drop existing policies for tickets that need to be updated
DROP POLICY IF EXISTS "All authenticated users can view tickets" ON public.tickets;
DROP POLICY IF EXISTS "All staff can create tickets" ON public.tickets;

-- Drop existing policies for rooms that need to be updated  
DROP POLICY IF EXISTS "All authenticated users can view rooms" ON public.rooms;

-- Create new hotel-aware policies for tickets
CREATE POLICY "Users can view tickets for their assigned hotel or all if admin/top_management"
ON public.tickets
FOR SELECT
TO authenticated
USING (
  -- Admins and top management can see all tickets
  get_user_role(auth.uid()) IN ('admin', 'top_management') OR
  -- Other users can only see tickets for their assigned hotel
  (
    SELECT assigned_hotel FROM public.profiles WHERE id = auth.uid()
  ) = hotel OR
  -- If no assigned hotel, see all (for backwards compatibility)
  (
    SELECT assigned_hotel FROM public.profiles WHERE id = auth.uid()
  ) IS NULL
);

CREATE POLICY "Staff can create tickets for their assigned hotel"
ON public.tickets
FOR INSERT
TO authenticated
WITH CHECK (
  get_user_role(auth.uid()) = ANY (ARRAY['housekeeping'::user_role, 'reception'::user_role, 'maintenance'::user_role, 'manager'::user_role, 'admin'::user_role, 'marketing'::user_role, 'control_finance'::user_role, 'hr'::user_role, 'front_office'::user_role, 'top_management'::user_role]) AND
  (
    -- Admins and top management can create tickets for any hotel
    get_user_role(auth.uid()) IN ('admin', 'top_management') OR
    -- Other users can only create tickets for their assigned hotel
    (
      SELECT assigned_hotel FROM public.profiles WHERE id = auth.uid()
    ) = hotel OR
    -- If no assigned hotel, can create for any (for backwards compatibility)
    (
      SELECT assigned_hotel FROM public.profiles WHERE id = auth.uid()
    ) IS NULL
  )
);

-- Create new hotel-aware policies for rooms
CREATE POLICY "Users can view rooms for their assigned hotel or all if admin/top_management"
ON public.rooms
FOR SELECT  
TO authenticated
USING (
  -- Admins and top management can see all rooms
  get_user_role(auth.uid()) IN ('admin', 'top_management') OR
  -- Other users can only see rooms for their assigned hotel
  (
    SELECT assigned_hotel FROM public.profiles WHERE id = auth.uid()
  ) = hotel OR
  -- If no assigned hotel, see all (for backwards compatibility)
  (
    SELECT assigned_hotel FROM public.profiles WHERE id = auth.uid()
  ) IS NULL
);

-- Update room status policy to respect hotel assignments
DROP POLICY IF EXISTS "All staff can update room status" ON public.rooms;
CREATE POLICY "Staff can update room status for their assigned hotel"
ON public.rooms
FOR UPDATE
TO authenticated
USING (
  -- Admins and top management can update any room
  get_user_role(auth.uid()) IN ('admin', 'top_management') OR
  -- Other users can only update rooms for their assigned hotel
  (
    SELECT assigned_hotel FROM public.profiles WHERE id = auth.uid()
  ) = hotel OR
  -- If no assigned hotel, can update any (for backwards compatibility)
  (
    SELECT assigned_hotel FROM public.profiles WHERE id = auth.uid()
  ) IS NULL
)
WITH CHECK (
  -- Same logic for WITH CHECK
  get_user_role(auth.uid()) IN ('admin', 'top_management') OR
  (
    SELECT assigned_hotel FROM public.profiles WHERE id = auth.uid()
  ) = hotel OR
  (
    SELECT assigned_hotel FROM public.profiles WHERE id = auth.uid()
  ) IS NULL
);