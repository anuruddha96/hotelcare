import { describe, it, expect, beforeEach } from 'vitest';
import { ALL_CURRICULA, curriculaForRole } from '../curricula';
import { matchCurriculaToScreen, startKeyForScreenMatch, stepMatchesScreen } from '../screenContext';
import { NUDGE_SNOOZE_DAYS, isNudgeSnoozed, snoozeNudge } from '../nudgeStore';
import type { TrainingStepV2 } from '../types';

const ORG = 'rdhotels';
const resolveRoute = (raw?: string) => raw?.replace(/:orgSlug/g, ORG).replace(/:org\b/g, ORG);
const text = { en: 'x' };
const step = (over: Partial<TrainingStepV2>): TrainingStepV2 => ({ key: 'k', title: text, body: text, ...over });

describe('stepMatchesScreen', () => {
  const dashboard = (tab?: string, subTab?: string) => ({ pathname: `/${ORG}`, tab, subTab });

  it('matches a tab step only on that dashboard tab', () => {
    const s = step({ route: '/:org', tab: 'housekeeping', selector: '[data-training="assigned-room-card"]' });
    expect(stepMatchesScreen(s, dashboard('housekeeping'), resolveRoute)).toBe(true);
    expect(stepMatchesScreen(s, dashboard('attendance'), resolveRoute)).toBe(false);
    expect(stepMatchesScreen(s, dashboard(undefined), resolveRoute)).toBe(false);
  });

  it('requires the sub-tab when the step names one, and ignores it otherwise', () => {
    const team = step({ route: '/:org', tab: 'housekeeping', subTab: 'manage', selector: '[data-training="team-view"]' });
    expect(stepMatchesScreen(team, dashboard('housekeeping', 'manage'), resolveRoute)).toBe(true);
    expect(stepMatchesScreen(team, dashboard('housekeeping', 'supervisor'), resolveRoute)).toBe(false);
    const anySub = step({ route: '/:org', tab: 'housekeeping', selector: '[data-training="manager-team-tab"]' });
    expect(stepMatchesScreen(anySub, dashboard('housekeeping', 'staff-management'), resolveRoute)).toBe(true);
  });

  it('never treats global anchors or dashboard intro cards as screen-specific', () => {
    expect(stepMatchesScreen(step({ route: '/:org', selector: '[data-training="help-button"]' }), dashboard('housekeeping'), resolveRoute)).toBe(false);
    expect(stepMatchesScreen(step({ route: '/:org' }), dashboard('housekeeping'), resolveRoute)).toBe(false);
    expect(stepMatchesScreen(step({}), dashboard('housekeeping'), resolveRoute)).toBe(false);
  });

  it('matches a whole non-dashboard page, including its text-only cards', () => {
    const revenueIntro = step({ route: '/:org/revenue' });
    expect(stepMatchesScreen(revenueIntro, { pathname: `/${ORG}/revenue` }, resolveRoute)).toBe(true);
    expect(stepMatchesScreen(revenueIntro, { pathname: `/${ORG}/revenue/hotel-1` }, resolveRoute)).toBe(true);
    expect(stepMatchesScreen(revenueIntro, { pathname: `/${ORG}/revenue-reports` }, resolveRoute)).toBe(false);
    expect(stepMatchesScreen(revenueIntro, { pathname: `/${ORG}`, tab: 'housekeeping' }, resolveRoute)).toBe(false);
  });

  it('does not let a stale dashboard tab match a dashboard step on another page', () => {
    const s = step({ route: '/:org', tab: 'housekeeping', selector: '[data-training="assigned-room-card"]' });
    expect(stepMatchesScreen(s, { pathname: `/${ORG}/training`, tab: 'housekeeping' }, resolveRoute)).toBe(false);
  });
});

describe('matchCurriculaToScreen with the real curricula', () => {
  it('offers housekeepers the shift and doorway guides on My Tasks, and only the shift guide on Work status', () => {
    const hk = curriculaForRole('housekeeping');
    const onTasks = matchCurriculaToScreen(hk, { pathname: `/${ORG}`, tab: 'housekeeping' }, resolveRoute);
    expect(onTasks.map((m) => m.curriculum.slug)).toEqual(['v2_housekeeper_first_day', 'v2_housekeeper_at_the_door']);
    expect(onTasks[0].stepKey).toBe('open_my_tasks');
    expect(onTasks[1].stepKey).toBe('door_intro');

    const onAttendance = matchCurriculaToScreen(hk, { pathname: `/${ORG}`, tab: 'attendance' }, resolveRoute);
    expect(onAttendance.map((m) => m.curriculum.slug)).toEqual(['v2_housekeeper_first_day']);
    expect(onAttendance[0].stepKey).toBe('signin');
  });

  it('offers managers the Team View guide on the housekeeping tab and the ticket guide on tickets', () => {
    const mgr = curriculaForRole('manager');
    const onHk = matchCurriculaToScreen(mgr, { pathname: `/${ORG}`, tab: 'housekeeping', subTab: 'manage' }, resolveRoute);
    expect(onHk.map((m) => m.curriculum.slug)).toContain('v2_manager_team_and_assignments');
    const onTickets = matchCurriculaToScreen(mgr, { pathname: `/${ORG}`, tab: 'tickets' }, resolveRoute);
    expect(onTickets.map((m) => m.curriculum.slug)).toEqual(['v2_manager_tickets_and_sla']);
    const onTraining = matchCurriculaToScreen(mgr, { pathname: `/${ORG}/training` }, resolveRoute);
    expect(onTraining).toEqual([]);
  });

  it('opens from the start for early matches and jumps to the screen step for later ones', () => {
    const hk = curriculaForRole('housekeeping');
    const first = ALL_CURRICULA.find((c) => c.slug === 'v2_housekeeper_first_day')!;
    const onAttendance = matchCurriculaToScreen(hk, { pathname: `/${ORG}`, tab: 'attendance' }, resolveRoute)[0];
    expect(onAttendance.stepIndex).toBe(1);
    expect(startKeyForScreenMatch(onAttendance)).toBeUndefined();
    const onTasks = matchCurriculaToScreen([first], { pathname: `/${ORG}`, tab: 'housekeeping' }, resolveRoute)[0];
    expect(onTasks.stepIndex).toBeGreaterThan(1);
    expect(startKeyForScreenMatch(onTasks)).toBe('open_my_tasks');
  });
});

describe('nudge snoozes', () => {
  beforeEach(() => window.localStorage.clear());

  it('is quiet only until the snooze expires, per user and per guide', () => {
    const now = Date.parse('2026-11-16T09:00:00Z');
    expect(isNudgeSnoozed('u1', 'g1', now)).toBe(false);
    snoozeNudge('u1', 'g1', NUDGE_SNOOZE_DAYS.ignored, now);
    expect(isNudgeSnoozed('u1', 'g1', now)).toBe(true);
    expect(isNudgeSnoozed('u1', 'g2', now)).toBe(false);
    expect(isNudgeSnoozed('u2', 'g1', now)).toBe(false);
    expect(isNudgeSnoozed('u1', 'g1', now + 6 * 24 * 3600 * 1000)).toBe(true);
    expect(isNudgeSnoozed('u1', 'g1', now + 8 * 24 * 3600 * 1000)).toBe(false);
  });

  it('survives corrupted storage', () => {
    window.localStorage.setItem('hc.training.nudges.u1', '{not json');
    expect(isNudgeSnoozed('u1', 'g1')).toBe(false);
    snoozeNudge('u1', 'g1', 1);
    expect(isNudgeSnoozed('u1', 'g1')).toBe(true);
  });
});
