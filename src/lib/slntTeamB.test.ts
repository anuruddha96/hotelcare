import { describe, expect, it } from 'vitest';
import {
  SLNT_TEAM_B_EXPECTED_ROOM_COUNT,
  isSlntTeamBRoomNumber,
  summarizeSlntTeamTasks,
} from './slntTeamB';

function expectedTeamBRooms(): string[] {
  return [
    'Be Local Budapest Apartment',
    'Dorothilux Apartment',
    'Giselle Apartment',
    ...Array.from({ length: 6 }, (_, index) => `WR Pension ${101 + index}`),
    ...Array.from({ length: 9 }, (_, index) => `St King 11 – Room ${index + 1}`),
    ...Array.from({ length: 7 }, (_, index) => `K4 – Room ${index + 1}`),
    ...Array.from({ length: 21 }, (_, index) => `Silver Rooms ${index + 1}`),
  ];
}

describe('SLNT Team B room mapping', () => {
  it('matches exactly the 46 workbook-defined Team B units', () => {
    const rooms = expectedTeamBRooms();
    expect(rooms).toHaveLength(SLNT_TEAM_B_EXPECTED_ROOM_COUNT);
    expect(rooms.every(isSlntTeamBRoomNumber)).toBe(true);
  });

  it('does not absorb Team A / unrelated SLNT units', () => {
    const unrelatedRooms = [
      'Best View Budapest',
      'Castle Garden Residence',
      'CityNest',
      'Dandelion Apartment',
      'Grandio 1',
      'Park&Garden apartment',
      'Saphir Apartment',
      'Sobi Apartment Budapest',
      'Urban Oasis',
      'WR Pension 107',
      'St King 11 – Room 10',
      'K4 – Room 8',
      'Silver Rooms 22',
    ];
    expect(unrelatedRooms.some(isSlntTeamBRoomNumber)).toBe(false);
  });

  it('accepts the hyphen variant used by some imports', () => {
    expect(isSlntTeamBRoomNumber('St King 11 - Room 3')).toBe(true);
    expect(isSlntTeamBRoomNumber('K4 - Room 5')).toBe(true);
  });
});

describe('SLNT Team B queue summaries', () => {
  it('counts shared queue states without treating claimed rooms as unassigned', () => {
    expect(summarizeSlntTeamTasks([
      { status: 'queued' },
      { status: 'claimed' },
      { status: 'claimed' },
      { status: 'cancelled' },
    ])).toEqual({ total: 4, queued: 1, claimed: 2, cancelled: 1 });
  });
});
