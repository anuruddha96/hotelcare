import { describe, expect, it } from 'vitest';
import { runHeadline, runPreview, runStats, runStatus } from './automationSummary';

describe('AI supervisor revenue notifications', () => {
  const aiRun = {
    notification_type: 'engine_v2_run',
    run_source: 'automatic',
    source: 'ai' as const,
    actions_count: 2,
    pushed_count: 0,
    changes: [
      { date: '2026-11-12', delta: -6, reference_before: 133, reference_target: 127, status: 'accepted', push_requested_count: 13, push_accepted_count: 13, push_failed_count: 0 },
      { date: '2027-01-23', delta: -2, reference_before: 213, reference_target: 211, status: 'accepted', push_requested_count: 13, push_accepted_count: 13, push_failed_count: 0 },
    ],
  };

  it('counts changed stay dates rather than falsely claiming two room prices', () => {
    expect(runHeadline(aiRun)).toBe('AI supervisor lowered 2 stay dates');
    expect(runStats(aiRun)).toEqual([
      { label: 'Stay dates repriced', value: 2 },
      { label: 'Dates accepted', value: 2 },
      { label: 'Prices accepted by Previo', value: 26 },
    ]);
  });

  it('distinguishes accepted price cells from independently verified prices', () => {
    expect(runStatus(aiRun).text).toContain('accepted by Previo');
    expect(runStatus(aiRun).text).toContain('Readback not yet confirmed');
    expect(runPreview(aiRun)).toContain('26 prices accepted by Previo');
  });

  it('does not claim older queued AI updates are already live', () => {
    const queued = { ...aiRun, changes: aiRun.changes.map((row) => ({ ...row, status: 'queued', push_accepted_count: 0 })) };
    expect(runStatus(queued).text).toContain('Publishing not confirmed yet');
  });

  it('reports publishing failures plainly', () => {
    const failed = {
      ...aiRun,
      changes: [aiRun.changes[0], { ...aiRun.changes[1], status: 'failed', push_failed_count: 2, push_accepted_count: 0 }],
    };
    expect(runStatus(failed).tone).toBe('attention');
    expect(runPreview(failed)).toContain('1 publishing failures');
  });

  it('preserves normal algorithmic run reporting', () => {
    const algorithm = {
      run_source: 'automatic',
      actions_count: 5,
      run: {
        mode: 'live', status: 'completed', dates_evaluated: 20, dates_increased: 1,
        dates_decreased: 2, dates_held: 17, cells_queued: 39, cells_published: 39,
        cells_verified: 0, cells_failed: 0,
      },
    };
    expect(runHeadline(algorithm)).toBe('Automatic pricing changed 3 stay dates');
    expect(runStatus(algorithm).text).toContain('accepted by Previo');
  });
});
