import { describe, expect, it } from 'vitest';
import {
  findCurrentDayHousekeepingReviewPlan,
  findTomorrowHousekeepingPlan,
  isCurrentDayHousekeepingReviewPlan,
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
  it('keeps an approved current-day plan reviewable before the tomorrow planning window', () => {
    const current = plan('today', today, 'approved');

    expect(findCurrentDayHousekeepingReviewPlan([current], today)).toBe(current);
    expect(isCurrentDayHousekeepingReviewPlan(current, today)).toBe(true);
    expect(pickHousekeepingLauncherPlan([current], today, tomorrow, false)).toBe(current);
  });

  it('keeps a released current-day plan reviewable after assignments are published', () => {
    const current = plan('today', today, 'released');

    expect(findCurrentDayHousekeepingReviewPlan([current], today)).toBe(current);
    expect(isCurrentDayHousekeepingReviewPlan(current, today)).toBe(true);
  });

  it('does not revive an unapproved draft or cancelled plan as today operational work', () => {
    expect(findCurrentDayHousekeepingReviewPlan([plan('draft', today, 'draft')], today)).toBeNull();
    expect(findCurrentDayHousekeepingReviewPlan([plan('cancelled', today, 'cancelled')], today)).toBeNull();
  });

  it('finds tomorrow independently from today so both cards can be shown', () => {
    const current = plan('today', today, 'released');
    const next = plan('tomorrow', tomorrow, 'draft');
    const rows = [next, current];

    expect(findCurrentDayHousekeepingReviewPlan(rows, today)).toBe(current);
    expect(findTomorrowHousekeepingPlan(rows, tomorrow)).toBe(next);
  });

  it('prefers tomorrow in the backwards-compatible single-card selector once planning is open', () => {
    const current = plan('today', today, 'failed');
    const next = plan('tomorrow', tomorrow, 'approved');

    expect(pickHousekeepingLauncherPlan([next, current], today, tomorrow, true)).toBe(next);
  });

  it('does not surface tomorrow before the planning window when there is no current-day plan', () => {
    const next = plan('tomorrow', tomorrow, 'draft');

    expect(pickHousekeepingLauncherPlan([next], today, tomorrow, false)).toBeNull();
  });
});
