import { describe, it, expect } from 'vitest';
import { ALL_CURRICULA } from '../curricula';

const GLOBAL_ANCHORS = new Set([
  '[data-training="hotel-switcher"]',
  '[data-training="help-button"]',
  '[data-training="language-switch"]',
  '[data-training="main-tabs"]',
]);

const DATA_GATED_PATTERNS = [
  /pending-approvals/,
  /ticket-row/,
  /ticket-card/,
  /auto-assign-btn/,
  /start-room-button/,
  /ai-analyst-card/,
  /revenue-grid/,
];

const SUPPORTED_LANGS = ['en', 'hu', 'es', 'vi', 'mn', 'uk'] as const;
const TRAINING_SELECTOR = /^\[data-training="[a-z0-9-]+"\](?: \[data-training="[a-z0-9-]+"\])?$/;

describe('training v2 curricula shape', () => {
  for (const cur of ALL_CURRICULA) {
    describe(cur.slug, () => {
      it('has a non-empty roles array', () => {
        expect(cur.roles.length).toBeGreaterThan(0);
      });

      it('every step has English title + body', () => {
        for (const s of cur.steps) {
          expect(s.title?.en, `step ${s.key} missing title.en`).toBeTruthy();
          expect(s.body?.en, `step ${s.key} missing body.en`).toBeTruthy();
        }
      });

      it('every selector step has route OR tab OR is a global anchor', () => {
        for (const s of cur.steps) {
          if (!s.selector) continue;
          if (GLOBAL_ANCHORS.has(s.selector)) continue;
          const hasNav = Boolean(s.route || s.tab);
          expect(
            hasNav,
            `${cur.slug}::${s.key} → selector "${s.selector}" needs route or tab`,
          ).toBe(true);
        }
      });

      it('every data-gated step is optional unless it is an intentional core action', () => {
        for (const s of cur.steps) {
          if (!s.selector) continue;
          const gated = DATA_GATED_PATTERNS.some((re) => re.test(s.selector!));
          if (!gated) continue;

          expect(
            s.optional,
            `${cur.slug}::${s.key} targets data-gated "${s.selector}" but is not optional`,
          ).toBe(true);
        }
      });

      it('step keys are unique', () => {
        const keys = cur.steps.map((s) => s.key);
        expect(new Set(keys).size).toBe(keys.length);
      });
    });
  }
});

