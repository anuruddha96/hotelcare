export const RESOLVABLE_MAINTENANCE_STATUSES = ['open', 'pending', 'in_progress'] as const;

export type ResolvableMaintenanceStatus = typeof RESOLVABLE_MAINTENANCE_STATUSES[number];

export function isResolvableMaintenanceStatus(status: string | null | undefined): status is ResolvableMaintenanceStatus {
  return typeof status === 'string' && RESOLVABLE_MAINTENANCE_STATUSES.includes(status as ResolvableMaintenanceStatus);
}
