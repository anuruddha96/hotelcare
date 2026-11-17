import { describe, expect, it } from 'vitest';
import {
  buildSchedulePlan,
  datesBetween,
  entryMinutes,
  type PlannerEntry,
  type PlannerStaff,
} from '../../supabase/functions/_shared/schedulePlanner';

const HOTEL = 'memories-budapest';
const staff = (id: string, jobRole: string, extra: Partial<PlannerStaff> = {}): PlannerStaff => ({
  id, name: id, jobRole, department: jobRole === 'Receptionist' ? 'Reception' : 'Housekeeping', hotelId: HOTEL,
  employmentType: 'full_time', dailyHours: 8, startDate: null, endDate: null, ...extra,
});
const work = (staffId: string, date: string, extra: Partial<PlannerEntry> = {}): PlannerEntry => ({
  staffId, date, kind: 'work', code: 'SZ', startTime: null, endTime: null, dayFraction: 1, hotelId: HOTEL, status: 'published', ...extra,
});

// Four weeks of November history: three attendants a day on weekdays, two at
// weekends; reception has one day (08–20) and one night (20–08) every day.
const attendants = ['ra1', 'ra2', 'ra3', 'ra4'].map((id) => staff(id, 'Room attendant'));
const receptionists = ['rc1', 'rc2', 'rc3'].map((id) => staff(id, 'Receptionist'));
function novemberHistory(): PlannerEntry[] {
  const out: PlannerEntry[] = [];
  datesBetween('2026-11-02', '2026-11-29').forEach((date, i) => {
    const weekend = [0, 6].includes(new Date(`${date}T12:00:00Z`).getUTCDay());
    const count = weekend ? 2 : 3;
    for (let k = 0; k < count; k++) out.push(work(attendants[(i + k) % 4].id, date));
    out.push(work(receptionists[i % 3].id, date, { code: null, startTime: '08:00:00', endTime: '20:00:00' }));
    out.push(work(receptionists[(i + 1) % 3].id, date, { kind: 'night', code: null, startTime: '20:00:00', endTime: '08:00:00' }));
  });
  return out;
}

