import { describe, expect, it } from 'vitest';
import { isResolvableMaintenanceStatus, RESOLVABLE_MAINTENANCE_STATUSES } from './maintenanceLifecycle';

describe('maintenance resolution lifecycle', () => {
  it('allows only active workflow states to be resolved', () => {
    expect(RESOLVABLE_MAINTENANCE_STATUSES).toEqual(['open', 'pending', 'in_progress']);
    expect(isResolvableMaintenanceStatus('open')).toBe(true);
    expect(isResolvableMaintenanceStatus('pending')).toBe(true);
    expect(isResolvableMaintenanceStatus('in_progress')).toBe(true);
  });

  it.each(['resolved', 'closed', 'cancelled', '', null, undefined])(
    'rejects terminal or invalid state %s',
    (status) => {
      expect(isResolvableMaintenanceStatus(status)).toBe(false);
    },
  );
});
