import type { MrzReadResult } from './mrz';

export type Readiness = 'ready' | 'moveCloser' | 'holdSteady' | 'tooDark' | 'tooMuchGlare';

/** Provisional thresholds for a 320px wide guide sample. Tune on actual
 * devices; use local contrast-normalized Laplacian energy, not whole-frame
 * edges. Ignore the perimeter where the table/card boundary may dominate. */
export function assessReadiness(current: Uint8Array, width: number, previous: Uint8Array | null = null,
  requireMotion = true): Readiness {
  const height = current.length / width;
  if (!Number.isInteger(width) || width < 8 || !Number.isInteger(height) || height < 8) return 'moveCloser';
  const n = current.length;
  let sum = 0, squares = 0, dark = 0, bright = 0, motion = 0;
  for (let i = 0; i < n; i++) {
    const v = current[i];
    sum += v; squares += v * v;
    if (v < 24) dark++;
    if (v >= 250) bright++;
    if (previous?.length === n) motion += Math.abs(v - previous[i]);
  }
  const mean = sum / n;
  if (mean < 42 || dark / n > 0.65) return 'tooDark';
  if (mean > 240 || bright / n > 0.65) return 'tooMuchGlare';
  if (requireMotion && (!previous || previous.length !== n || motion / n > 9)) return 'holdSteady';
  const contrast = Math.sqrt(Math.max(0, squares / n - mean * mean));
  let lapSum = 0, lapSquares = 0, count = 0;
  const borderX = Math.max(1, Math.floor(width * 0.08));
  const borderY = Math.max(1, Math.floor(height * 0.08));
  for (let y = borderY; y < height - borderY; y++) {
    for (let x = borderX; x < width - borderX; x++) {
      const i = y * width + x;
      const lap = 4 * current[i] - current[i - 1] - current[i + 1] - current[i - width] - current[i + width];
      lapSum += lap; lapSquares += lap * lap; count++;
    }
  }
  const variance = lapSquares / count - (lapSum / count) ** 2;
  // Relative sharpness compensates for differing contrast between cameras.
  if (contrast < 12 || variance / Math.max(contrast ** 2, 400) < 0.045 || variance < 45) return 'moveCloser';
  return 'ready';
}

/** Check completeness without imposing a side-specific routing rule. */
export function completeAutoMrz(result: MrzReadResult | null): result is MrzReadResult {
  if (!result?.valid || result.unknownCountry) return false;
  const f = result.fields;
  return (f.documentType === 'passport' ? result.format === 'TD3' : result.format !== 'TD3')
    && !!(f.mrzFirstName && f.mrzLastName && f.documentNumber && f.dateOfBirth
      && f.expiryDate && f.nationality && f.issuingState);
}
