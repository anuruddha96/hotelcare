import { describe, expect, it } from 'vitest';
import {
  ALERT_AFTER_MINUTES, correctionAlertEmail, correctionCutoff, decideProblem, problemAlertEmail, problemFromStatus,
  problemResolvedEmail, SUPPORT_INBOX,
} from '../../../supabase/functions/_shared/viza/alerts';

const at = (iso: string) => new Date(iso);
const none = { problem_since: null, problem_kind: null, problem_alert_sent_at: null };

describe('VIZA problem tracking', () => {
  it('reads the THF status code', () => {
    expect(problemFromStatus('OK')).toBeNull();
    expect(problemFromStatus('WARNING|VIZA-OFFLINE')).toBe('thf_warning');
    expect(problemFromStatus('ERROR|CERT-EXPIRED')).toBe('thf_error');
    expect(problemFromStatus(null)).toBe('unreachable');
    expect(problemFromStatus('HTTP 502')).toBe('unreachable');
  });

  it('starts the clock, waits an hour, alerts once', () => {
    const start = decideProblem(none, 'unreachable', at('2026-11-25T14:54:01Z'));
    expect(start).toMatchObject({ next: { problem_since: '2026-11-25T14:54:01.000Z', problem_kind: 'unreachable' }, sendAlert: false });
    const running = { problem_since: '2026-11-25T14:54:01.000Z', problem_kind: 'unreachable' as const, problem_alert_sent_at: null };
    expect(decideProblem(running, 'unreachable', at('2026-11-25T15:53:00Z')).sendAlert).toBe(false);
    expect(decideProblem(running, 'unreachable', at('2026-11-25T15:54:01Z')).sendAlert).toBe(true);
    expect(ALERT_AFTER_MINUTES).toBe(60);
    const told = { ...running, problem_alert_sent_at: '2026-11-25T15:54:02.000Z' };
    expect(decideProblem(told, 'unreachable', at('2026-11-25T18:00:00Z')).sendAlert).toBe(false);
  });

  it('keeps one incident when the kind changes, and sends a resolved note only if support was told', () => {
    const running = { problem_since: '2026-11-25T14:54:01.000Z', problem_kind: 'unreachable' as const, problem_alert_sent_at: null };
    expect(decideProblem(running, 'thf_warning', at('2026-11-25T15:04:01Z')).next).toEqual({ problem_since: '2026-11-25T14:54:01.000Z', problem_kind: 'thf_warning' });
    expect(decideProblem(running, null, at('2026-11-25T15:04:01Z'))).toMatchObject({ next: { problem_since: null, problem_kind: null }, sendResolved: false, clearAlert: false });
    const told = { ...running, problem_alert_sent_at: '2026-11-25T15:54:02.000Z' };
    expect(decideProblem(told, null, at('2026-11-25T16:04:01Z'))).toMatchObject({ sendResolved: true, clearAlert: true });
  });

  it('finds rejected reports older than an hour', () => {
    expect(correctionCutoff(at('2026-11-25T16:00:00Z'))).toBe('2026-11-25T15:00:00.000Z');
  });
});

describe('VIZA support e-mails', () => {
  it('go to the HotelCare support inbox with plain words and the technical details', () => {
    expect(SUPPORT_INBOX).toBe('info@hotelcare.app');
    const mail = problemAlertEmail({ hotelName: 'Test <Hotel>', hotelId: 'h1', kind: 'unreachable', since: '2026-11-25T13:54:01Z', waiting: 2, statusCode: null, lastError: 'unsuccessful tunnel' });
    expect(mail.subject).toContain('Test <Hotel>');
    expect(mail.html).toContain('Test &lt;Hotel&gt;');
    expect(mail.text).toContain('25 Nov 2026, 14:54');
    expect(mail.text).toContain('Guest reports waiting: 2');
    expect(mail.text).toContain('unsuccessful tunnel');
    expect(problemResolvedEmail({ hotelName: 'Test', hotelId: 'h1', since: '2026-11-25T13:54:01Z', now: at('2026-11-25T15:04:01Z') }).subject).toBe('VIZA resolved · Test');
  });

  it('lists uncorrected rejections by booking number and THF code only', () => {
    const mail = correctionAlertEmail({ hotelName: 'Test', hotelId: 'h1', items: [{ reservationNumber: 'RES-1', phase: 'arrival', error: 'THF EF0051', since: '2026-11-25T13:55:09Z' }] });
    expect(mail.subject).toContain('1 rejected guest report not corrected');
    expect(mail.text).toContain('RES-1 · arrival: THF EF0051');
  });
});
