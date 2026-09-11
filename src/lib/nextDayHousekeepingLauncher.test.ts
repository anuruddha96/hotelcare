import { describe, expect, it } from 'vitest';
import {
  isCurrentDayHousekeepingCarryover,
  pickHousekeepingLauncherPlan,
} from './nextDayHousekeepingLauncher';

type Plan = {
  id: string;
  plan_date: string;
  status: 'draft' | 'approved' | 'releasing' | 'released' | 'cancelled' | 'failed';
};

const today = '2026-09-11';
const tomorrow = '2026-09-12';

function plan(id: string, plan_date: string, status: Plan['status']): Plan {
  return { id, plan_date, status };
}

describe('next-day housekeeping launcher plan selection', () => {
  it('keeps an approved current-day plan visible before noon', () => {
    const current = plan('today', today, 'approved');
    const selected = pickHousekeepingLauncherPlan([current], today, tomorrow, false);

    expect(selected).toBe(current);
    expect(isCurrentDayHousekeepingCarryover(selected, today)).toBe(true);
  });

  it('keeps a failed or releasing current-day plan ahead of tomorrow after noon', () => {
    const current = plan('today', today, 'failed');
    const next = plan('tomorrow', tomorrow, 'approved');

    expect(pickHousekeepingLauncherPlan([next, current], today, tomorrow, true)).toBe(current);
  });

  it('does not revive an unapproved draft after midnight', () => {
    const current = plan('today', today, 'draft');

    expect(pickHousekeepingLauncherPlan([current], today, tomorrow, false)).toBeNull();
    expect(isCurrentDayHousekeepingCarryover(current, today)).toBe(false);
  });

  it('does not keep a released or cancelled current-day plan in the morning launcher', () => {
    expect(
      pickHousekeepingLauncherPlan([plan('today', today, 'released')], today, tomorrow, false),
    ).toBeNull();
    expect(
      pickHousekeepingLauncherPlan([plan('today', today, 'cancelled')], today, tomorrow, false),
    ).toBeNull();
  });

  it('returns tomorrow plan after noon when there is no current-day carryover', () => {
    const next = plan('tomorrow', tomorrow, 'draft');

    expect(pickHousekeepingLauncherPlan([next], today, tomorrow, true)).toBe(next);
  });

  it('keeps the launcher hidden before noon when no current-day plan needs attention', () => {
    const next = plan('tomorrow', tomorrow, 'draft');

    expect(pickHousekeepingLauncherPlan([next], today, tomorrow, false)).toBeNull();
  });
});
