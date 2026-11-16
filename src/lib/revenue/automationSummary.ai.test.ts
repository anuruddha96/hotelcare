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
    expect(runStatus(aiRun).text).toContain('Readback confirmation follows');
    expect(runPreview(aiRun)).toContain('26 prices accepted by Previo');
  });

  it('reports Previo readback once every accepted cell is confirmed', () => {
    const confirmed = { ...aiRun, changes: aiRun.changes.map((c) => ({ ...c, push_confirmed_count: 13, push_superseded_count: 0 })) };
    expect(runStatus(confirmed)).toEqual({ text: 'All 2 stay dates confirmed in Previo (26 room/guest prices read back).', tone: 'done' });
    expect(runPreview(confirmed)).toBe('2 dates updated · 26 prices confirmed in Previo');
  });

  it('flags cells Previo changed again after acceptance', () => {
    const changed = { ...aiRun, changes: aiRun.changes.map((c, i) => ({ ...c, push_confirmed_count: i === 0 ? 13 : 0, push_superseded_count: i === 0 ? 0 : 13 })) };
    const status = runStatus(changed);
    expect(status.tone).toBe('attention');
    expect(status.text).toContain('13 later changed in Previo');
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

  it('shows exhausted AI provider credits rather than a fictitious failed room price', () => {
    const failedReview = {
      notification_type: 'engine_v2_run',
      run_source: 'automatic',
      source: 'ai' as const,
      actor_name: 'HotelCare AI supervisor',
      actions_count: 0,
      pushed_count: 0,
      failed_count: 1,
      changes: [],
      summary: 'AI review stopped: OpenAI 429: insufficient_quota — You have no credits remaining. The normal pricing engine remains active.',
    };
    expect(runHeadline(failedReview)).toBe('AI review paused — API credits exhausted');
    expect(runPreview(failedReview)).toBe('AI review unavailable · OpenAI API credits exhausted');
    expect(runStatus(failedReview).text).toContain('automatic pricing remains active');
    expect(runStats(failedReview)).toEqual([{ label: 'Failed AI reviews', value: 1, danger: true }]);
    expect(runPreview(failedReview)).not.toContain('price');
  });

  it('does not mislabel other AI provider failures as failed price cells', () => {
    const failedReview = {
      source: 'ai' as const, actions_count: 0, failed_count: 1, changes: [],
      summary: 'AI review stopped: provider connection timed out.',
    };
    expect(runHeadline(failedReview)).toBe('AI pricing review could not run');
    expect(runPreview(failedReview)).toContain('no prices were changed');
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

describe('engine run previews', () => {
  const base = { notification_type: 'engine_v2_run', run_source: 'automatic', actions_count: 0, pushed_count: 0, failed_count: 0 };
  it('a run that changed nothing never reads as "sending"', () => {
    const run = { ...base, run: { mode: 'live', status: 'completed', dates_evaluated: 121, dates_increased: 0, dates_decreased: 0, dates_held: 121, cells_queued: 0 } };
    expect(runPreview(run)).toBe('Reviewed — no price changes needed · 121 dates checked');
  });
  it('a run with queued cells that are not yet accepted is still sending', () => {
    const run = { ...base, actions_count: 6, run: { mode: 'live', status: 'completed', dates_evaluated: 121, dates_increased: 6, dates_decreased: 0, dates_held: 115, cells_queued: 78 } };
    expect(runPreview(run)).toBe('6 dates · 78 prices sending to Previo…');
  });
});
