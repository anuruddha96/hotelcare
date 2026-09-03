import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('mobile training coach layout', () => {
  const css = readFileSync(
    resolve(process.cwd(), 'src/styles/training-mobile-safe.css'),
    'utf8',
  );

  it('reserves a separate interaction lane for the highlighted control', () => {
    expect(css).toContain("[aria-labelledby='tv2-title']");
    expect(css).toContain('bottom: 0 !important');
    expect(css).toContain('max-height: 40dvh !important');
    expect(css).toContain("[data-training='swipe-action-track']");
    expect(css).toContain('scroll-margin-block-end: 44dvh');
  });

  it('keeps the complete training journey opaque and readable over the dimmed app', () => {
    expect(css).toContain('background-color: hsl(var(--background)) !important');
    expect(css).toContain('color: hsl(var(--foreground)) !important');
    expect(css).toContain('-webkit-backdrop-filter: none !important');
    expect(css).toContain("[aria-labelledby='tv2-title'] #tv2-desc");
    expect(css).toContain('color: hsl(var(--foreground) / 0.82) !important');
    expect(css).toContain("[aria-labelledby='tv2-title'] .text-muted-foreground");
  });
});
