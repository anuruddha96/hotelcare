-- Ensure department access config includes manager-specific roles
INSERT INTO public.department_access_config (role, department, access_scope, can_manage_all)
VALUES
  ('housekeeping_manager', 'housekeeping', 'hotel_only', false),
  ('housekeeping_manager', 'maintenance', 'hotel_only', false),
  ('maintenance_manager', 'maintenance', 'hotel_only', false),
  ('reception_manager', 'reception', 'hotel_only', false),
  ('front_office_manager', 'reception', 'hotel_only', false),
  ('marketing_manager', 'marketing', 'all_hotels', false)
ON CONFLICT (role, department) DO NOTHING;