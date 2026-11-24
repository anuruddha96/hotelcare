import { describe, expect, it } from 'vitest';
import { confidenceTone, printedRegion, shouldAdvanceFront } from './stillCapture';

describe('still document capture', () => {
  it('only advances a positively identified front above 90 percent', () => {
    expect(shouldAdvanceFront(90, true)).toBe(false);
    expect(shouldAdvanceFront(90.1, true)).toBe(true);
    expect(shouldAdvanceFront(99, false)).toBe(false);
    expect(shouldAdvanceFront(null, true)).toBe(false);
    expect(shouldAdvanceFront(NaN, true)).toBe(false);
  });
  it('does not show a green high-confidence state for low confidence', () => {
    expect(confidenceTone(50)).toBe('low');
    expect(confidenceTone(85)).toBe('medium');
    expect(confidenceTone(95)).toBe('high');
    expect(confidenceTone(null)).toBe('unknown');
  });
  it('isolates the printed region of the Hungarian ID back and retains full passport coverage', () => {
    expect(printedRegion(1000, 600, true)).toEqual({x:0,y:0,width:1000,height:408});
    expect(printedRegion(1000, 600, true, true)).toEqual({x:0,y:0,width:780,height:408});
    expect(printedRegion(1000, 600, false, true)).toEqual({x:0,y:0,width:1000,height:600});
  });
});
