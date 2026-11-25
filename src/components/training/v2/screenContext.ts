// Training v2 — "what applies to the screen in front of me?"
//
// Pure functions (no React, no Supabase) so the matching rules are unit-testable.
// A curriculum step already declares where it lives (`route`, `tab`, `subTab`).
// We reuse that declaration to find the guides that are relevant right now and
// the first step of each guide that belongs to the current screen.
import type { TrainingCurriculum, TrainingScreenContext, TrainingStepV2 } from './types';

/** Anchors that exist on every screen — they never make a step screen-specific. */
export const GLOBAL_TRAINING_ANCHORS = new Set([
  '[data-training="hotel-switcher"]',
  '[data-training="help-button"]',
  '[data-training="language-switch"]',
  '[data-training="main-tabs"]',
]);

export interface ScreenMatch {
  curriculum: TrainingCurriculum;
  /** First step of the curriculum that belongs to the current screen. */
  stepKey: string;
  stepIndex: number;
}

const normalizePath = (path: string) => {
  const trimmed = path.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
};

/** Is `resolvedRoute` the tenant dashboard root (e.g. `/rdhotels`)? */
function isDashboardRoot(resolvedRoute: string | undefined): boolean {
  if (!resolvedRoute) return true;
  const segments = normalizePath(resolvedRoute).split('/').filter(Boolean);
  return segments.length <= 1;
}

function routeMatches(resolvedRoute: string | undefined, pathname: string): boolean {
  if (!resolvedRoute) return true; // tab-only steps live on the current dashboard
  const route = normalizePath(resolvedRoute);
  const path = normalizePath(pathname);
  if (path === route) return true;
  // The dashboard lives only at its root; `/org/training` is another page.
  // Feature pages (`/org/revenue/:hotelId`) may nest, so they prefix-match.
  return !isDashboardRoot(resolvedRoute) && path.startsWith(`${route}/`);
}

/**
 * Does this step belong to the given screen?
 *
 * - Steps anchored to a global control (help button, hotel switcher…) are not
 *   screen-specific and never match.
 * - A step with a `tab` matches only that dashboard tab (and sub-tab, if set).
 * - A step on a non-dashboard route (Revenue, Purchase invoices…) matches that
 *   route even when it is a text-only card — the page itself is the screen.
 * - A text-only intro card on the dashboard root (no tab, no selector) belongs
 *   to no particular screen.
 */
export function stepMatchesScreen(
  step: TrainingStepV2,
  screen: TrainingScreenContext,
  resolveRoute: (raw?: string) => string | undefined,
): boolean {
  if (step.selector && GLOBAL_TRAINING_ANCHORS.has(step.selector)) return false;
  const resolved = resolveRoute(step.route);
  if (!routeMatches(resolved, screen.pathname)) return false;

  if (step.tab) {
    if (!screen.tab || screen.tab !== step.tab) return false;
    if (step.subTab && screen.subTab !== step.subTab) return false;
    return true;
  }

  if (!step.route) return false; // nothing ties the step to a place
  if (isDashboardRoot(resolved)) {
    // Dashboard root without a tab: only a real, non-global anchor ties it to
    // the screen (intro cards do not).
    return Boolean(step.selector);
  }
  return true;
}

/**
 * Curricula that have at least one step on the current screen, each with the
 * first such step. Order is preserved from the input (callers pass the
 * role-sorted list), so priority order is kept.
 */
export function matchCurriculaToScreen(
  curricula: TrainingCurriculum[],
  screen: TrainingScreenContext,
  resolveRoute: (raw?: string) => string | undefined,
): ScreenMatch[] {
  const matches: ScreenMatch[] = [];
  for (const curriculum of curricula) {
    const stepIndex = curriculum.steps.findIndex((step) => stepMatchesScreen(step, screen, resolveRoute));
    if (stepIndex < 0) continue;
    matches.push({ curriculum, stepKey: curriculum.steps[stepIndex].key, stepIndex });
  }
  return matches;
}

/**
 * Which step to open a guide at from the "On this screen" entry point.
 * Starting one or two steps in would skip the welcome card, so very early
 * matches start from the beginning; later matches jump straight to the
 * screen the user is already looking at.
 */
export function startKeyForScreenMatch(match: ScreenMatch): string | undefined {
  return match.stepIndex <= 1 ? undefined : match.stepKey;
}
