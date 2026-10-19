import { describe, expect, it } from 'vitest';
import { canOpenGozsduSameDayReplacement, hasUnstartedReplacementWork } from '../housekeepingSameDayReplacement';

const today = '2026-10-19';
const valid = { status: 'released', planDate: today, today, assignedHotel: 'gozsdu-court', role: 'manager' };

describe('Gozsdu released schedule replacements', () => {
  it('allows a manager to review a released plan on the same business date', () => {
    expect(canOpenGozsduSameDayReplacement(valid)).toBe(true);
    expect(canOpenGozsduSameDayReplacement({ ...valid, role: 'top_management_manager' })).toBe(true);
  });

  it('never exposes the replacement action on drafts, other days, other hotels or to staff', () => {
    expect(canOpenGozsduSameDayReplacement({ ...valid, status: 'approved' })).toBe(false);
    expect(canOpenGozsduSameDayReplacement({ ...valid, planDate: '2026-10-18' })).toBe(false);
    expect(canOpenGozsduSameDayReplacement({ ...valid, assignedHotel: 'Hotel Mika Downtown' })).toBe(false);
    expect(canOpenGozsduSameDayReplacement({ ...valid, role: 'housekeeping' })).toBe(false);
  });

  it('only offers replacement where unstarted operational assignments exist', () => {
    expect(hasUnstartedReplacementWork([{ liveStatus: 'assigned' }], [])).toBe(true);
    expect(hasUnstartedReplacementWork([], [{ liveStatus: 'assigned' }])).toBe(true);
    expect(hasUnstartedReplacementWork([{ liveStatus: 'in_progress' }], [])).toBe(false);
    expect(hasUnstartedReplacementWork([{ liveStatus: null }], [{ liveStatus: 'completed' }])).toBe(false);
  });
});
