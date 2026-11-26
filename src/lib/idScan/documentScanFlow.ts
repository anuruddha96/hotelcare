import type { MrzReadResult } from './mrz';
import { looksLikeIdFront } from './idFront';

export type MrzScanAction = 'passport_complete' | 'id_complete' | 'front_first_required' | 'different_document';

/** A provisional front capture is not proof of an ID. A valid passport can
 * recover from that provisional state, but not from positive ID evidence. */
export function nextMrzScanAction(mrz: Pick<MrzReadResult, 'fields'>,
  idFrontCaptured: boolean, positiveIdEvidence = idFrontCaptured): MrzScanAction {
  if (mrz.fields.documentType === 'passport') {
    return positiveIdEvidence ? 'different_document' : 'passport_complete';
  }
  return idFrontCaptured ? 'id_complete' : 'front_first_required';
}

export type FirstSideAction = 'passport_complete' | 'front_first_required' | 'provisional_front' | 'retry';
export function firstSideAction(mrz: Pick<MrzReadResult, 'valid' | 'unknownCountry' | 'format' | 'fields'> | null,
  sharpAndExposed: boolean): FirstSideAction {
  // Even an imperfect TD3 parse identifies the document type. The review
  // still requires verification of invalid/unknown-country data.
  if (mrz?.format === 'TD3' && mrz.fields.documentType === 'passport') return 'passport_complete';
  if (mrz?.valid && !mrz.unknownCountry) {
    if (mrz.format !== 'TD3' && mrz.fields.documentType === 'id_card') return 'front_first_required';
  }
  return sharpAndExposed ? 'provisional_front' : 'retry';
}


export type FirstCaptureKind = 'passport' | 'id_card' | 'unknown';

/** Classification only, never an identity or valid MRZ assertion. Accept a
 * readable passport heading or a truncated P< code line with issuer and name. */
export function looksLikePassport(text: string): boolean {
  const normalized = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  if (/\b(?:PASS[P]?ORT|PASSEPORT|REISEPASS|PASAPORTE|PASSAPORTO|PASSAPORTE|UTLEVEL|PASAPORT|PASZPORT)\b|ПАСПОРТ|护照|護照/.test(normalized)) return true;
  return normalized.split(/\r?\n/).some(line => /^P<[A-Z]{3}[A-Z<]{5,}/.test(line.replace(/\s/g, '').replace(/[«‹＜]/g,'<')));
}

export function classifyFirstCapture(text: string, passportHint = false): FirstCaptureKind {
  // Positive passport evidence wins over incidental ID-card wording.
  if (looksLikePassport(text)) return 'passport';
  if (looksLikeIdFront(text)) return 'id_card';
  return passportHint ? 'passport' : 'unknown';
}

export function canAdvanceToIdBack(kind: FirstCaptureKind, captured: boolean, explicitlyConfirmedId = false): boolean {
  return captured && (kind === 'id_card' || (kind === 'unknown' && explicitlyConfirmedId));
}
