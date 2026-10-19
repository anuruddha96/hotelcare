import { describe, expect, it } from 'vitest';
import {
  isGozsduNoShow, isGozsduVerifiedUnsold, reconcileGozsduPmsRoster, type GozsduPmsRow,
} from './gozsduPmsRoster';

const date = '2026-10-19';
const tomorrow = '2026-10-20';
const captured_at = '2026-10-19T08:36:20Z';
const now = Date.parse('2026-10-19T08:40:00Z');
const metadata = (patch: Record<string, unknown> = {}) => ({
  pmsProvider: 'previo', pmsSyncDate: date, lastServerMorningSyncAt: captured_at,
  roomId: '1856755', arrivalToday: false, checkedOutToday: false,
  scheduledDepartureToday: false, isNoShow: false, occupiedToday: true,
  reservationStatusId: 3, ...patch,
});
const snap = (room_label: string, arrival_date: string, departure_date: string): GozsduPmsRow => ({
  business_date: date, room_label, room_number: room_label, arrival_date, departure_date,
  status: departure_date === date ? 'departing' : 'ongoing',
  housekeeping_dep: departure_date === date ? 'DEP' : null, captured_at,
});

describe('Gozsdu dated arrival, vacancy and no-show journey (October 19)', () => {
  it('never converts actual checked-in room 2B-1/3/1 into inferred no-show', () => {
    const room = { id: 'b', room_number: '2B-1/3/1',
      pms_metadata: metadata({ isNoShow: true, noShowSource: 'inferred_never_checked_in',
        reservationStatusId: 3, occupiedToday: true, scheduledDepartureToday: true }) };
    expect(isGozsduNoShow(room, date)).toBe(false);
    const roster = reconcileGozsduPmsRoster([room],
      [{ room_id: 'b', pms_room_name: room.room_number, service_status: 'operating' }],
      [snap(room.room_number, '2026-10-18', date)], date, now);
    expect(roster.byRoom.get('b')?.bucket).toBe('checkout');
  });

  it('recognizes a real status-8 no-show, never an unsold room', () => {
    const room = { id: 'noshow', room_number: 'no', pms_metadata: metadata({
      isNoShow: true, noShowSource: 'previo_status_8', reservationStatusId: 8,
      occupiedToday: false,
    }) };
    expect(isGozsduNoShow(room, date)).toBe(true);
    expect(isGozsduNoShow({ ...room, pms_metadata: {
      ...room.pms_metadata, reservationStatusId: 3, occupiedToday: true,
    } }, date)).toBe(false);
  });

  it('reconciles 82 registered rooms: next-night 3002 arrival, 410 arrival and 411 vacancy', () => {
    const stayRooms = Array.from({ length: 78 }, (_, i) => ({
      id: `st-${i}`, room_number: `ST-${i + 100}`,
      pms_metadata: metadata(),
    }));
    const departing = {
      id: 'b', room_number: '2B-1/3/1',
      pms_metadata: metadata({ isNoShow: true, noShowSource: 'inferred_never_checked_in',
        reservationStatusId: 3, scheduledDepartureToday: true }),
    };
    const incomingRoom = { id: 'a', room_number: '3002',
      pms_metadata: metadata({ reservationId: 'old-outgoing', reservationStatusId: 9,
        isNoShow: false, checkedOutToday: true, scheduledDepartureToday: true }) };
    const arrivalRoom = { id: 'arr', room_number: '410',
      pms_metadata: metadata({ arrivalToday: true, reservationStatusId: 2,
        occupiedToday: false, reservationId: 'arriving' }) };
    const vacantRoom = { id: 'vac', room_number: '411',
      pms_metadata: metadata({ pmsOccupancyStatus: 'unsold',
        pmsVacancyEvidence: 'current_previo_reservation_snapshot_and_physical_room_roster',
        pmsVacancyVerifiedAt: captured_at, roomId: '2146991',
        reservationId: null, occupiedToday: false, scheduledDepartureToday: false }) };
    const rooms = [...stayRooms, departing, incomingRoom, arrivalRoom, vacantRoom];
    expect(rooms).toHaveLength(82);
    const registry = rooms.map(room => ({ room_id: room.id,
      pms_room_name: room.id === 'a' ? '1BBALC-3002' :
        room.id === 'arr' ? '1BBALC-410' :
        room.id === 'vac' ? '1BBALC-411' : room.room_number,
      service_status: 'operating',
    }));
    const current = [
      ...stayRooms.map(room => snap(room.room_number, '2026-10-17', '2026-10-22')),
      snap('2B-1/3/1', '2026-10-18', date),
    ];
    const upcoming = [{ ...snap('1BBALC-3002', date, '2026-10-21'),
      business_date: tomorrow, status: 'ongoing', housekeeping_dep: null }];
    const result = reconcileGozsduPmsRoster(rooms, registry, current, date, now, upcoming);
    expect(result.byRoom).toHaveProperty('size', 82);
    expect(result.byRoom.get('a')).toMatchObject({
      bucket: 'arrival', incomingToday: true, evidence: 'next_day_arrival', totalNights: 2,
    });
    expect(result.byRoom.get('arr')?.bucket).toBe('arrival');
    expect(result.byRoom.get('vac')?.bucket).toBe('vacant');
    expect(result.byRoom.get('b')?.bucket).toBe('checkout');
    expect(isGozsduVerifiedUnsold(vacantRoom, date, now)).toBe(true);
  });

  it('preserves same-day turnover departure work while exposing next arrival', () => {
    const room = { id: 'c', room_number: '1BBALC-5002', pms_metadata: metadata() };
    const today = [snap(room.room_number, '2026-10-18', date)];
    const next = [{ ...snap(room.room_number, date, '2026-10-21'),
      business_date: tomorrow, status: 'ongoing', housekeeping_dep: null }];
    const res = reconcileGozsduPmsRoster([room],
      [{ room_id: room.id, pms_room_name: room.room_number, service_status: 'operating' }],
      today, date, now, next);
    expect(res.byRoom.get('c')).toMatchObject({ bucket: 'checkout', incomingToday: true });
  });

  it('fails closed on missing evidence, stale next-day feeds and incorrect physical identity', () => {
    const room = { id: 'a', room_number: '3002', pms_metadata: metadata({
      reservationStatusId: 9, pmsSyncDate: date, scheduledDepartureToday: false,
      checkedOutToday: false,
    }) };
    const registry = [{ room_id: 'a', pms_room_name: '1BBALC-3002', service_status: 'operating' }];
    const future = [{ ...snap('1BBALC-3002', date, '2026-10-21'),
      business_date: tomorrow, captured_at: '2026-10-19T04:00:00Z' }];
    expect(() => reconcileGozsduPmsRoster([room], registry, [], date, now, future)).toThrow(/incomplete/);
    expect(() => reconcileGozsduPmsRoster([room], registry, [], date, now,
      [{ ...future[0], room_label: 'OTHER', captured_at }])).toThrow(/incomplete/);
  });
});
