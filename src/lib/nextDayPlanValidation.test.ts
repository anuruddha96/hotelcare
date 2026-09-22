import { describe, expect, it } from 'vitest';
import { validateNextDayPlan } from './nextDayPlanValidation';
import type { RoomForAssignment } from './roomAssignmentAlgorithm';

const room = (id: string, isCheckout = false): RoomForAssignment => ({
  id, room_number: id, hotel: 'mika-downtown', floor_number: 1,
  room_size_sqm: 22, room_capacity: 2, status: 'dirty', is_checkout_room: isCheckout,
});
const first = room('101', true);
const second = room('102');
const valid = (other: Record<string, any> = {}) => validateNextDayPlan({
  organizationSlug: 'rdhotels', hotelKeys: ['mika-downtown', 'Hotel Mika Downtown'],
  selectedDate: '2026-09-23', expectedRooms: [first, second],
  previews: [{ staffId: 'cleaner', staffName: 'Cleaner', rooms: [first, second],
    totalWeight: 3, checkoutCount: 1, dailyCount: 1, estimatedMinutes: 60,
    totalWithBreak: 90, exceedsShift: false, overageMinutes: 0 }],
  selectedStaffIds: ['cleaner'],
  workers: [{ id: 'cleaner', assigned_hotel: 'mika-downtown', organization_slug: 'rdhotels' }],
  schedules: [], ...other,
});

const validPreview = { staffId: 'cleaner', staffName: 'Cleaner',
  totalWeight: 3, checkoutCount: 1, dailyCount: 1, estimatedMinutes: 60,
  totalWithBreak: 90, exceedsShift: false, overageMinutes: 0 };
const schedule = (shift_start: string | null, shift_end: string | null, status = 'published') => [{
  user_id: 'cleaner', status, work_date: '2026-09-23', shift_start, shift_end,
}];

describe('Next-day plan approval rejects invalid or cross-tenant data before writing', () => {
  it('accepts exact same-date inventory with a verified tenant-specific employee', () => {
    expect(valid()).toEqual({ valid: true, reason: '' });
  });
  it('rejects cross-organization workers', () => {
    expect(valid({ workers: [{ id: 'cleaner', assigned_hotel: 'mika-downtown', organization_slug: 'slnt' }] }).valid).toBe(false);
  });
  it('rejects a foreign property room', () => {
    expect(valid({ expectedRooms: [first, { ...second, hotel: 'slnt-group' }] }).valid).toBe(false);
  });
  it('rejects missing and duplicated rooms', () => {
    expect(valid({ previews: [{ ...validPreview, rooms: [first] }] }).valid).toBe(false);
    expect(valid({ previews: [{ ...validPreview, rooms: [first, first] }] }).valid).toBe(false);
  });
  it('rejects duplicate cleaner cards even if the rooms themselves are distinct', () => {
    expect(valid({ previews: [
      { ...validPreview, rooms: [first] }, { ...validPreview, rooms: [second] },
    ] }).reason).toMatch(/duplicate housekeeper/i);
  });
  it('rejects a checkout changed to daily after PMS refresh', () => {
    expect(valid({ expectedRooms: [{ ...first, is_checkout_room: false }, second] }).valid).toBe(false);
  });
  it('rejects an absent or unscheduled employee when the roster is configured', () => {
    expect(valid({ schedules: [{ user_id: 'cleaner', status: 'off', work_date: '2026-09-23' }] }).valid).toBe(false);
    expect(valid({ schedules: [{ user_id: 'other', status: 'published', work_date: '2026-09-23' }] }).valid).toBe(false);
    expect(valid({ schedules: schedule('08:00', '16:00', 'draft') }).valid).toBe(false);
  });
  it('rejects incomplete shift timestamps instead of assuming a full shift', () => {
    expect(valid({ schedules: schedule(null, '16:00') }).reason).toMatch(/incomplete shift/i);
    expect(valid({ schedules: schedule('08:00', 'unknown') }).valid).toBe(false);
  });
  it('recalculates authoritative room minutes before approval, including overnight shifts', () => {
    const staleOptimisticPreview = [{ ...validPreview, estimatedMinutes: 1,
      rooms: [first, second] }];
    expect(valid({ previews: staleOptimisticPreview, schedules: schedule('08:00', '09:00') }).reason)
      .toMatch(/exceeds the published shift/i);
    expect(valid({ previews: staleOptimisticPreview, schedules: schedule('08:00', '10:00') }).valid).toBe(true);
    expect(valid({ previews: staleOptimisticPreview, schedules: schedule('22:00', '00:00') }).valid).toBe(true);
  });
  it('honours explicit maintenance exclusions only', () => {
    expect(valid({ excludedRoomIds: ['102'], previews: [{ ...validPreview, rooms: [first] }] }).valid).toBe(true);
  });
});
