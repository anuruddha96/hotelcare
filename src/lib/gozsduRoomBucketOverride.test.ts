import { describe, expect, it } from 'vitest';
import { GOZSDU_ROOM_OVERRIDE_KEY, readGozsduRoomOverride } from './gozsduRoomBucketOverride';
import { reconcileGozsduPmsRoster } from './gozsduPmsRoster';

const date = '2026-09-18';
const now = Date.parse('2026-09-18T08:50:00Z');
const room = { id: 'room-411', room_number: 'internal-411', pms_metadata: {} as any };
const registry = [{ room_id: room.id, pms_room_name: '1BBALC-411', service_status: 'operating' }];
const snapshot = [{ room_label: '1BBALC-411', room_number: '411', arrival_date: '2026-09-16', departure_date: '2026-09-20', status: 'ongoing', housekeeping_dep: null, captured_at: '2026-09-18T08:45:00Z' }];

function withOverride(bucket: 'checkout' | 'service' | 'other', service: 'none' | 'towel_change' | 'change_room' = 'none', day = date) {
  return {
    ...room,
    pms_metadata: {
      [GOZSDU_ROOM_OVERRIDE_KEY]: {
        [day]: { date: day, bucket, service, reason: 'Missed yesterday', changedBy: 'manager', changedAt: '2026-09-18T08:46:00Z' },
      },
    },
  };
}

describe('Gozsdu manual housekeeping sections', () => {
  it('uses PMS room names for roster mapping despite a different internal room number', () => {
    const result = reconcileGozsduPmsRoster([room], registry, snapshot, date, now);
    expect(result.byRoom.get(room.id)?.bucket).toBe('service');
  });

  it('lets a manager move a service room into checkout without changing PMS stay dates', () => {
    const result = reconcileGozsduPmsRoster([withOverride('checkout')], registry, snapshot, date, now);
    expect(result.byRoom.get(room.id)).toMatchObject({ bucket: 'checkout', service: 'none', night: 3, totalNights: 4 });
  });

  it('moves an otherwise unscheduled room into second-day cleaning for a missed cleaning', () => {
    const otherSnapshot = [{ ...snapshot[0], arrival_date: '2026-09-17' }];
    const standard = reconcileGozsduPmsRoster([room], registry, otherSnapshot, date, now);
    expect(standard.byRoom.get(room.id)?.bucket).toBe('other');
    const result = reconcileGozsduPmsRoster([withOverride('service', 'change_room')], registry, otherSnapshot, date, now);
    expect(result.byRoom.get(room.id)).toMatchObject({ bucket: 'service', service: 'change_room' });
  });

  it('ignores yesterday’s override on today’s roster', () => {
    expect(readGozsduRoomOverride(withOverride('checkout', 'none', '2026-09-17').pms_metadata, date)).toBeNull();
    const result = reconcileGozsduPmsRoster([withOverride('checkout', 'none', '2026-09-17')], registry, snapshot, date, now);
    expect(result.byRoom.get(room.id)?.bucket).toBe('service');
  });

  it('does not override no-show or non-operating inventory', () => {
    const noShowRoom = { ...withOverride('checkout'), pms_metadata: { ...withOverride('checkout').pms_metadata, isNoShow: true } };
    const noShowSnapshot = [{ ...snapshot[0], status: 'no_show' }];
    expect(reconcileGozsduPmsRoster([noShowRoom], registry, noShowSnapshot, date, now).byRoom.get(room.id)?.bucket).toBe('noshow');
    const unavailable = [{ ...registry[0], service_status: 'unavailable' }];
    expect(reconcileGozsduPmsRoster([withOverride('checkout')], unavailable, snapshot, date, now).byRoom.get(room.id)?.bucket).toBe('service');
  });

  it('rejects incomplete PMS coverage rather than guessing an operational checkout', () => {
    expect(() => reconcileGozsduPmsRoster([withOverride('checkout')], registry, [], date, now)).toThrow('coverage is incomplete');
  });
});
