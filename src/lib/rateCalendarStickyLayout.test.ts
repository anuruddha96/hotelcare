// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// Vitest's jsdom transforms import.meta.url to a browser URL, not a file URL.
// GitHub Actions runs Vitest from the repository root, so load fixtures there.
const layout = readFileSync('src/styles/rate-calendar-month-layout.css', 'utf8');
const legacy = readFileSync('src/styles/revenue-grid-row-separation.css', 'utf8');

// Browser-level tests are still needed for iOS Safari sticky painting during
// horizontal touch pans. These guard the CSS regression: overflow hidden on
// the sticky labels' ancestor flex rows.
describe('Rate & Pickup frozen summary rows', () => {
  it('overrides clipping on Demand + market and Events ROWS, not date content', () => {
    expect(legacy).toContain('[data-hc-competitor-pricing-row="1"]');
    const repair = layout.split('/* Root cause of the moving Demand + market / Events bands:')[1]
      ?.split('/* Every header metric')[0] ?? '';
    expect(repair).toContain('[data-hc-competitor-pricing-row="1"]');
    expect(repair).toContain('[data-rate-event-row="true"]');
    expect(repair).toContain('overflow: visible !important;');
    // The scrollable date timeline clips event cards, not the sticky label's row.
    expect(legacy).toContain('[data-rate-event-row="true"]');
    expect(legacy).toContain('[data-rate-event-timeline="true"]');
    expect(legacy).toMatch(/\[data-rate-event-timeline="true"\]\s*\{\s*overflow: hidden !important;/);
    expect(legacy).toContain('align-self: stretch;');
  });

  it('renders one continuous event timeline and a full-height frozen label', () => {
    const component = readFileSync('src/components/revenue/RateStrategyGrid.tsx', 'utf8');
    expect(component).toContain('data-rate-event-row="true"');
    // Events must be outside the frozen summary. Only month/date/pickup/
    // occupancy/rooms-left stay visible while vertical rate rows scroll.
    const stickyStart = component.indexOf('ref={stickyHeaderRef}');
    const stickyEnd = component.indexOf('{/* Minimum stay', stickyStart);
    const summary = component.slice(stickyStart, stickyEnd);
    expect(summary).toContain('data-rate-sticky-summary="true"');
    expect(summary).toContain('className="sticky top-0 z-30 bg-card"');
    expect(summary).toContain('Pickup ·');
    expect(summary).toContain('Occupancy');
    expect(summary).toContain('Left to sell');
    expect(summary).not.toContain('data-rate-event-row="true"');
    expect(component).toContain('The rate plan and events stay in natural document flow.');
    expect(component.indexOf('data-rate-event-row="true"')).toBeGreaterThan(stickyEnd);
    expect(component).toContain('data-rate-event-timeline="true"');
    expect(component).toContain('const EVENT_ROW_H = showEventBand ? EVENT_LANE_COUNT * EVENT_LANE_H : ROW_H;');
    expect(component).not.toContain('event-physical-lane-');
    expect(legacy).not.toContain('Third event lane starts at 35px');
    expect(legacy).not.toContain('one event lane is enough context');
  });

  it('preserves sticky positioning, opaque background and full rail width', () => {
    const rail = layout.split('/* Every header metric')[1]?.split('@media (prefers-reduced-motion')[0] ?? '';
    expect(rail).toContain('.sticky.left-0');
    expect(rail).toContain('position: sticky !important;');
    expect(rail).toContain('left: 0 !important;');
    expect(rail).toContain('flex-shrink: 0 !important;');
    expect(rail).toContain('z-index: 60 !important;');
    expect(rail).toContain('background-color: hsl(var(--card)) !important;');
  });
});

describe('iPhone horizontal swipes keep PU / Occ / Left frozen', () => {
  it('does not clip the sticky summary labels at their flex row ancestor', () => {
    const summaryCss = layout.split('/* Frozen rate summary — mobile Safari / desktop.')[1] ?? '';
    expect(summaryCss).toMatch(/\[data-rate-sticky-summary="true"\] > \.flex \{\s*overflow: visible !important;/);

    // A clipped metric-row ancestor silently disables sticky left:0 on Safari.
    const metricRule = summaryCss.match(
      /\[data-rate-sticky-summary="true"\] > \.flex:nth-child\(n\+3\) \{([^}]+)\}/,
    )?.[1] ?? '';
    expect(metricRule).toContain('height: var(--rate-metric-height) !important;');
    expect(metricRule).not.toMatch(/overflow:\s*(hidden|auto|scroll)/);

    // Horizontal date contents are still clipped within their own cells.
    const dateCells = summaryCss.match(
      /\[data-rate-sticky-summary="true"\] > \.flex:nth-child\(n\+3\) > :not\(\.sticky\.left-0\) \{([^}]+)\}/,
    )?.[1] ?? '';
    expect(dateCells).toContain('overflow: hidden;');

    const frozenLabel = summaryCss.match(
      /\[data-rate-sticky-summary="true"\] > \.flex > \.sticky\.left-0 \{([^}]+)\}/,
    )?.[1] ?? '';
    expect(frozenLabel).toContain('position: sticky !important;');
    expect(frozenLabel).toContain('left: 0 !important;');
    expect(frozenLabel).toContain('flex-shrink: 0 !important;');
  });
});

