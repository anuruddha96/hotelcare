import { describe, expect, it } from 'vitest';
import { calculateScheduledMinutes, getScheduleSummary } from './staffScheduleAnalytics';

describe('staff schedule analytics', () => {
  it('calculates normal and overnight shifts without losing a day', () => {
    expect(calculateScheduledMinutes('08:00','17:30')).toBe(570);
    expect(calculateScheduledMinutes('20:00','08:00')).toBe(720);
    expect(calculateScheduledMinutes('09:00','09:00')).toBeNull();
    expect(calculateScheduledMinutes('unsure','17:00')).toBeNull();
  });
  it('separates leave, illness, and off days from payable time', () => {
    const result=getScheduleSummary([
      { user_id:'1',work_date:'2026-11-11',status:'published',work_status:'working',shift_start:'20:00',shift_end:'08:00' },
      { user_id:'1',work_date:'2026-11-12',status:'draft',work_status:'leave' },
      { user_id:'2',work_date:'2026-11-12',status:'published',work_status:'sick' },
      { user_id:'2',work_date:'2026-11-13',status:'draft',work_status:'working',shift_start:'maybe',shift_end:'20:00' },
    ]);
    expect(result.hours).toBe(12);
    expect(result.leave).toBe(1);
    expect(result.sick).toBe(1);
    expect(result.incomplete).toBe(1);
    expect(result.published).toBe(2);
  });
});
