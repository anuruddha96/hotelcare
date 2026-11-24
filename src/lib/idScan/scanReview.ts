import type { MrzReadResult } from './mrz';

/** OCR confidence is a recognition-engine estimate, not identity verification. */
export function scanConfidence(value: number | null): number | null {
  return value !== null && Number.isFinite(value) ? Math.round(Math.max(0, Math.min(100, value))) : null;
}

/** Printed Hungarian ID numbers often use six digits followed by two letters.
 * Only suggest a number next to a document-number label. Never remove an N
 * (or any other prefix) from the MRZ merely because it looks suspicious. */
export function printedHungarianIdNumber(text: string): string | null {
  const lines = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().split(/\r?\n/);
  const candidates = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const marker = /(?:DOCUMENT\s*(?:NO\.?|NUMBER)|DOC\.?\s*(?:NO\.?|NUMBER)|OKMANYSZAM|OKMANYAZONOSITO)/.exec(lines[i]);
    if (!marker) continue;
    const tail = lines[i].slice(marker.index + marker[0].length);
    for (const line of [tail, lines[i + 1] ?? '']) {
      if (/\bCAN\b|\bACCESS\s*NUMBER\b/.test(line)) continue;
      const match = /(?:^|[^A-Z0-9])(\d{6}\s*[A-Z]{2})(?![A-Z0-9])/.exec(line);
      if (match) candidates.add(match[1].replace(/\s/g, ''));
    }
  }
  return candidates.size === 1 ? [...candidates][0] : null;
}

export function documentNumberReview(result: MrzReadResult, frontText: string): { needsReview: boolean; printed: string | null } {
  const fields = result.fields;
  const hungarianId = result.format === 'TD1' && fields.documentType === 'id_card'
    && (fields.nationalityIso3 === 'HUN' || fields.issuingState === 'HUN');
  const printed = hungarianId ? printedHungarianIdNumber(frontText) : null;
  // An invalid MRZ/issuer or disagreeing printed number requires explicit
  // comparison. Preserve raw lines and parsed values for VIZA.
  return {
    needsReview: !result.valid || result.unknownCountry
      || (hungarianId && fields.issuingState !== 'HUN')
      || (!!printed && printed !== fields.documentNumber),
    printed: printed && printed !== fields.documentNumber ? printed : null,
  };
}

export function sameRead(a: MrzReadResult | null, b: MrzReadResult): boolean {
  return !!a && a.format === b.format && a.lines.join('\n') === b.lines.join('\n');
}
