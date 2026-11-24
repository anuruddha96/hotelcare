import type { MrzReadResult } from './mrz';
import { looksLikeIdFront, normalizeVisibleIdText } from './idFront';

/** A small luminance sample is used only in memory, never stored or logged. */
export function assessPreview(current: Uint8Array, previous: Uint8Array | null, width: number): boolean {
  if (!previous || current.length !== previous.length || width < 2 || current.length <= width) return false;
  let sum = 0, motion = 0, edges = 0, dark = 0, bright = 0;
  for (let i = 0; i < current.length; i++) {
    const v = current[i];
    sum += v;
    motion += Math.abs(v - previous[i]);
    if (v < 24) dark++;
    if (v > 248) bright++;
    if (i % width) edges += Math.abs(v - current[i - 1]);
    if (i >= width) edges += Math.abs(v - current[i - width]);
  }
  const n = current.length;
  return sum / n > 45 && sum / n < 235 && dark / n < 0.75
    && bright / n < 0.75 && motion / n < 7 && edges / n > 9;
}

/** Never auto-accept partial or uncertain MRZ results. Non-MRZ fields remain for review. */
export function completeAutoMrz(result: MrzReadResult | null, side: 'front' | 'mrz'): result is MrzReadResult {
  if (!result?.valid || result.unknownCountry) return false;
  const f = result.fields;
  return (side === 'front' ? f.documentType === 'passport' && result.format === 'TD3'
    : f.documentType === 'id_card' && result.format !== 'TD3')
    && !!(f.mrzFirstName && f.mrzLastName && f.documentNumber && f.dateOfBirth
      && f.expiryDate && f.nationality && f.issuingState);
}

/** The ID front is only a visual cross-check; the back still supplies the MRZ.
 * A heading alone is not enough to advance automatically.
 */
export function readableAutoFront(text: string, confidence: number): boolean {
  return confidence >= 65 && looksLikeIdFront(text)
    && normalizeVisibleIdText(text).length >= 60
    && text.split(/\r?\n/).filter(line => line.trim().length >= 3).length >= 4;
}
