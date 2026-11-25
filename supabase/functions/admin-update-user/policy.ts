export const topRoles = ['top_management', 'top_management_manager'];
export const validRoles = ['housekeeping', 'reception', 'maintenance', 'manager', 'admin', 'marketing', 'control_finance', 'hr', 'front_office', 'top_management', 'housekeeping_manager', 'maintenance_manager', 'marketing_manager', 'reception_manager', 'back_office', 'back_office_manager', 'control_manager', 'finance_manager', 'top_management_manager', 'breakfast_staff', 'supervisor'];
type Scope = { role: string; organization_slug: string | null; is_super_admin?: boolean | null; deleted_at?: string | null };
export function canEditTarget(caller: Scope, target: Scope): boolean {
  if (caller.deleted_at || target.deleted_at) return false;
  if (caller.is_super_admin) return true;
  if (!['admin', ...topRoles, 'manager', 'housekeeping_manager'].includes(caller.role)) return false;
  if (!caller.organization_slug || caller.organization_slug !== target.organization_slug || target.is_super_admin || target.role === 'admin') return false;
  return caller.role === 'admin' || !topRoles.includes(target.role);
}
export function canAssignRole(caller: Scope, role: string): boolean {
  if (!validRoles.includes(role) || caller.deleted_at) return false;
  if (caller.is_super_admin) return true;
  if (caller.role === 'admin') return role !== 'admin';
  return topRoles.includes(caller.role) && role !== 'admin' && !topRoles.includes(role);
}
export function canChangeStaffAccess(caller: Scope): boolean {
  return !caller.deleted_at && (!!caller.is_super_admin || ['admin', ...topRoles].includes(caller.role));
}
