import { describe, expect, it } from 'vitest';
import {
  isDueFor, NEEDS_CORRECTION, nextSendAt, workerRunAtOrAfter,
} from '../../../supabase/functions/_shared/viza/outcome';
import { vizaWorkerRunAtOrAfter } from './vizaSchedule';

const iso = (d: Date | null) => d?.toISOString() ?? null;

describe('VIZA worker schedule (minute 4, 14, …, 54)', () => {
  it('rounds up to the next worker run', () => {
    expect(iso(workerRunAtOrAfter('2026-11-25T20:32:24Z'))).toBe('2026-11-25T20:34:00.000Z');
    expect(iso(workerRunAtOrAfter('2026-11-25T20:38:13Z'))).toBe('2026-11-25T20:44:00.000Z');
    expect(iso(workerRunAtOrAfter('2026-11-25T20:44:00.000Z'))).toBe('2026-11-25T20:44:00.000Z');
    expect(iso(workerRunAtOrAfter('2026-11-25T20:44:00.500Z'))).toBe('2026-11-25T20:54:00.000Z');
    expect(iso(workerRunAtOrAfter('2026-11-25T20:58:10Z'))).toBe('2026-11-25T21:04:00.000Z');
    expect(iso(workerRunAtOrAfter('2026-11-25T23:59:30Z'))).toBe('2026-11-26T00:04:00.000Z');
  });

  it('gives reception the same time as the server', () => {
    const start = Date.parse('2026-11-25T19:00:00Z');
    for (let t = start; t < start + 2 * 3_600_000; t += 37_000) {
      expect(vizaWorkerRunAtOrAfter(t).toISOString()).toBe(workerRunAtOrAfter(new Date(t)).toISOString());
    }
  });

  it('shows when a failed report really goes out: its retry time, at the worker run that sends it', () => {
    expect(iso(nextSendAt(1, '2026-11-25T20:38:13Z'))).toBe('2026-11-25T20:44:00.000Z');
    expect(iso(nextSendAt(2, '2026-11-25T20:38:13Z'))).toBe('2026-11-25T21:44:00.000Z');
    expect(nextSendAt(NEEDS_CORRECTION, '2026-11-25T20:38:13Z')).toBeNull();
  });
});

describe('which reports a send takes', () => {
  it('instant send (reception): only reports never tried', () => {
    const now = new Date('2026-11-25T20:38:12Z');
    expect(isDueFor('instant', 0, '2026-11-25T20:38:11Z', now)).toBe(true);
    // Failed at 20:32 and due again, but it stays on the worker's schedule.
    expect(isDueFor('instant', 1, '2026-11-25T20:32:24Z', now)).toBe(false);
    expect(isDueFor('instant', 2, '2026-11-25T19:00:00Z', now)).toBe(false);
  });

  it('worker: the guide 6.2 schedule', () => {
    expect(isDueFor('worker', 0, '2026-11-25T20:38:11Z', new Date('2026-11-25T20:38:12Z'))).toBe(true);
    expect(isDueFor('worker', 1, '2026-11-25T20:32:24Z', new Date('2026-11-25T20:44:00Z'))).toBe(true);
    expect(isDueFor('worker', 2, '2026-11-25T20:38:13Z', new Date('2026-11-25T21:37:00Z'))).toBe(false);
    expect(isDueFor('worker', 2, '2026-11-25T20:38:13Z', new Date('2026-11-25T21:44:00Z'))).toBe(true);
    expect(isDueFor('worker', NEEDS_CORRECTION, '2026-11-25T19:00:00Z', new Date('2026-11-26T19:00:00Z'))).toBe(false);
  });

  it('two check-ins during an outage both go out at the first worker run after it', () => {
    // 21:32 check-in A: its instant send fails (attempts 1).
    // 21:38 check-in B: the instant send takes only B, so A keeps attempts 1; B fails too (attempts 1).
    const instantAt = new Date('2026-11-25T20:38:11Z');
    expect(isDueFor('instant', 1, '2026-11-25T20:32:24Z', instantAt)).toBe(false);
    // While the THF cannot be reached the worker stops at its status check and sends nothing.
    // 21:44 worker run, THF back: both reports are due and go out together.
    const workerAt = new Date('2026-11-25T20:44:01Z');
    expect(isDueFor('worker', 1, '2026-11-25T20:32:24Z', workerAt)).toBe(true);
    expect(isDueFor('worker', 1, '2026-11-25T20:38:13Z', workerAt)).toBe(true);
  });
});
