import { describe, expect, it } from 'vitest';
import { runPreview, runStatus } from './automationSummary';

const base = {
  notification_type: 'engine_v2_run',
  run_source: 'automatic',
  source: 'automation' as const,
  actions_count: 0,
  pushed_count: 0,
  failed_count: 0,
};

describe('automation feed terminal states', () => {
  it('a run that changed nothing is finished, never "sending"', () => {
    const run = { ...base, run: { mode: 'live', status: 'ok', dates_evaluated: 120, dates_increased: 0, dates_decreased: 0, dates_held: 120, cells_queued: 0 } };
    expect(runPreview(run)).toBe('Reviewed 120 dates · no change needed · 120 held');
    expect(runStatus(run)).toEqual({ text: 'Reviewed 120 dates — no price change was needed', tone: 'done' });
  });

  it('a fresh queued run is still sending', () => {
    const run = { ...base, created_at: new Date(Date.now() - 5 * 60_000).toISOString(),
      run: { mode: 'live', status: 'ok', dates_evaluated: 120, dates_increased: 2, dates_decreased: 0, dates_held: 118, cells_queued: 26, cells_published: 0, cells_verified: 0, cells_failed: 0 } };
    expect(runPreview(run)).toBe('2 dates · 26 prices sending to Previo…');
    expect(runStatus(run).tone).toBe('working');
  });

  it('a queued run Previo has not accepted after 30 minutes needs attention instead of spinning forever', () => {
    const run = { ...base, created_at: new Date(Date.now() - 2 * 3_600_000).toISOString(),
      run: { mode: 'live', status: 'ok', dates_evaluated: 120, dates_increased: 2, dates_decreased: 0, dates_held: 118, cells_queued: 26, cells_published: 0, cells_verified: 0, cells_failed: 0 } };
    expect(runPreview(run)).toBe('2 dates · 26 prices not accepted by Previo after 30 min');
    expect(runStatus(run).tone).toBe('attention');
  });

  it('accepted and confirmed runs keep their wording', () => {
    const run = { ...base, created_at: new Date(Date.now() - 2 * 3_600_000).toISOString(),
      run: { mode: 'live', status: 'ok', dates_evaluated: 120, dates_increased: 2, dates_decreased: 0, dates_held: 118, cells_queued: 26, cells_published: 26, cells_verified: 26, cells_failed: 0 } };
    expect(runPreview(run)).toBe('2 dates · 26 prices confirmed in Previo');
    expect(runStatus(run)).toEqual({ text: 'All 26 price cells confirmed in Previo', tone: 'done' });
  });
});
