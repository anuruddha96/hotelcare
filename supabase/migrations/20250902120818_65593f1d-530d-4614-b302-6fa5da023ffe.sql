-- Check current configuration for housekeeping_manager role
SELECT * FROM public.department_access_config WHERE role = 'housekeeping_manager';

-- Fix the configuration to ensure housekeeping_manager can see both departments
INSERT INTO public.department_access_config (role, department, access_scope, can_manage_all)
VALUES
  ('housekeeping_manager', 'housekeeping', 'hotel_only', false),
  ('housekeeping_manager', 'maintenance', 'hotel_only', false)
ON CONFLICT (role, department) DO NOTHING;