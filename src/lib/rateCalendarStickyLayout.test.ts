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
    expect(repair).toContain('.flex:nth-child(8)');
    expect(repair).toContain('overflow: visible !important;');
    // Event titles still stay clipped within the *date-band child*.
    expect(legacy).toContain('> div:nth-child(2) {\n  overflow: hidden !important;');
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
