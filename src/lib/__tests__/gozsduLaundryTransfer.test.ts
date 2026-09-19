import { describe, expect, it } from 'vitest';
import {
  canConfirmGozsduLaundryTransfer, transferAreaCount, transferRoomCount,
  type GozsduTransferPreview,
} from '../gozsduLaundryTransfer';

const preview = (): GozsduTransferPreview => ({
  token: 'a'.repeat(32), blocked_started_or_completed: 0,
  release_locked: false, already_laundryner: false,
  counts: { plan_rooms: 3, plan_areas: 1, property_areas: 2, live_rooms: 1, live_areas: 1 },
  replacement_staff: [{ id: 'replacement', name: 'Replacement', nickname: null }],
  work: { employee: 'source', work_date: '2026-09-20', hotel: 'gozsdu-court',
    plan_rooms: [], plan_areas: [], property_areas: [], live_rooms: [], live_areas: [] },
});

describe('Gozsdu Laundryner confirmed transfer', () => {
  it('counts live and planned work without confusing areas and rooms', () => {
    expect(transferRoomCount(preview())).toBe(4);
    expect(transferAreaCount(preview())).toBe(4);
  });
  it('requires explicit confirmation and an eligible replacement', () => {
    expect(canConfirmGozsduLaundryTransfer(preview(), 'replacement', false)).toBe(false);
    expect(canConfirmGozsduLaundryTransfer(preview(), 'unknown', true)).toBe(false);
    expect(canConfirmGozsduLaundryTransfer(preview(), 'source', true)).toBe(false);
    expect(canConfirmGozsduLaundryTransfer(preview(), 'replacement', true)).toBe(true);
  });
  it('blocks started/completed work and released plans', () => {
    const started = preview(); started.blocked_started_or_completed = 1;
    expect(canConfirmGozsduLaundryTransfer(started, 'replacement', true)).toBe(false);
    const released = preview(); released.release_locked = true;
    expect(canConfirmGozsduLaundryTransfer(released, 'replacement', true)).toBe(false);
  });
  it('blocks existing duties, unexpected hotels and forged snapshots', () => {
    const selected = preview(); selected.already_laundryner = true;
    expect(canConfirmGozsduLaundryTransfer(selected, 'replacement', true)).toBe(false);
    const other = preview(); other.work.hotel = 'another-hotel';
    expect(canConfirmGozsduLaundryTransfer(other, 'replacement', true)).toBe(false);
    const stale = preview(); stale.token = '';
    expect(canConfirmGozsduLaundryTransfer(stale, 'replacement', true)).toBe(false);
  });
  it('does not offer an empty transfer', () => {
    const empty = preview();
    empty.counts = { plan_rooms: 0, plan_areas: 0, property_areas: 0, live_rooms: 0, live_areas: 0 };
    expect(canConfirmGozsduLaundryTransfer(empty, 'replacement', true)).toBe(false);
  });
});
