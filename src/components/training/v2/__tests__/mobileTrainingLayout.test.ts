import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('mobile training coach layout', () => {
  it('reserves a separate interaction lane for the highlighted control', () => {
    const css = readFileSync(
      resolve(process.cwd(), 'src/styles/training-mobile-safe.css'),
      'utf8',
    );

    expect(css).toContain("[aria-labelledby='tv2-title']");
    expect(css).toContain('bottom: 0 !important');
    expect(css).toContain('max-height: 40dvh !important');
    expect(css).toContain("[data-training='swipe-action-track']");
    expect(css).toContain('scroll-margin-block-end: 44dvh');
  });
});
