import { describe, expect, it } from 'vitest';
import {
  filterRoomsToMappedTeam,
  filterSnapshotRowsToMappedRooms,
  summarizeTeamWorkload,
} from './slntTeamHousekeepingScope';

describe('SLNT Team B housekeeping scope', () => {
  it('returns only explicitly mapped Team B rooms', () => {
    const rooms = [
      { id: 'team-b-1', room_number: 'Be Local' },
      { id: 'team-a-1', room_number: 'Castle Garden' },
      { id: 'team-b-2', room_number: 'K4 – Room 1' },
    ];

    expect(filterRoomsToMappedTeam(rooms, ['team-b-1', 'team-b-2'])).toEqual([
      rooms[0], rooms[2],
    ]);
  });

  it('fails closed when the Team B mapping is missing', () => {
    expect(filterRoomsToMappedTeam([{ id: 'room-1' }], [])).toEqual([]);
  });

  it('drops Team A rows from a portfolio-wide Previo snapshot', () => {
    const base = {
      arrival_date: '2026-09-29', departure_date: '2026-10-01', status: 'departing',
      housekeeping_dep: 'DEP', housekeeping_stay: null, captured_at: '2026-09-30T18:00:00Z',
    };
    const rows = [
      { ...base, room_number: 'K4 – Room 1', room_label: 'K4 – Room 1' },
      { ...base, room_number: 'Castle Garden Residence', room_label: 'Castle Garden Residence' },
    ];

    expect(filterSnapshotRowsToMappedRooms(rows, [{ room_number: 'K4 – Room 1' }])).toEqual([rows[0]]);
  });

  it('separates confirmed checkout, daily and unbooked rooms', () => {
    const summary = summarizeTeamWorkload([
      { id: 'checkout', is_checkout_room: true, pms_metadata: { potentialCheckout: false } },
      { id: 'daily', is_checkout_room: false, pms_metadata: {} },
      { id: 'unsold', is_checkout_room: true, pms_metadata: { planningStatus: 'unsold_now', unsoldAtPlanning: true } },
    ]);

    expect(summary).toEqual({ confirmedCheckoutCount: 1, dailyCount: 1, unsoldCount: 1, totalCount: 3 });
  });

  it('keeps a 46-room Team B workload exhaustive without inflating checkout', () => {
    const rooms = [
      ...Array.from({ length: 16 }, (_, i) => ({ id: `checkout-${i}`, is_checkout_room: true, pms_metadata: {} })),
      ...Array.from({ length: 19 }, (_, i) => ({ id: `daily-${i}`, is_checkout_room: false, pms_metadata: {} })),
      ...Array.from({ length: 11 }, (_, i) => ({
        id: `unsold-${i}`,
        is_checkout_room: true,
        pms_metadata: { selectedDateSnapshotKind: 'potential_checkout' },
      })),
    ];

    expect(summarizeTeamWorkload(rooms)).toEqual({
      confirmedCheckoutCount: 16,
      dailyCount: 19,
      unsoldCount: 11,
      totalCount: 46,
    });
  });
});