describe('housekeeper first-shift curriculum', () => {
  const hk = ALL_CURRICULA.find((c) => c.slug === 'v2_housekeeper_first_day');

  it('exists and follows the full operational sequence', () => {
    expect(hk).toBeTruthy();
    expect(hk?.steps.map((s) => s.key)).toEqual([
      'welcome',
      'signin',
      'breaks',
      'open_my_tasks',
      'wait_for_assignment',
      'room_overview',
      'my_tasks',
      'special_instructions',
      'room_photos',
      'dnd_photo',
      'dirty_linen',
      'minibar',
      'lost_found',
      'maintenance',
      'notes',
      'messages',
      'complete_room',
      'signout',
    ]);
  });

  it('has a complete but still mobile-manageable first-shift journey', () => {
    const n = hk?.steps.length ?? 0;
    expect(n).toBeGreaterThanOrEqual(16);
    expect(n).toBeLessThanOrEqual(19);
  });

  it('has no duplicate or malformed selectors', () => {
    const selectors = (hk?.steps ?? []).map((s) => s.selector).filter(Boolean) as string[];
    for (const sel of selectors) {
      expect(sel.trim().length).toBeGreaterThan(0);
      expect(sel).toMatch(TRAINING_SELECTOR);
    }
    expect(new Set(selectors).size).toBe(selectors.length);
  });

  it('spotlights the actual check-in swipe control instead of its large wrapper', () => {
    expect(hk?.steps.find((s) => s.key === 'signin')?.selector).toBe(
      '[data-training="check-in-button"] [data-training="swipe-action-track"]',
    );
  });

  it('uses the actual My Tasks tab, then waits visibly for an assignment', () => {
    const openTasks = hk?.steps.find((s) => s.key === 'open_my_tasks');
    expect(openTasks?.selector).toBe('[data-training="housekeeping-tab"]');
    expect(openTasks?.advanceOnClick).toBe(true);
    const roomOverview = hk?.steps.find((s) => s.key === 'room_overview');
    expect(roomOverview?.selector).toBe('[data-training="assigned-room-card"]');
    expect(roomOverview?.optional).toBe(true);
    const wait = hk?.steps.find((s) => s.key === 'wait_for_assignment');
    expect(wait).toBeTruthy();
    expect(wait?.tab).toBe('housekeeping');
    expect(wait?.precondition).toBe('is_signed_in');
    expect(wait?.waitFor).toBe('has_any_assignment_today');
    expect(wait?.selector).toBeUndefined();
    expect(wait?.optional).not.toBe(true);

    const myTasks = hk?.steps.find((s) => s.key === 'my_tasks');
    expect(myTasks?.optional).toBe(true);
    expect(myTasks?.precondition).toBe('has_any_assignment_today');
    expect(myTasks?.skipWhen).toBe('has_in_progress_cleaning');
    expect(myTasks?.tab).toBe('housekeeping');
  });

  it('teaches every important in-room housekeeping function contextually', () => {
    const expectedSelectors: Record<string, string> = {
      room_photos: '[data-training="active-assigned-room"] [data-training="room-photos-button"]',
      dnd_photo: '[data-training="active-assigned-room"] [data-training="dnd-button"]',
      dirty_linen: '[data-training="active-assigned-room"] [data-training="dirty-linen-button"]',
      minibar: '[data-training="active-assigned-room"] [data-training="room-work-tools"]',
      lost_found: '[data-training="active-assigned-room"] [data-training="lost-found-button"]',
      maintenance: '[data-training="active-assigned-room"] [data-training="maintenance-button"]',
      notes: '[data-training="active-assigned-room"] [data-training="notes-button"]',
      messages: '[data-training="active-assigned-room"] [data-training="room-messages"]',
    };

    for (const [key, selector] of Object.entries(expectedSelectors)) {
      const step = hk?.steps.find((s) => s.key === key);
      expect(step?.selector, `${key} selector`).toBe(selector);
      expect(step?.precondition, `${key} precondition`).toBe('has_in_progress_cleaning');
      expect(step?.optional, `${key} must not force a fake operational record`).toBe(true);
      expect(step?.waitFor, `${key} must teach without requiring the feature to be used`).toBeUndefined();
    }
  });

  it('has full content in every training language', () => {
    expect(hk).toBeTruthy();
    if (!hk) return;

    for (const text of [hk.name, hk.description]) {
      for (const lang of SUPPORTED_LANGS) {
        expect(text[lang], `curriculum missing ${lang}`).toBeTruthy();
      }
    }

    for (const step of hk.steps) {
      for (const field of ['title', 'body', 'phase', 'purpose'] as const) {
        const text = step[field];
        expect(text, `${step.key} missing ${field}`).toBeTruthy();
        if (!text) continue;
        for (const lang of SUPPORTED_LANGS) {
          expect(text[lang], `${step.key}.${field} missing ${lang}`).toBeTruthy();
        }
      }
      if (step.tip) {
        for (const lang of SUPPORTED_LANGS) {
          expect(step.tip[lang], `${step.key}.tip missing ${lang}`).toBeTruthy();
        }
      }
    }
  });

  it('recognizes actions already completed before the training starts', () => {
    expect(hk?.steps.find((s) => s.key === 'signin')?.waitFor).toBe('is_signed_in');
    expect(hk?.steps.find((s) => s.key === 'signin')?.skipWhen).toBe('is_signed_in');
    expect(hk?.steps.find((s) => s.key === 'breaks')?.selector).toBe('[data-training="break-button"]');
    expect(hk?.steps.find((s) => s.key === 'signout')?.selector).toBe('[data-training="sign-out-button"]');
    expect(hk?.steps.find((s) => s.key === 'wait_for_assignment')?.waitFor).toBe(
      'has_any_assignment_today',
    );
    expect(hk?.steps.find((s) => s.key === 'my_tasks')?.waitFor).toBe('has_in_progress_cleaning');
    expect(hk?.steps.find((s) => s.key === 'complete_room')?.waitFor).toBe(
      'has_completed_assignment_today',
    );
  });

  it('does not treat zero assignments as a finished shift', () => {
    const signout = hk?.steps.find((s) => s.key === 'signout');
    expect(signout?.precondition).toBe('has_finished_housekeeping_work_today');
    expect(signout?.optional).toBe(true);
  });

  it('only leaves situational or safely deferrable action gates optional', () => {
    const requiredActionSteps = new Set(['signin', 'wait_for_assignment']);
    for (const s of hk?.steps ?? []) {
      if (!s.waitFor || requiredActionSteps.has(s.key)) continue;
      expect(s.optional, `${s.key} is action-gated but not optional`).toBe(true);
    }
  });
});

describe('housekeeper training interaction safety', () => {
  const hk = ALL_CURRICULA.find((c) => c.slug === 'v2_housekeeper_first_day');
  it('keeps the guide escapable with a skip for every step and no keyboard trap', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const overlay = readFileSync(resolve(process.cwd(), 'src/components/training/v2/TrainingOverlayV2.tsx'), 'utf8');
    const engine = readFileSync(resolve(process.cwd(), 'src/components/training/v2/TrainingV2Provider.tsx'), 'utf8');
    expect(overlay).toContain('isHousekeeperTour && (');
    expect(overlay).toContain('onClick={skipForNow}');
    expect(overlay).toContain('onClick={isHousekeeperTour ? pause : () => setConfirmExit(true)}');
    expect(overlay).not.toContain("if (e.key === 'Tab'");
    expect(engine).toContain('if (step.skipWhen && await evaluateGuard(step.skipWhen, guardCtx))');
    expect(engine).toContain("if (active.slug === 'v2_housekeeper_first_day')");
  });

  it('anchors housekeeper training to currently active room cards in both layouts', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    for (const file of ['HousekeepingStaffView.tsx', 'MobileHousekeepingView.tsx']) {
      const source = readFileSync(resolve(process.cwd(), 'src/components/dashboard', file), 'utf8');
      expect(source).toContain('data-training="assigned-room-card"');
      expect(source).toContain("assignment.status === 'in_progress' ? 'active-assigned-room'");
    }
    expect(hk?.steps.find((s) => s.key === 'complete_room')?.selector).toBe(
      '[data-training="active-assigned-room"] [data-training="complete-room-button"]',
    );
  });
});
