import { describe, expect, it } from 'vitest';
import { getSlntRosterNotice, slntRosterAllowsManualAssignment } from './slntRosterNotice';

describe('SLNT roster explanations', () => {
  it('shows a schedule CTA when the published roster is genuinely empty', () => {
    const notice = getSlntRosterNotice(0, '2026-09-23');
    expect(notice).toEqual({
      kind: 'missing',
      message: expect.stringContaining('2026-09-23'),
      action: 'schedule',
    });
    expect(notice?.message).toContain('still assign rooms manually');
  });

  it('allows manual SLNT room assignment after an empty roster was verified', () => {
    const notice = getSlntRosterNotice(0, '2026-09-23');
    expect(slntRosterAllowsManualAssignment(true, notice)).toBe(true);
  });

  it('keeps manual assignment blocked while roster state is unknown or failed', () => {
    expect(slntRosterAllowsManualAssignment(false, getSlntRosterNotice(0, '2026-09-23'))).toBe(false);
    expect(slntRosterAllowsManualAssignment(true, getSlntRosterNotice(0, '2026-09-23', {
      code: '42501', message: 'Not authorized to read the SLNT housekeeping roster',
    }))).toBe(false);
    expect(slntRosterAllowsManualAssignment(true, getSlntRosterNotice(0, '2026-09-23', {
      code: '503', message: 'server unavailable',
    }))).toBe(false);
  });
  it('does not confuse an uninstalled RPC with an unpublished schedule', () => {
    expect(getSlntRosterNotice(0, '2026-09-23', {
      code: 'PGRST202', message: 'Could not find the function public.slnt_housekeeping_published_roster',
    })?.kind).toBe('setup');
  });
  it('explains venue permission failures without exposing database details', () => {
    expect(getSlntRosterNotice(0, '2026-09-23', {
      code: '42501', message: 'Not authorized to read the SLNT housekeeping roster',
    })?.kind).toBe('permission');
  });
  it('does not claim shifts are missing on a network or server error', () => {
    const notice = getSlntRosterNotice(0, '2026-09-23', {
      code: '503', message: 'server unavailable',
    });
    expect(notice?.kind).toBe('error');
    expect(notice?.message).toContain('may already exist');
  });
  it('displays no warning after verified published shifts are returned', () => {
    expect(getSlntRosterNotice(2, '2026-09-23')).toBeNull();
  });
});
