import { describe, expect, it } from 'vitest';
import { summarizeSlntTeamTasks } from '@/lib/slntTeamB';
import { resolveTeamBOperationalStaffing } from '@/lib/slntTeamBOperationalStaffing';

describe('SLNT Team B planned-first operational guards', () => {
  it('treats materialized planned rooms as assigned, not manager exceptions', () => {
    const summary = summarizeSlntTeamTasks([
      { status: 'claimed' },
      { status: 'claimed' },
      { status: 'queued' },
    ]);
    expect(summary.claimed).toBe(2);
    expect(summary.queued).toBe(1);
  });

  it('keeps the explicit day plan authoritative across later schedule refreshes', () => {
    const beforeRefresh = resolveTeamBOperationalStaffing({
      memberIds: ['carmen', 'imre', 'vivien'],
      dayPlanIds: ['carmen', 'imre'],
      publishedIds: ['vivien'],
    });
    const afterRefresh = resolveTeamBOperationalStaffing({
      memberIds: ['carmen', 'imre', 'vivien'],
      dayPlanIds: ['carmen', 'imre'],
      publishedIds: ['carmen', 'vivien'],
    });

    expect(beforeRefresh.source).toBe('day-plan');
    expect(afterRefresh.source).toBe('day-plan');
    expect([...afterRefresh.selectedIds]).toEqual(['carmen', 'imre']);
  });

  it('never promotes a non-member from either the day plan or published schedule', () => {
    const result = resolveTeamBOperationalStaffing({
      memberIds: ['carmen', 'imre'],
      dayPlanIds: ['carmen', 'former-cleaner'],
      publishedIds: ['former-cleaner'],
    });
    expect([...result.selectedIds]).toEqual(['carmen']);
  });

  it('does not silently assign all Team B members when today has no operational roster', () => {
    const result = resolveTeamBOperationalStaffing({
      memberIds: ['carmen', 'imre', 'vivien'],
      dayPlanIds: [],
      publishedIds: [],
      allowMemberFallback: false,
    });
    expect(result.source).toBe('none');
    expect(result.selectedIds.size).toBe(0);
  });
});
