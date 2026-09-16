import { describe, expect, it } from 'vitest';
import { reconcileGozsduPmsRoster, verifyGozsduTomorrowCoverage } from './gozsduPmsRoster';

const rooms = [
  { id: 'depart', room_number: '2B-1/3/1', pms_metadata: { gozsduHousekeeping: { serviceType: 'towel_change' } } },
  { id: 'stay', room_number: '2B-1/T/2', pms_metadata: { gozsduHousekeeping: { serviceType: 'none' } } },
  { id: 'inactive', room_number: 'OFFICE' },
];
const registry = rooms.map(room => ({ room_id: room.id, pms_room_name: room.room_number, service_status: room.id === 'inactive' ? 'non_guest' : 'operating' }));
const captured_at = '2026-09-16T18:16:24.392Z';
const snapshots = [
  { room_label: '2B-1/3/1', room_number: null, arrival_date: '2026-09-13', departure_date: '2026-09-16', status: 'departing', housekeeping_dep: 'DEP', captured_at },
  { room_label: '2B-1/T/2', room_number: null, arrival_date: '2026-09-15', departure_date: '2026-09-19', status: 'ongoing', housekeeping_dep: null, captured_at },
  { room_label: 'OFFICE', room_number: null, arrival_date: '2026-09-15', departure_date: '2026-09-20', status: 'ongoing', housekeeping_dep: null, captured_at },
];

describe('Gozsdu selected-date PMS reconciliation', () => {
  it('overrides stale checkout/service flags and excludes inactive service', () => {
    const result = reconcileGozsduPmsRoster(rooms, registry, snapshots, '2026-09-16', Date.parse('2026-09-16T18:20:00Z'));
    expect(result.byRoom.get('depart')?.bucket).toBe('checkout');
    expect(result.byRoom.get('stay')?.bucket).toBe('service');
    expect(result.byRoom.get('stay')?.service).toBe('towel_change');
    expect(result.byRoom.get('inactive')?.service).toBe('none');
  });
  it('does not claim verified figures for missing, duplicate or stale rows', () => {
    const now = Date.parse('2026-09-16T18:20:00Z');
    expect(() => reconcileGozsduPmsRoster(rooms, registry, snapshots.slice(1), '2026-09-16', now)).toThrow(/incomplete/);
    expect(() => reconcileGozsduPmsRoster(rooms, registry, [snapshots[0], snapshots[0], snapshots[2]], '2026-09-16', now)).toThrow(/duplicated/);
    expect(() => reconcileGozsduPmsRoster(rooms, registry, snapshots, '2026-09-16', now + 7200000)).toThrow(/stale/);
  });
  it('allows only a missing yesterday departure in tomorrow source, not other missing rooms', () => {
    const today = snapshots.map(row => ({ room_label: row.room_label, departure_date: row.departure_date, captured_at }));
    expect(verifyGozsduTomorrowCoverage(registry.map(r => r.pms_room_name), today,
      snapshots.slice(1).map(row => ({ room_label: row.room_label, captured_at })), '2026-09-16')).toBe(true);
    expect(verifyGozsduTomorrowCoverage(registry.map(r => r.pms_room_name), today,
      [snapshots[0], snapshots[2]].map(row => ({ room_label: row.room_label, captured_at })), '2026-09-16')).toBe(false);
    expect(verifyGozsduTomorrowCoverage(registry.map(r => r.pms_room_name), today,
      [{ room_label: 'UNKNOWN', captured_at }], '2026-09-16')).toBe(false);
  });
});
