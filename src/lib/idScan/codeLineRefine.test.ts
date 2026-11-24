import { describe, expect, it } from 'vitest';
import { checkDigit, codeLineGeometry, padWhite, repairLookAlikes, sampleStraight } from './codeLineRefine';

const TD1 = ['I<HUN000000XX<0<<<<<<<<<<<<<<<', '7906307F2201100HUN<<<<<<<<<<<6', 'SZEPENE<KISS<<ROZALIA<<<<<<<<<'];

describe('code-line repair', () => {
  it('computes ICAO check digits', () => {
    expect(checkDigit('790630')).toBe('7');
    expect(checkDigit('000000XX<')).toBe('0');
  });
  it('leaves a valid document untouched', () => {
    expect(repairLookAlikes(TD1, 'TD1')).toEqual(TD1);
  });
  it('repairs single look-alike misreads proven by the check digits', () => {
    expect(repairLookAlikes(['I<HUN00G000XX<0<<<<<<<<<<<<<<<', TD1[1], TD1[2]], 'TD1')).toEqual(TD1);
    expect(repairLookAlikes([TD1[0], '7506307F2201100HUN<<<<<<<<<<<6', TD1[2]], 'TD1')).toEqual(TD1);
  });
  it('never guesses: no repair without a unique proven swap, names untouched', () => {
    expect(repairLookAlikes([TD1[0], '7106307F2201100HUN<<<<<<<<<<<6', TD1[2]], 'TD1')).toBeNull();
    expect(repairLookAlikes([TD1[0], '2506307F2201100HUN<<<<<<<<<<<6', TD1[2]], 'TD1')).toBeNull();
    // 2906307 could be 7906307 or 2906302: both satisfy every check digit, so neither is chosen.
    expect(repairLookAlikes([TD1[0], '2906307F2201100HUN<<<<<<<<<<<6', TD1[2]], 'TD1')).toBeNull();
    const wrongName = [TD1[0], TD1[1], 'CZEPENE<KISS<<ROZALIA<<<<<<<<<'];
    expect(repairLookAlikes(wrongName, 'TD1')).toEqual(wrongName);
  });
});

describe('code-line geometry', () => {
  const line = (y: number, slope = 0) => ({
    text: 'I<HUN000000XX<0<<<<<<<<<<<<<<<', bbox: { x0: 100, y0: y, x1: 1500, y1: y + 60 },
    baseline: { x0: 100, y0: y + 50, x1: 1500, y1: y + 50 + slope * 1400 },
  });
  it('maps the last block of code lines back to frame pixels', () => {
    const g = codeLineGeometry([{ text: 'Születési hely', bbox: { x0: 0, y0: 0, x1: 300, y1: 30 } }, line(200), line(280), line(360)], 2, 0, 500)!;
    expect(g.lines).toBe(3);
    expect(g.width).toBe(700);
    expect(Math.round(g.cy)).toBe(500 + 155);
    expect(g.angle).toBe(0);
  });
  it('measures tilt from the baselines and needs at least two code lines', () => {
    expect(codeLineGeometry([line(200, 0.05), line(280, 0.05)])!.angle).toBeCloseTo(2.86, 1);
    expect(codeLineGeometry([line(200)])).toBeNull();
  });
  it('straightens a tilted stripe', () => {
    const width = 200, height = 120, data = new Uint8ClampedArray(width * height).fill(255);
    const slope = Math.tan(5 * Math.PI / 180);
    for (let x = 0; x < width; x++) for (let t = -3; t <= 3; t++) data[Math.round(60 + (x - 100) * slope + t) * width + x] = 0;
    const out = sampleStraight({ data, width, height }, 100, 60, 5, -80, -10, 80, 10, 160);
    const rowMean = (y: number) => out.data.subarray(y * out.width, (y + 1) * out.width).reduce((a, b) => a + b, 0) / out.width;
    expect(rowMean(out.height >> 1)).toBeLessThan(40);
    expect(rowMean(1)).toBeGreaterThan(230);
    expect(padWhite(out, 10).width).toBe(out.width + 20);
  });
});
