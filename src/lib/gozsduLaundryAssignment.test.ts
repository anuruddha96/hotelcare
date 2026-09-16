import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./roomAssignmentAlgorithmGozsduLegacy', () => ({
  autoAssignRooms: vi.fn(() => []),
  moveRoom: vi.fn(previews => previews),
}));

import * as original from './roomAssignmentAlgorithmGozsduLegacy';
import { autoAssignRooms, moveRoom } from './roomAssignmentAlgorithm';
import { clearGozsduLaundryDutySession, setGozsduLaundryDutySession } from './gozsduLaundryDutySession';

const cleaner = { id: 'cleaner', full_name: 'Cleaner' } as any;
const laundryner = { id: 'laundryner', full_name: 'Laundryner' } as any;

beforeEach(() => {
  vi.clearAllMocks();
  clearGozsduLaundryDutySession('2026-09-17');
});

describe('Gozsdu Laundryner Auto Assign exclusion', () => {
  it('gives zero Gozsdu rooms to the selected Laundryner', () => {
    setGozsduLaundryDutySession('2026-09-17', ['laundryner']);
    const room = { id: 'room', hotel: 'gozsdu-court' } as any;
    autoAssignRooms([room], [cleaner, laundryner]);
    expect(vi.mocked(original.autoAssignRooms)).toHaveBeenCalledWith(
      [room], [cleaner], undefined, undefined, undefined,
    );
  });

  it('never filters other hotels or moves Gozsdu rooms to Laundryner', () => {
    setGozsduLaundryDutySession('2026-09-17', ['laundryner']);
    const otherRoom = { id: 'mika', hotel: 'mika-downtown' } as any;
    autoAssignRooms([otherRoom], [cleaner, laundryner]);
    expect(vi.mocked(original.autoAssignRooms)).toHaveBeenCalledWith(
      [otherRoom], [cleaner, laundryner], undefined, undefined, undefined,
    );
    const preview = [{ staffId: 'cleaner', rooms: [{ id: 'room', hotel: 'gozsdu-court' }] }] as any;
    expect(moveRoom(preview, 'room', 'cleaner', 'laundryner')).toBe(preview);
    expect(vi.mocked(original.moveRoom)).not.toHaveBeenCalled();
  });
});
