// Central role routing for operational notifications.
//
// Top-management users need executive visibility, but not room-by-room
// housekeeping workflow noise such as auto-release, room completion,
// assignments, or break-request updates. Keep those events with the hotel
// managers who act on them.

export const EXECUTIVE_ROLES = new Set([
  'top_management',
  'top_management_manager',
]);

export const HOUSEKEEPING_OPERATIONAL_MANAGER_ROLES = new Set([
  'manager',
  'housekeeping_manager',
  'supervisor',
]);

export function isExecutiveRole(role?: string | null): boolean {
  return !!role && EXECUTIVE_ROLES.has(role);
}

export function canReceiveHousekeepingOperationalNotifications(role?: string | null): boolean {
  return !!role && HOUSEKEEPING_OPERATIONAL_MANAGER_ROLES.has(role);
}
