import { describe, expect, it } from 'vitest';
import { GOZSDU_ROOM_OVERRIDE_KEY } from './gozsduRoomBucketOverride';
import { gozsduWorkPresentation } from './gozsduWorkPresentation';

const date = '2026-09-18';
const base = {
  assignment_type: 'checkout_cleaning',
  rooms: {
    hotel: 'gozsdu-court', is_checkout_room: true, towel_change_required: false,
    linen_change_required: false,
    pms_metadata: { pmsSyncDate: date, scheduledDepartureToday: true, departureDate: date },
  },
};
function task(bucket: string, service: string) {
  return {
    ...base,
    rooms: {
      ...base.rooms,
      pms_metadata: {
        ...base.rooms.pms_metadata,
        [GOZSDU_ROOM_OVERRIDE_KEY]: {
          [date]: { date, bucket, service, reason: 'Manager changed plan', changedBy: 'manager', changedAt: date },
        },
      },
    },
  };
}

describe('Gozsdu worker display', () => {
  it('shows a checkout moved to second-day towel service while preserving actual PMS data', () => {
    const original = task('service', 'towel_change');
    const presentation = gozsduWorkPresentation(original, date);
    expect(presentation.assignment_type).toBe('daily_cleaning');
    expect(presentation.rooms?.is_checkout_room).toBe(false);
    expect(presentation.rooms?.towel_change_required).toBe(true);
    expect(presentation.rooms?.pms_metadata.scheduledDepartureToday).toBe(false);
    expect(original.rooms.pms_metadata.scheduledDepartureToday).toBe(true);
    expect(original.rooms.pms_metadata.departureDate).toBe(date);
  });

  it('preserves full-clean instructions, and does not affect unrelated hotels', () => {
    const full = gozsduWorkPresentation(task('service', 'change_room'), date);
    expect(full.rooms?.linen_change_required).toBe(true);
    expect(full.rooms?.towel_change_required).toBe(false);
    const other = { ...base, rooms: { ...base.rooms, hotel: 'Hotel Ottofiori' } };
    expect(gozsduWorkPresentation(other, date)).toBe(other);
  });

  it('does not apply a manager override to a different business date', () => {
    const original = task('service', 'towel_change');
    expect(gozsduWorkPresentation(original, '2026-09-19')).toBe(original);
  });
});
