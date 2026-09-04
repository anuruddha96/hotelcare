import { describe, expect, it } from 'vitest';
import {
  canReceiveHousekeepingOperationalNotifications,
  isExecutiveRole,
} from '../notificationAudience';

describe('notification audiences', () => {
  it('suppresses routine housekeeping workflow notifications for top management', () => {
    expect(canReceiveHousekeepingOperationalNotifications('top_management')).toBe(false);
    expect(canReceiveHousekeepingOperationalNotifications('top_management_manager')).toBe(false);
  });

  it('keeps housekeeping operational notifications for acting hotel managers', () => {
    expect(canReceiveHousekeepingOperationalNotifications('manager')).toBe(true);
    expect(canReceiveHousekeepingOperationalNotifications('housekeeping_manager')).toBe(true);
    expect(canReceiveHousekeepingOperationalNotifications('supervisor')).toBe(true);
  });

  it('does not route routine housekeeping workflow to other senior/non-housekeeping roles', () => {
    expect(canReceiveHousekeepingOperationalNotifications('admin')).toBe(false);
    expect(canReceiveHousekeepingOperationalNotifications('reception_manager')).toBe(false);
    expect(canReceiveHousekeepingOperationalNotifications('front_office')).toBe(false);
  });

  it('recognizes executive roles explicitly', () => {
    expect(isExecutiveRole('top_management')).toBe(true);
    expect(isExecutiveRole('top_management_manager')).toBe(true);
    expect(isExecutiveRole('manager')).toBe(false);
  });
});