describe('Portrait and landscape freeze the four summary metrics', () => {
  it('keeps sticky header in portrait and rotated phones', () => {
    const component = readFileSync('src/components/revenue/RevenueCalendarExperience.tsx', 'utf8');
    expect(component).toContain('position: sticky !important;');
    expect(component).toContain('/* The four key metric rows must remain frozen even when the phone rotates. */');
    expect(layout).toContain('> div > [data-rate-event-row="true"]');
    expect(legacy).toContain('> div > [data-rate-event-row="true"]');
  });
});

describe('Reliable fixed frozen summary without per-frame movement', () => {
  it('keeps one interactive summary outside the vertically scrolling rate body', () => {
    const component = readFileSync('src/components/revenue/RateStrategyGrid.tsx', 'utf8');
    const wrapper = component.indexOf('data-rate-grid-native-sticky="true"');
    const surface = component.indexOf('data-rate-grid-sticky-surface="true"', wrapper);
    const headerPane = component.indexOf('data-rate-grid-header-scroll="true"', surface);
    const summary = component.indexOf('ref={stickyHeaderRef}', headerPane);
    const body = component.indexOf('ref={scrollRef}', summary);
    const events = component.indexOf('data-rate-event-row="true"', body);
    expect(wrapper).toBeGreaterThan(0);
    expect(surface).toBeGreaterThan(wrapper);
    expect(headerPane).toBeGreaterThan(surface);
    expect(summary).toBeGreaterThan(headerPane);
    expect(body).toBeGreaterThan(summary);
    expect(events).toBeGreaterThan(body);
    expect(component).toContain('ref={stickyPlaceholderRef}');
    expect(component).toContain('ref={stickySurfaceRef}');
    expect(component).toContain('shouldPinRateSummary({');
    expect(component).toContain('surface.style.position = "fixed"');
    expect(component).toContain('placeholder.style.height =');
    expect(component).toContain('if (top !== lastTop)');
    // Once the fixed header is released it must pin on a second entry.
    expect(component).toContain('lastTop = NaN;');
    expect(component).toContain('lastLeft = NaN;');
    expect(component).toContain('lastWidth = NaN;');
    expect(component).not.toContain('stickyAppHeaderH');
    expect(component).not.toContain('rateCalendarPagePinOffset');
    expect(component).not.toContain('summary.style.transform');
    expect(component).toContain('window.addEventListener("scroll", schedule, { passive: true })');
  });

  it('synchronizes horizontal panning without changing the page vertical scroll', () => {
    const component = readFileSync('src/components/revenue/RateStrategyGrid.tsx', 'utf8');
    expect(component).toContain('header.scrollLeft = body.scrollLeft');
    expect(component).toContain('body.scrollLeft = header.scrollLeft');
    expect(component).toContain('height: expanded ? (availGridH');
    expect(component).toContain(': "auto"');
    const visual = readFileSync('src/styles/revenue-grid-performance.css', 'utf8');
    expect(visual).toContain('max-height: none !important');
    expect(visual).toContain('overscroll-behavior-y: auto !important');
  });
});

describe('Mobile summary dimensions and rate-row visibility', () => {
  it('keeps fixed mobile summary compact and prevents Pickup from growing to 100px', () => {
    const component = readFileSync('src/components/revenue/RateStrategyGrid.tsx', 'utf8');
    const css = readFileSync('src/styles/rate-calendar-month-layout.css', 'utf8');
    expect(component).toContain('"--rate-month-height"');
    expect(component).toContain('"--rate-day-height"');
    expect(component).toContain('"--rate-metric-height"');
    expect(component).toContain('PU {isAutomationWindow ? "48h"');
    expect(css).toContain('[data-rate-grid-sticky-surface="true"]');
    expect(css).toContain('height: var(--rate-metric-height) !important;');
    expect(css).toContain('max-height: var(--rate-metric-height) !important;');
    expect(css).toContain('max-height: var(--rate-day-height) !important;');
    expect(css).toContain('font-size: 10px !important;');
    expect(css).toContain('white-space: nowrap !important;');
    expect(css).toContain('-webkit-text-size-adjust: 100%;');
    expect(css).toContain('overflow-wrap: normal !important;');
  });
});

describe('Month selection is not covered by the old sticky MONTH arrow', () => {
  it('moves the descriptive heading outside the month scroller', () => {
    const heading = layout.split('/* The original MONTH arrow')[1]
      ?.split('[data-training="revenue-grid"] [data-rate-month-navigation],')[0] ?? '';
    expect(heading).toContain('.relative:has(>');
    expect(heading).toContain('MONTH VIEW · Select a month');
    expect(heading).toContain('display: block;');
  });

  it('removes the overlay and clarifies the native All dates control', () => {
    const oldOverlay = layout.split('/* No sticky pseudo-element')[1]
      ?.split('[data-training="revenue-grid"] [data-rate-month-navigation] > button,')[0] ?? '';
    expect(oldOverlay).toContain('[data-rate-month-navigation]::before');
    expect(oldOverlay).toContain('content: none !important;');
    expect(oldOverlay).toContain('display: none !important;');
    expect(layout).toContain('> button:first-child::after');
    expect(layout).toContain('content: " dates";');
    expect(layout).not.toContain('position: sticky;\n    left: 0;\n    z-index: 2;');
  });
});