describe('Mira schedule planner', () => {
  const base = {
    hotelId: HOTEL,
    from: '2026-12-01',
    to: '2026-12-14',
    today: '2026-11-17',
    staff: [...attendants, ...receptionists],
    history: novemberHistory(),
  };

  it('never changes existing entries and fills only empty days', () => {
    const entries = [
      work('ra1', '2026-12-01', { kind: 'leave', code: 'SZB' }),
      work('ra2', '2026-12-02', { kind: 'fixed_day_off', code: 'FIX' }),
      work('rc1', '2026-12-03', { code: null, startTime: '08:00:00', endTime: '20:00:00', status: 'draft' }),
    ];
    const plan = buildSchedulePlan({ ...base, entries });
    for (const e of entries) {
      expect(plan.cells.some((c) => c.staffId === e.staffId && c.date === e.date)).toBe(false);
    }
    expect(plan.cells.every((c) => c.date >= '2026-12-01' && c.date <= '2026-12-14')).toBe(true);
  });

  it('keeps the usual staffing per weekday, with reception day and night shifts', () => {
    const plan = buildSchedulePlan({ ...base, entries: [] });
    const tuesday = plan.days.find((d) => d.date === '2026-12-01')!;
    const attendantsDay = tuesday.coverage.find((c) => c.bucket === 'Room attendant · day')!;
    expect(attendantsDay.required).toBe(3);
    expect(attendantsDay.after).toBeGreaterThanOrEqual(3);
    const night = tuesday.coverage.find((c) => c.bucket === 'Receptionist · night')!;
    expect(night.required).toBe(1);
    expect(night.after).toBe(1);
    // Night shifts keep their times.
    const nightCell = plan.cells.find((c) => c.date === '2026-12-01' && c.kind === 'night')!;
    expect(nightCell.startTime).toBe('20:00:00');
    expect(nightCell.minutes).toBe(720);
  });

  it('adds room attendants when the bookings need more than usual', () => {
    const plan = buildSchedulePlan({
      ...base,
      entries: [],
      demand: { '2026-12-05': { checkouts: 40, stayovers: 30 } }, // 1800 + 450 min → 5 shifts
    });
    const saturday = plan.days.find((d) => d.date === '2026-12-05')!;
    const day = saturday.coverage.find((c) => c.bucket === 'Room attendant · day')!;
    // Only four attendants exist, so the requirement is capped at four.
    expect(day.required).toBe(4);
    expect(day.after).toBe(4);
  });

  it('respects rest rules: at most six days in a row, no day shift after a night', () => {
    const plan = buildSchedulePlan({ ...base, to: '2026-12-31', entries: [] });
    const all = [...plan.cells].sort((a, b) => a.date.localeCompare(b.date));
    for (const person of [...attendants, ...receptionists]) {
      const days = new Set(all.filter((c) => c.staffId === person.id).map((c) => c.date));
      let run = 0;
      for (const date of datesBetween('2026-12-01', '2026-12-31')) {
        run = days.has(date) ? run + 1 : 0;
        expect(run).toBeLessThanOrEqual(6);
      }
      for (const c of all.filter((x) => x.staffId === person.id && x.kind === 'night')) {
        const next = new Date(Date.parse(`${c.date}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
        const following = all.find((x) => x.staffId === person.id && x.date === next);
        expect(following === undefined || following.kind === 'night').toBe(true);
      }
    }
  });

  it('works out hours against the monthly norm', () => {
    const plan = buildSchedulePlan({ ...base, to: '2026-12-31', entries: [work('ra1', '2026-12-01', { kind: 'leave', code: 'SZB' })] });
    const ra1 = plan.staff.find((s) => s.staffId === 'ra1')!;
    // December 2026: 21 working days (24–26 Dec are holidays) × 8 h.
    expect(ra1.targetMinutes).toBe(21 * 8 * 60);
    // Paid leave counts as worked time.
    expect(ra1.existingMinutes).toBe(8 * 60);
    expect(ra1.balanceAfterMinutes).not.toBeNull();
    expect(Math.abs(ra1.balanceAfterMinutes!)).toBeLessThanOrEqual(8 * 60);
    expect(plan.totals.shiftsAdded).toBe(plan.cells.length);
    expect(plan.totals.minutesAdded).toBe(plan.cells.reduce((sum, c) => sum + c.minutes, 0));
  });

  it('gives hourly staff no norm and uses them only after norm staff', () => {
    const hourly = staff('ra5', 'Room attendant', { employmentType: 'hourly' });
    const plan = buildSchedulePlan({ ...base, staff: [...base.staff, hourly], entries: [] });
    expect(plan.staff.find((s) => s.staffId === 'ra5')!.targetMinutes).toBeNull();
    expect(plan.cells.filter((c) => c.staffId === 'ra5').length).toBeLessThan(plan.cells.filter((c) => c.staffId === 'ra1').length);
  });

  it('never plans the past', () => {
    const plan = buildSchedulePlan({ ...base, from: '2026-11-10', to: '2026-11-20', today: '2026-11-17', entries: [] });
    expect(plan.from).toBe('2026-11-17');
    expect(plan.cells.every((c) => c.date >= '2026-11-17')).toBe(true);
    expect(plan.warnings.join(' ')).toMatch(/Past days/);
  });

  it('counts worked minutes like the Work schedule', () => {
    expect(entryMinutes(work('x', '2026-12-01', { startTime: '20:00:00', endTime: '08:00:00', kind: 'night' }), 8)).toBe(720);
    expect(entryMinutes(work('x', '2026-12-01', { dayFraction: 0.5 }), 8)).toBe(240);
    expect(entryMinutes(work('x', '2026-12-01', { kind: 'sick' }), 6)).toBe(360);
    expect(entryMinutes(work('x', '2026-12-01', { kind: 'day_off' }), 8)).toBe(0);
  });
});
