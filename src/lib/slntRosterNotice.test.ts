import { describe, expect, it } from 'vitest';
import { getSlntRosterNotice } from './slntRosterNotice';

describe('SLNT roster explanations', () => {
  it('shows a schedule CTA when the published roster is genuinely empty', () => {
    expect(getSlntRosterNotice(0, '2026-09-23')).toEqual({
      kind: 'missing',
      message: expect.stringContaining('2026-09-23'),
      action: 'schedule',
    });
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
