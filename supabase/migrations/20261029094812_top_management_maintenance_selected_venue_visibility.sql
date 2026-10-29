-- Top Management can switch between hotels in the same organization.
-- The selected hotel is kept per browser tab, while the database profile's
-- assigned_hotel is a single shared value. RLS must not use that mutable
-- default to deny maintenance tickets for the hotel shown in this tab.
--
-- Give this executive role organization-wide *maintenance* read scope only.
-- Existing tickets SELECT RLS and user_can_view_ticket() both enforce
-- organization_slug = the authenticated user's organization. Neither ticket
-- UPDATE/INSERT policies nor other departments are widened by this change.
INSERT INTO public.department_access_config
  (role, department, access_scope, can_manage_all)
VALUES
  ('top_management_manager'::public.user_role, 'maintenance', 'all_hotels', false)
ON CONFLICT (role, department) DO UPDATE
SET access_scope = EXCLUDED.access_scope
WHERE public.department_access_config.access_scope IS DISTINCT FROM EXCLUDED.access_scope;
