-- Fix the SECURITY DEFINER view warning by removing it and using RLS instead
DROP VIEW IF EXISTS public.staff_directory;

-- Create a secure view without SECURITY DEFINER property
CREATE VIEW public.staff_directory AS
SELECT 
  id,
  full_name,
  nickname,
  role,
  assigned_hotel,
  profile_picture_url,
  last_login,
  created_at,
  updated_at,
  -- Exclude email for non-HR/Admin users using a function
  CASE 
    WHEN get_user_role(auth.uid()) IN ('hr', 'admin') THEN email
    ELSE NULL
  END as email
FROM public.profiles;

-- Enable RLS on the view  
ALTER VIEW public.staff_directory ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for the view
CREATE POLICY "HR and Admins can view all staff directory" 
ON public.staff_directory 
FOR SELECT 
USING (get_user_role(auth.uid()) IN ('hr', 'admin'));

CREATE POLICY "Managers can view limited staff directory" 
ON public.staff_directory 
FOR SELECT 
USING (
  get_user_role(auth.uid()) = 'manager' 
  AND role IN ('housekeeping', 'maintenance', 'reception', 'front_office')
  AND (
    (SELECT assigned_hotel FROM public.profiles WHERE id = auth.uid()) = assigned_hotel
    OR (SELECT assigned_hotel FROM public.profiles WHERE id = auth.uid()) IS NULL
  )
);

CREATE POLICY "Users can view own staff directory entry" 
ON public.staff_directory 
FOR SELECT 
USING (auth.uid() = id);