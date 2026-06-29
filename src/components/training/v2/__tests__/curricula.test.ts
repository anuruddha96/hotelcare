import { describe, it, expect } from 'vitest';
import { ALL_CURRICULA } from '../curricula';

// Anchors that exist on every screen — a selector step using one of these
// does not need a `route` or `tab` because it resolves regardless of where
// the user is.
const GLOBAL_ANCHORS = new Set([
  '[data-training="hotel-switcher"]',
  '[data-training="help-button"]',
  '[data-training="language-switch"]',
  '[data-training="main-tabs"]',
]);

// Selectors that target data-dependent UI. Steps targeting these MUST be
// `optional: true` so they defer instead of stalling when empty.
const DATA_GATED_PATTERNS = [
  /pending-approvals/,
  /ticket-row/,
  /ticket-card/,
  /auto-assign-btn/,
  /start-room-button/,
  /ai-analyst-card/,
  /revenue-grid/,
];

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

      it('every data-gated step is optional', () => {
        for (const s of cur.steps) {
          if (!s.selector) continue;
          const gated = DATA_GATED_PATTERNS.some((re) => re.test(s.selector!));
          if (gated) {
            expect(
              s.optional,
              `${cur.slug}::${s.key} targets data-gated "${s.selector}" but is not optional`,
            ).toBe(true);
          }
        }
      });

      it('step keys are unique', () => {
        const keys = cur.steps.map((s) => s.key);
        expect(new Set(keys).size).toBe(keys.length);
      });
    });
  }
});
