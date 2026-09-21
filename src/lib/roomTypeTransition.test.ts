import { describe, expect, it } from 'vitest';
import { buildRoomTypeTransition, upsertRoomTypeNote } from './roomTypeTransition';
import { GOZSDU_ROOM_OVERRIDE_KEY, readGozsduRoomOverride } from './gozsduRoomBucketOverride';

const input = {
  date: '2026-09-21', roomNumber: '144', actorId: 'manager-1', actorName: 'Manager',
  nowIso: '2026-09-21T12:00:00.000Z', previousRoomNotes: '[ROOM_CLEANING] Keep extra pillows',
};

describe('confirmed manual room type changes', () => {
  it('marks checkout-to-daily as a possible extension without touching the reservation', () => {
    const result = buildRoomTypeTransition({
      ...input, target: 'daily', metadata: {
        scheduledDepartureToday: true, checkedOutToday: true, departureTime: '10:00',
        reservationId: 'previo-booking-123', currentNight: 4,
      },
    });
    expect(result.metadata.manual_daily).toBe(true);
    expect(result.metadata.manual_checkout).toBe(false);
    expect(result.metadata.scheduledDepartureToday).toBe(false);
    expect(result.metadata.checkedOutToday).toBe(false);
    expect(result.metadata.reservationId).toBe('previo-booking-123');
    expect(result.note).toContain('Possible stay extension');
    expect(result.note).toContain('Keep extra pillows');
    expect(result.notice.from).toBe('checkout');
    expect(result.notice.to).toBe('daily');
  });

  it('marks daily-to-checkout and clears stale manual RTC without declaring PMS checkout', () => {
    const result = buildRoomTypeTransition({
      ...input, target: 'checkout', metadata: { manual_daily: true, manualReadyToCleanAt: 'stale-time' },
    });
    expect(result.metadata.manual_checkout).toBe(true);
    expect(result.metadata.manual_daily).toBe(false);
    expect(result.metadata.manualReadyToCleanAt).toBeNull();
    expect(result.metadata.scheduledDepartureToday).toBeUndefined();
    expect(result.note).toContain('wait for Ready to Clean');
  });

  it('replaces the same-day notice without deleting housekeeping instructions', () => {
    const first = upsertRoomTypeNote('Existing note', input.date, 'First change');
    const second = upsertRoomTypeNote(first, input.date, 'Second change');
    expect(second).toContain('Existing note');
    expect(second).toContain('Second change');
    expect(second).not.toContain('First change');
    expect(second.match(/\[ROOM TYPE 2026-09-21\]/g)).toHaveLength(1);
  });

  it('preserves Gozsdu historical overrides and its no-service day', () => {
    const result = buildRoomTypeTransition({
      ...input, target: 'daily', metadata: {
        [GOZSDU_ROOM_OVERRIDE_KEY]: {
          '2026-09-20': { date: '2026-09-20', bucket: 'checkout', service: 'none' },
        },
      },
      gozsduPlan: { bucket: 'other', service: 'none' },
    });
    expect(readGozsduRoomOverride(result.metadata, input.date)?.bucket).toBe('other');
    expect(readGozsduRoomOverride(result.metadata, '2026-09-20')?.bucket).toBe('checkout');
  });

  it('keeps Gozsdu towel versus full-textile service explicitly property scoped', () => {
    const result = buildRoomTypeTransition({
      ...input, target: 'daily', metadata: {}, gozsduPlan: { bucket: 'service', service: 'change_room' },
    });
    expect(readGozsduRoomOverride(result.metadata, input.date)?.service).toBe('change_room');
    const ordinary = buildRoomTypeTransition({ ...input, target: 'daily', metadata: {} });
    expect(ordinary.metadata[GOZSDU_ROOM_OVERRIDE_KEY]).toBeUndefined();
  });
});
