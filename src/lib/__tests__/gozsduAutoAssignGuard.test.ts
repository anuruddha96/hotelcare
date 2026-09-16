import { describe, expect, it } from 'vitest';
import { gozsduCanReviewAssignment, gozsduPreviewCoversWork } from '../gozsduAutoAssignGuard';

const cleaningIds = new Set(['cleaner-a', 'cleaner-b']);
const laundryIds = new Set(['laundry-a', 'laundry-b']);
const isLaundryner = (id: string) => laundryIds.has(id);
const room = (id: number) => ({ id });

describe('Gozsdu Laundryner Auto Assign review safety', () => {
  it('blocks 0 rooms / 0 staff instead of offering an empty confirmation', () => {
    expect(gozsduCanReviewAssignment([], cleaningIds, isLaundryner)).toBe(false);
    expect(gozsduCanReviewAssignment([{ staffId: 'cleaner-a', rooms: [] }], cleaningIds, isLaundryner)).toBe(false);
    expect(gozsduPreviewCoversWork([], 35, cleaningIds, isLaundryner)).toBe(false);
    expect(gozsduCanReviewAssignment([{ staffId: 'cleaner-a', rooms: [room(1)] }], new Set(), isLaundryner)).toBe(false);
  });

  it('rejects restored or generated Laundryner cleaning cards even with work', () => {
    const previews = [
      { staffId: 'cleaner-a', rooms: [room(1)] },
      { staffId: 'laundry-a', rooms: [room(2)] },
    ];
    expect(gozsduCanReviewAssignment(previews, cleaningIds, isLaundryner)).toBe(false);
    expect(gozsduPreviewCoversWork(previews, 2, cleaningIds, isLaundryner)).toBe(false);
  });

  it('rejects incomplete regenerated previews; accepts correct cleaning-only work', () => {
    const previews = [
      { staffId: 'cleaner-a', rooms: [room(1), room(2)] },
      { staffId: 'cleaner-b', rooms: [room(3)] },
    ];
    expect(gozsduPreviewCoversWork(previews, 35, cleaningIds, isLaundryner)).toBe(false);
    expect(gozsduPreviewCoversWork(previews, 3, cleaningIds, isLaundryner)).toBe(true);
    expect(gozsduCanReviewAssignment(previews, cleaningIds, isLaundryner)).toBe(true);
  });
});
