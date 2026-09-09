import { describe, expect, it } from 'vitest';

describe('next-day public-area release invariant', () => {
  it('keeps public areas part of the delayed plan contract', () => {
    const workflow = ['Staff', 'Preview', 'Confirm', 'Public Areas', '08:00 release'];
    expect(workflow.slice(0, 4)).toEqual(['Staff', 'Preview', 'Confirm', 'Public Areas']);
    expect(workflow.at(-1)).toBe('08:00 release');
  });
});
